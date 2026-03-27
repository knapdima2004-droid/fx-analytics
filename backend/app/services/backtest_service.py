"""Walk-forward backtesting with statistical verification.

Process
-------
1. Generate rolling windows from [start, end] with given train/test/step sizes.
2. For each model × window: fit on train, predict on test, compute per-window metrics.
3. For AIEnsemble: uses AI to analyse context + base-model predictions per step.
4. Aggregate overall metrics per model.
5. Run statistical tests (ADF, Ljung-Box, Diebold-Mariano).
6. Persist the results.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging_config import get_logger
from app.models.orm import BacktestRunRow
from app.schemas.schemas import (
    BacktestMetrics,
    BacktestRequest,
    BacktestResponse,
    BacktestResult,
    BacktestWindowResult,
    StatisticalTests,
    AdfTest,
    LjungBoxTest,
    DieboldMarianoTest,
    ModelTypeEnum,
)
from app.services.ohlc_service import get_close_series
from app.services.model_service import _build_wrapper
from app.utils.indicators import build_features
from app.utils.metrics import (
    mae,
    rmse,
    directional_accuracy,
    adf_test,
    ljung_box_test,
    diebold_mariano_test,
)

log = get_logger(__name__)

# Maximum number of walk-forward windows to use for AI Ensemble.
MAX_AI_WINDOWS = 50


def _generate_windows(
    index: pd.DatetimeIndex,
    train_days: int,
    test_days: int,
    step_days: int,
) -> list[tuple[pd.DatetimeIndex, pd.DatetimeIndex]]:
    """Generate (train_idx, test_idx) pairs via rolling windows."""
    windows = []
    total = len(index)
    start = 0
    while start + train_days + test_days <= total:
        train_idx = index[start : start + train_days]
        test_idx = index[start + train_days : start + train_days + test_days]
        if len(test_idx) > 0:
            windows.append((train_idx, test_idx))
        start += step_days
    return windows


def _run_base_model_window(
    model_type: str,
    y: pd.Series,
    train_idx: pd.DatetimeIndex,
    test_idx: pd.DatetimeIndex,
) -> np.ndarray | None:
    """Run a single base model on a single window, return predictions or None."""
    y_train = y.loc[train_idx]
    y_test = y.loc[test_idx]
    need_features = model_type in ("Ridge", "RandomForest")

    try:
        hp = {"auto": True} if model_type == "ARIMA" else None
        wrapper = _build_wrapper(model_type, hp)
        if need_features:
            feat_cfg = {
                "lagReturns": True, "numLags": 5,
                "sma": True, "ema": True, "rsi": True, "macd": True,
            }
            full_slice = y.loc[train_idx[0]: test_idx[-1]]
            features_df = build_features(full_slice, feat_cfg).dropna()
            common_train = features_df.index.intersection(train_idx)
            common_test = features_df.index.intersection(test_idx)
            if len(common_train) < 10 or len(common_test) < 1:
                return None
            wrapper.fit(features_df.loc[common_train].values, y.loc[common_train].values)
            return wrapper.predict_one(features_df.loc[common_test].values)
        else:
            wrapper.fit(y_train.values)
            return wrapper.predict(len(y_test))
    except Exception as e:
        log.warning("backtest.base_model_error", model=model_type, error=str(e))
        return None


async def _run_ai_ensemble_window(
    symbol: str,
    y: pd.Series,
    train_idx: pd.DatetimeIndex,
    test_idx: pd.DatetimeIndex,
    base_model_preds: dict[str, np.ndarray],
    prior_da: dict[str, float] | None = None,
) -> np.ndarray | None:
    """Run the AI Ensemble for one walk-forward window.

    Uses adaptive model selection: starts with the prior-DA leader,
    can switch mid-window if cumulative rolling DA strongly disagrees.
    """
    from app.services.ai_prediction import predict_batch, compute_indicators

    y_test_vals = y.loc[test_idx].values
    n_test = len(y_test_vals)
    train_last = float(y.loc[train_idx].values[-1])
    train_closes = y.loc[train_idx].values

    contexts = []
    for i in range(n_test):
        if i == 0:
            history = train_closes
        else:
            history = np.concatenate([train_closes, y_test_vals[:i]])

        recent = history[-30:].tolist() if len(history) >= 30 else history.tolist()

        bp = {}
        for m_name, m_preds in base_model_preds.items():
            if m_preds is not None and i < len(m_preds):
                bp[m_name] = float(m_preds[i])

        if not bp:
            continue

        # Cumulative rolling DA: use ALL bars 0..i-1 (not just last 10)
        recent_errors: dict[str, list[float]] = {}
        recent_da: dict[str, float] = {}

        if i > 0:
            for m_name, m_preds in base_model_preds.items():
                if m_preds is not None:
                    errs = []
                    correct_dir = 0
                    total_dir = 0
                    for j in range(i):
                        if j < len(m_preds):
                            errs.append(float(y_test_vals[j] - m_preds[j]))
                            prev_actual = train_last if j == 0 else float(y_test_vals[j - 1])
                            actual_up = float(y_test_vals[j]) > prev_actual
                            pred_up = float(m_preds[j]) > prev_actual
                            if actual_up == pred_up:
                                correct_dir += 1
                            total_dir += 1
                    recent_errors[m_name] = errs
                    recent_da[m_name] = (
                        correct_dir / total_dir if total_dir > 0 else 0.5
                    )

        indicators = compute_indicators(np.array(recent))

        contexts.append({
            "recent_closes": recent,
            "base_predictions": bp,
            "indicators": indicators,
            "recent_errors": recent_errors,
            "recent_da": recent_da,
            "prior_da": prior_da or {},
            "step_label": f"bar {i}/{n_test}",
        })

    if not contexts:
        return None

    log.info("ai_ensemble.predicting", symbol=symbol, steps=len(contexts))
    results = await predict_batch(symbol, contexts)

    preds = np.array([r["predicted_close"] for r in results], dtype=float).ravel()
    return preds


async def run_backtest(
    db: AsyncSession,
    req: BacktestRequest,
    cancel_event: "asyncio.Event | None" = None,
    progress: dict | None = None,
) -> BacktestResponse:
    """Execute walk-forward backtest for all requested models."""
    import asyncio
    symbol = req.pair
    close = await get_close_series(db, symbol, req.timeframe.value, req.start, req.end)

    if close.empty or len(close) < req.windowTrainDays + req.windowTestDays:
        raise ValueError(
            f"Not enough data ({len(close)} rows) for "
            f"train={req.windowTrainDays} + test={req.windowTestDays}"
        )

    y = close.copy()

    windows = _generate_windows(
        y.index,
        req.windowTrainDays,
        req.windowTestDays,
        req.stepDays,
    )

    if not windows:
        raise ValueError("Could not generate any backtest windows with given parameters.")

    # Separate base models from AI model
    has_ai = ModelTypeEnum.AIEnsemble in req.models
    base_model_enums = [m for m in req.models if m != ModelTypeEnum.AIEnsemble]

    log.info("backtest.start", symbol=symbol, models=len(req.models),
             windows=len(windows), has_ai=has_ai)

    results: list[BacktestResult] = []
    # Store errors as {model: pd.Series} indexed by date for proper alignment
    all_errors: dict[str, pd.Series] = {}

    # ─── Phase 1: Run base models ────────────────────────────────────────
    # Store per-window predictions for AI Ensemble to use later
    base_window_preds: list[dict[str, np.ndarray | None]] = [
        {} for _ in windows
    ]

    total_models = len(base_model_enums) + (1 if has_ai else 0)

    for m_idx, model_enum in enumerate(base_model_enums):
        # ── Check cancellation between models ──
        if cancel_event and cancel_event.is_set():
            log.info("backtest.cancelled_by_user", symbol=symbol)
            raise asyncio.CancelledError("Backtest cancelled by user")
        await asyncio.sleep(0)  # yield control to event loop

        model_type = model_enum.value

        # Update progress
        if progress is not None:
            progress["currentModel"] = model_type
            progress["modelIndex"] = m_idx + 1
            progress["totalModels"] = total_models
            progress["currentWindow"] = 0
            progress["totalWindows"] = len(windows)
        window_results: list[BacktestWindowResult] = []
        all_mae, all_rmse, all_da = [], [], []
        model_error_series: list[pd.Series] = []

        for w_idx, (train_idx, test_idx) in enumerate(windows):
            # ── Check cancellation between windows ──
            if cancel_event and cancel_event.is_set():
                log.info("backtest.cancelled_by_user", symbol=symbol)
                raise asyncio.CancelledError("Backtest cancelled by user")
            if w_idx % 2 == 0:
                await asyncio.sleep(0)  # yield control periodically

            if progress is not None:
                progress["currentWindow"] = w_idx + 1

            y_test = y.loc[test_idx]

            need_features = model_type in ("Ridge", "RandomForest")
            try:
                hp = {"auto": True} if model_type == "ARIMA" else None
                wrapper = _build_wrapper(model_type, hp)
                if need_features:
                    feat_cfg = {
                        "lagReturns": True, "numLags": 5,
                        "sma": True, "ema": True, "rsi": True, "macd": True,
                    }
                    full_slice = y.loc[train_idx[0]: test_idx[-1]]
                    features_df = build_features(full_slice, feat_cfg).dropna()
                    common_train = features_df.index.intersection(train_idx)
                    common_test = features_df.index.intersection(test_idx)
                    if len(common_train) < 10 or len(common_test) < 1:
                        continue
                    X_train = features_df.loc[common_train].values
                    X_test = features_df.loc[common_test].values
                    yt = y.loc[common_train].values
                    wrapper.fit(X_train, yt)
                    preds = wrapper.predict_one(X_test)
                    y_true = y.loc[common_test].values
                else:
                    y_train = y.loc[train_idx]
                    wrapper.fit(y_train.values)
                    preds = wrapper.predict(len(y_test))
                    y_true = y_test.values

                # Store predictions for AI Ensemble
                base_window_preds[w_idx][model_type] = preds

                w_mae = mae(y_true, preds)
                w_rmse = rmse(y_true, preds)
                w_da = directional_accuracy(y_true, preds)

                # Store errors with date index for proper alignment in DM test
                if need_features:
                    err_index = common_test
                else:
                    err_index = test_idx
                err_series = pd.Series(y_true - preds, index=err_index[:len(y_true)])
                model_error_series.append(err_series)

                all_mae.append(w_mae)
                all_rmse.append(w_rmse)
                all_da.append(w_da)

                window_results.append(BacktestWindowResult(
                    trainStart=train_idx[0].strftime("%Y-%m-%d"),
                    trainEnd=train_idx[-1].strftime("%Y-%m-%d"),
                    testStart=test_idx[0].strftime("%Y-%m-%d"),
                    testEnd=test_idx[-1].strftime("%Y-%m-%d"),
                    mae=round(w_mae, 6),
                    rmse=round(w_rmse, 6),
                    directionalAccuracy=round(w_da, 4),
                ))
            except Exception as e:
                log.warning("backtest.window_error", model=model_type, error=str(e))
                continue

        if not window_results:
            results.append(BacktestResult(
                model=ModelTypeEnum(model_type),
                metrics=BacktestMetrics(mae=999.0, rmse=999.0, directionalAccuracy=0.0),
                windows=[],
            ))
            continue

        avg_mae = float(np.mean(all_mae))
        avg_rmse = float(np.mean(all_rmse))
        avg_da = float(np.mean(all_da))
        # Concatenate date-indexed error series (duplicates resolved by keeping last)
        combined = pd.concat(model_error_series)
        combined = combined[~combined.index.duplicated(keep="last")]
        all_errors[model_type] = combined.sort_index()

        results.append(BacktestResult(
            model=ModelTypeEnum(model_type),
            metrics=BacktestMetrics(
                mae=round(avg_mae, 6),
                rmse=round(avg_rmse, 6),
                directionalAccuracy=round(avg_da, 4),
            ),
            windows=window_results,
        ))

    # ─── Phase 2: Run AI Ensemble (uses base predictions) ────────────────
    # Check cancellation before AI phase
    if cancel_event and cancel_event.is_set():
        raise asyncio.CancelledError("Backtest cancelled by user")

    if has_ai and settings.OPENAI_API_KEY:
        # Reset the AI circuit breaker for this run
        from app.services.ai_prediction import _reset_circuit_breaker
        _reset_circuit_breaker()
        ai_window_results: list[BacktestWindowResult] = []
        ai_mae_list, ai_rmse_list, ai_da_list = [], [], []
        ai_error_series: list[pd.Series] = []

        # Limit AI windows to avoid excessive API calls
        # Build list of (original_index, train_idx, test_idx)
        ai_window_items: list[tuple[int, pd.DatetimeIndex, pd.DatetimeIndex]] = []
        if len(windows) > MAX_AI_WINDOWS:
            step = len(windows) / MAX_AI_WINDOWS
            selected = [int(i * step) for i in range(MAX_AI_WINDOWS)]
            ai_window_items = [(i, windows[i][0], windows[i][1]) for i in selected]
            log.info("backtest.ai_windows_limited",
                     original=len(windows), limited=len(ai_window_items))
        else:
            ai_window_items = [(i, w[0], w[1]) for i, w in enumerate(windows)]

        if progress is not None:
            progress["currentModel"] = "AIEnsemble"
            progress["modelIndex"] = total_models
            progress["totalModels"] = total_models
            progress["totalWindows"] = len(ai_window_items)
            progress["currentWindow"] = 0
            progress["aiEstimateSec"] = len(ai_window_items) * req.windowTestDays

        prior_da: dict[str, float] = {}

        for aw_idx, (w_idx, train_idx, test_idx) in enumerate(ai_window_items):
            # ── Check cancellation in AI phase ──
            if cancel_event and cancel_event.is_set():
                raise asyncio.CancelledError("Backtest cancelled by user")
            await asyncio.sleep(0)

            if progress is not None:
                progress["currentWindow"] = aw_idx + 1

            y_test = y.loc[test_idx]
            y_true = y_test.values
            bwp = base_window_preds[w_idx]

            if not bwp:
                continue

            try:
                ai_preds = await _run_ai_ensemble_window(
                    symbol, y, train_idx, test_idx, bwp,
                    prior_da=prior_da,
                )
                if ai_preds is None or len(ai_preds) == 0:
                    continue

                # Align lengths (AI may have fewer predictions)
                n = min(len(y_true), len(ai_preds))
                y_true_aligned = y_true[:n]
                ai_preds_aligned = ai_preds[:n]

                ai_w_mae = mae(y_true_aligned, ai_preds_aligned)
                ai_w_rmse = rmse(y_true_aligned, ai_preds_aligned)
                ai_w_da = directional_accuracy(y_true_aligned, ai_preds_aligned)

                err_s = pd.Series(
                    y_true_aligned - ai_preds_aligned,
                    index=test_idx[:n],
                )
                ai_error_series.append(err_s)

                # Use most recent window's DA for faster adaptation
                prior_da = {}
                for m_name, m_preds in bwp.items():
                    if m_preds is not None:
                        n_m = min(len(y_true), len(m_preds))
                        if n_m > 0:
                            prior_da[m_name] = directional_accuracy(
                                y_true[:n_m], m_preds[:n_m],
                            )

                ai_mae_list.append(ai_w_mae)
                ai_rmse_list.append(ai_w_rmse)
                ai_da_list.append(ai_w_da)

                ai_window_results.append(BacktestWindowResult(
                    trainStart=train_idx[0].strftime("%Y-%m-%d"),
                    trainEnd=train_idx[-1].strftime("%Y-%m-%d"),
                    testStart=test_idx[0].strftime("%Y-%m-%d"),
                    testEnd=test_idx[-1].strftime("%Y-%m-%d"),
                    mae=round(ai_w_mae, 6),
                    rmse=round(ai_w_rmse, 6),
                    directionalAccuracy=round(ai_w_da, 4),
                ))
            except Exception as e:
                log.warning("backtest.ai_window_error", window=w_idx, error=str(e))
                continue

        if ai_window_results:
            ai_combined = pd.concat(ai_error_series)
            ai_combined = ai_combined[~ai_combined.index.duplicated(keep="last")]
            all_errors["AIEnsemble"] = ai_combined.sort_index()
            results.append(BacktestResult(
                model=ModelTypeEnum.AIEnsemble,
                metrics=BacktestMetrics(
                    mae=round(float(np.mean(ai_mae_list)), 6),
                    rmse=round(float(np.mean(ai_rmse_list)), 6),
                    directionalAccuracy=round(float(np.mean(ai_da_list)), 4),
                ),
                windows=ai_window_results,
            ))
        else:
            results.append(BacktestResult(
                model=ModelTypeEnum.AIEnsemble,
                metrics=BacktestMetrics(mae=999.0, rmse=999.0, directionalAccuracy=0.0),
                windows=[],
            ))
    elif has_ai and not settings.OPENAI_API_KEY:
        log.warning("backtest.ai_skipped", reason="OPENAI_API_KEY not set")
        results.append(BacktestResult(
            model=ModelTypeEnum.AIEnsemble,
            metrics=BacktestMetrics(mae=999.0, rmse=999.0, directionalAccuracy=0.0),
            windows=[],
        ))

    # ─── Statistical tests ────────────────────────────────────────────────
    log_returns = np.log(close / close.shift(1)).dropna()
    adf = adf_test(log_returns)

    # Best model selection: use DA >= Naive baseline, then lowest RMSE
    # (consistent with report_service logic)
    valid_results = [r for r in results if r.windows]  # exclude failed models
    naive_da = 0.5
    for r in valid_results:
        if r.model.value == "Naive":
            naive_da = r.metrics.directionalAccuracy
            break
    candidates = [r for r in valid_results if r.metrics.directionalAccuracy >= naive_da]
    if not candidates:
        candidates = valid_results
    best_model = min(candidates, key=lambda r: r.metrics.rmse) if candidates else None
    lb_result = {"statistic": 0.0, "pValue": 1.0, "noAutocorrelation": True}
    if best_model and best_model.model.value in all_errors:
        best_err_series = all_errors[best_model.model.value]
        lb_result = ljung_box_test(best_err_series)

    dm_result = None
    if "Naive" in all_errors and best_model and best_model.model.value != "Naive":
        naive_err = all_errors["Naive"]
        best_err = all_errors[best_model.model.value]
        # Align by date index so errors are compared at the same time points
        common_idx = naive_err.index.intersection(best_err.index)
        if len(common_idx) > 5:
            dm = diebold_mariano_test(
                naive_err.loc[common_idx].values,
                best_err.loc[common_idx].values,
                "Naive",
                best_model.model.value,
            )
            dm_result = DieboldMarianoTest(
                statistic=dm["statistic"],
                pValue=dm["pValue"],
                betterModel=ModelTypeEnum(dm["betterModel"]) if dm["betterModel"] else None,
            )

    tests = StatisticalTests(
        adf=AdfTest(**adf),
        ljungBox=LjungBoxTest(**lb_result),
        dieboldMariano=dm_result,
    )

    # ─── Persist ──────────────────────────────────────────────────────────
    run_id = str(uuid.uuid4())
    run_row = BacktestRunRow(
        id=run_id,
        symbol=symbol,
        timeframe=req.timeframe.value,
        start=req.start,
        end=req.end,
        request_json=req.model_dump(),
        results_json=[r.model_dump() for r in results],
        tests_json=tests.model_dump(),
    )
    db.add(run_row)
    await db.commit()

    log.info("backtest.done", symbol=symbol, models=len(results), run_id=run_id)

    return BacktestResponse(runId=run_id, results=results, tests=tests)

"""Model training, persistence and forecasting service.

Supported models:
- Naive          – predict(t+1) = close(t)
- MovingAverage  – predict = mean of last *window* closes
- ARIMA          – statsmodels ARIMA(p,d,q)
- Ridge          – sklearn Ridge regression with feature engineering
- RandomForest   – sklearn RandomForestRegressor with feature engineering
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession
from statsmodels.tsa.arima.model import ARIMA as StatsARIMA

from app.core.config import settings
from app.core.logging_config import get_logger
from app.models.orm import TrainedModelRow
from app.schemas.schemas import (
    ForecastPoint,
    MetricsPreview,
    ModelTypeEnum,
    TargetEnum,
    TrainRequest,
    TrainResponse,
)
from app.services.ohlc_service import get_close_series
from app.utils.indicators import build_features
from app.utils.metrics import mae, rmse
from app.utils.time_helpers import next_business_days, next_hours, to_iso_date

log = get_logger(__name__)


# ─── Internal model wrappers ─────────────────────────────────────────────────

class _NaiveWrapper:
    def __init__(self):
        self.last_value: float = 0.0

    def fit(self, y: np.ndarray, **kw):
        self.last_value = float(y[-1])

    def predict(self, horizon: int) -> np.ndarray:
        return np.full(horizon, self.last_value)


class _MAWrapper:
    def __init__(self, window: int = 20):
        self.window = window
        self.values: np.ndarray | None = None

    def fit(self, y: np.ndarray, **kw):
        self.values = y[-self.window:]

    def predict(self, horizon: int) -> np.ndarray:
        return np.full(horizon, float(np.mean(self.values)))


class _ARIMAWrapper:
    def __init__(self, order: tuple[int, int, int] = (1, 1, 1), auto: bool = False):
        self.order = order
        self.auto = auto
        self._fit = None
        self.final_order: tuple[int, int, int] = order

    def fit(self, y: np.ndarray, **kw):
        if self.auto:
            import pmdarima as pm
            auto_model = pm.auto_arima(
                y,
                start_p=0, max_p=5,
                start_q=0, max_q=5,
                d=None,  # auto-detect differencing
                max_d=2,
                seasonal=False,
                stepwise=True,
                suppress_warnings=True,
                error_action="ignore",
                trace=False,
            )
            self.final_order = auto_model.order
            self._fit = auto_model.arima_res_
        else:
            model = StatsARIMA(y, order=self.order)
            self._fit = model.fit(method_kwargs={"warn_convergence": False})
            self.final_order = self.order

    def predict(self, horizon: int) -> np.ndarray:
        return self._fit.forecast(steps=horizon)

    def predict_with_ci(self, horizon: int, alpha: float = 0.05):
        fcast = self._fit.get_forecast(steps=horizon)
        mean = np.asarray(fcast.predicted_mean)
        ci = np.asarray(fcast.conf_int(alpha=alpha))
        return mean, ci


class _RidgeWrapper:
    def __init__(self, alpha: float = 1.0):
        self.pipeline = Pipeline([
            ("scaler", StandardScaler()),
            ("ridge", Ridge(alpha=alpha)),
        ])

    def fit(self, X: np.ndarray, y: np.ndarray, **kw):
        self.pipeline.fit(X, y)

    def predict_one(self, X: np.ndarray) -> np.ndarray:
        return self.pipeline.predict(X)


class _RFWrapper:
    def __init__(self, n_estimators: int = 100, max_depth: int | None = 10):
        self.model = RandomForestRegressor(
            n_estimators=n_estimators,
            max_depth=max_depth,
            random_state=42,
        )

    def fit(self, X: np.ndarray, y: np.ndarray, **kw):
        self.model.fit(X, y)

    def predict_one(self, X: np.ndarray) -> np.ndarray:
        return self.model.predict(X)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _build_wrapper(model_type: str, hyperparams: dict | None) -> Any:
    hp = hyperparams or {}
    if model_type == "Naive":
        return _NaiveWrapper()
    if model_type == "MovingAverage":
        return _MAWrapper(window=int(hp.get("window", 20)))
    if model_type == "ARIMA":
        auto = bool(hp.get("auto", False))
        p = int(hp.get("p", 1))
        d = int(hp.get("d", 1))
        q = int(hp.get("q", 1))
        return _ARIMAWrapper(order=(p, d, q), auto=auto)
    if model_type == "Ridge":
        return _RidgeWrapper(alpha=float(hp.get("alpha", 1.0)))
    if model_type == "RandomForest":
        raw_md = hp.get("max_depth")
        max_depth = int(raw_md) if raw_md is not None and raw_md != 0 else None
        return _RFWrapper(
            n_estimators=int(hp.get("n_estimators", 100)),
            max_depth=max_depth,
        )
    if model_type == "AIEnsemble":
        # AI Ensemble doesn't have a traditional wrapper; it's handled
        # specially in the backtest service. Return a dummy for compatibility.
        return _NaiveWrapper()
    raise ValueError(f"Unknown model type: {model_type}")


def _prepare_target(close: pd.Series, target: str) -> pd.Series:
    if target == "log_return":
        return np.log(close / close.shift(1)).dropna()
    return close


def _split_time(series: pd.Series, val_frac: float = 0.2):
    n = len(series)
    split = int(n * (1 - val_frac))
    return series.iloc[:split], series.iloc[split:]


# ─── Public API ───────────────────────────────────────────────────────────────

async def train_model(
    db: AsyncSession,
    req: TrainRequest,
) -> TrainResponse:
    """Train a model and persist it."""
    symbol = req.pair
    close = await get_close_series(db, symbol, req.timeframe.value, req.start, req.end)

    if close.empty or len(close) < 30:
        raise ValueError(f"Not enough data to train ({len(close)} rows). Need at least 30.")

    target_str = req.target.value if req.target else "close"
    y_full = _prepare_target(close, target_str)

    model_type = req.model.value
    wrapper = _build_wrapper(model_type, req.hyperparams)

    # Feature config
    feat_cfg = req.features.model_dump() if req.features else {}
    need_features = model_type in ("Ridge", "RandomForest")

    if need_features:
        features_df = build_features(close, feat_cfg)
        # Align target with features
        common_idx = y_full.index.intersection(features_df.index)
        features_df = features_df.loc[common_idx].dropna()
        y_aligned = y_full.loc[features_df.index]

        if len(y_aligned) < 30:
            raise ValueError(f"Not enough data after feature engineering ({len(y_aligned)} rows).")

        X_train_df, X_val_df = _split_time(features_df)
        y_train, y_val = y_aligned.loc[X_train_df.index], y_aligned.loc[X_val_df.index]

        wrapper.fit(X_train_df.values, y_train.values)
        preds_val = wrapper.predict_one(X_val_df.values)
    else:
        y_train, y_val = _split_time(y_full)
        wrapper.fit(y_train.values)
        preds_val = wrapper.predict(len(y_val))

    # Metrics on validation
    m = float(mae(y_val.values, preds_val))
    r = float(rmse(y_val.values, preds_val))

    # Retrain on full data for the saved artifact
    if need_features:
        wrapper_full = _build_wrapper(model_type, req.hyperparams)
        wrapper_full.fit(features_df.values, y_full.loc[features_df.index].values)
    else:
        wrapper_full = _build_wrapper(model_type, req.hyperparams)
        wrapper_full.fit(y_full.values)

    # Persist artifact
    model_id = str(uuid.uuid4())
    artifact_path = settings.models_path / f"{model_id}.pkl"
    artifact_data = {
        "wrapper": wrapper_full,
        "model_type": model_type,
        "target": target_str,
        "symbol": symbol,
        "timeframe": req.timeframe.value,
        "feature_config": feat_cfg,
        "hyperparams": req.hyperparams,
        "last_close": float(close.iloc[-1]),
        "last_values": close.tail(100).tolist(),
        "last_index": [t.isoformat() for t in close.tail(100).index],
    }
    joblib.dump(artifact_data, artifact_path)

    # Persist DB record
    now = datetime.now(timezone.utc)
    row = TrainedModelRow(
        id=model_id,
        symbol=symbol,
        timeframe=req.timeframe.value,
        model_type=model_type,
        target_type=target_str,
        config_json={
            "features": feat_cfg,
            "hyperparams": req.hyperparams,
        },
        metrics_json={"mae": round(m, 6), "rmse": round(r, 6)},
        artifact_path=str(artifact_path),
        trained_at=now,
    )
    db.add(row)
    await db.commit()

    log.info("model.trained", model_id=model_id, model_type=model_type, mae=m, rmse=r)

    return TrainResponse(
        modelId=model_id,
        model=ModelTypeEnum(model_type),
        trainedAt=now.isoformat(),
        metricsPreview=MetricsPreview(mae=round(m, 6), rmse=round(r, 6)),
    )


async def list_models(
    db: AsyncSession,
    symbol: str,
) -> list[TrainResponse]:
    """List all trained models for a symbol."""
    stmt = (
        select(TrainedModelRow)
        .where(TrainedModelRow.symbol == symbol)
        .order_by(TrainedModelRow.trained_at.desc())
        .limit(100)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    return [
        TrainResponse(
            modelId=r.id,
            model=ModelTypeEnum(r.model_type),
            trainedAt=r.trained_at.isoformat() if r.trained_at else "",
            metricsPreview=MetricsPreview(**r.metrics_json) if r.metrics_json else None,
        )
        for r in rows
    ]


def _safe_path(file_path: str) -> Path | None:
    """Return resolved Path only if within the allowed artifacts directory."""
    p = Path(file_path).resolve()
    try:
        p.relative_to(settings.artifacts_path.resolve())
        return p
    except ValueError:
        log.warning("path.outside_artifacts", path=str(p))
        return None


async def delete_model(db: AsyncSession, model_id: str) -> bool:
    """Delete a trained model (DB + artifact)."""
    stmt = select(TrainedModelRow).where(TrainedModelRow.id == model_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None:
        return False

    if row.artifact_path:
        p = _safe_path(row.artifact_path)
        if p and p.exists():
            p.unlink()

    await db.execute(sql_delete(TrainedModelRow).where(TrainedModelRow.id == model_id))
    await db.commit()
    return True


async def forecast(
    db: AsyncSession,
    model_id: str,
    horizon: int,
) -> list[ForecastPoint]:
    """Generate forecast from a trained model."""
    stmt = select(TrainedModelRow).where(TrainedModelRow.id == model_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None:
        raise ValueError(f"Model {model_id} not found")

    artifact_path = _safe_path(row.artifact_path)
    if artifact_path is None:
        raise ValueError("Model artifact path is invalid.")
    if not artifact_path.exists():
        raise ValueError(f"Model artifact not found.")

    artifact = joblib.load(artifact_path)
    wrapper = artifact["wrapper"]
    model_type = artifact["model_type"]
    target = artifact["target"]
    timeframe = artifact["timeframe"]
    last_close = artifact["last_close"]
    last_values = artifact["last_values"]

    last_time = pd.Timestamp(artifact["last_index"][-1])
    if timeframe == "1D":
        future_times = next_business_days(last_time.to_pydatetime(), horizon)
    elif timeframe == "4H":
        future_times = next_hours(last_time.to_pydatetime(), horizon, step_hours=4)
    else:
        future_times = next_hours(last_time.to_pydatetime(), horizon, step_hours=1)

    points: list[ForecastPoint] = []
    is_return_target = target == "log_return"

    def _to_price(pred_return: float, prev_close: float) -> float:
        """Convert a log-return prediction back to price level."""
        return prev_close * np.exp(pred_return)

    if model_type in ("Naive", "MovingAverage"):
        preds = wrapper.predict(horizon)
        running_close = last_close
        for i, t in enumerate(future_times):
            time_str = to_iso_date(t) if timeframe == "1D" else t.isoformat()
            if is_return_target:
                running_close = _to_price(float(preds[i]), running_close)
                points.append(ForecastPoint(time=time_str, predicted=round(running_close, 6)))
            else:
                points.append(ForecastPoint(time=time_str, predicted=round(float(preds[i]), 6)))

    elif model_type == "ARIMA":
        if hasattr(wrapper, "predict_with_ci"):
            mean, ci = wrapper.predict_with_ci(horizon)
            running_close = last_close
            for i, t in enumerate(future_times):
                time_str = to_iso_date(t) if timeframe == "1D" else t.isoformat()
                if is_return_target:
                    pred_price = _to_price(float(mean[i]), running_close)
                    lower_price = _to_price(float(ci[i, 0]), running_close)
                    upper_price = _to_price(float(ci[i, 1]), running_close)
                    running_close = pred_price
                    points.append(ForecastPoint(
                        time=time_str,
                        predicted=round(pred_price, 6),
                        lower=round(lower_price, 6),
                        upper=round(upper_price, 6),
                    ))
                else:
                    points.append(ForecastPoint(
                        time=time_str,
                        predicted=round(float(mean[i]), 6),
                        lower=round(float(ci[i, 0]), 6),
                        upper=round(float(ci[i, 1]), 6),
                    ))
        else:
            preds = wrapper.predict(horizon)
            running_close = last_close
            for i, t in enumerate(future_times):
                time_str = to_iso_date(t) if timeframe == "1D" else t.isoformat()
                if is_return_target:
                    running_close = _to_price(float(preds[i]), running_close)
                    points.append(ForecastPoint(time=time_str, predicted=round(running_close, 6)))
                else:
                    points.append(ForecastPoint(time=time_str, predicted=round(float(preds[i]), 6)))

    elif model_type in ("Ridge", "RandomForest"):
        # Recursive single-step forecasting using full feature set
        feat_cfg = artifact.get("feature_config", {})
        num_lags = feat_cfg.get("numLags", 5) if feat_cfg.get("lagReturns") else 5
        # Need enough history for indicators (SMA=20, EMA=20, MACD=26, RSI=14)
        min_history = max(num_lags + 1, 50)
        recent = np.array(last_values[-min_history:], dtype=float)

        for i, t in enumerate(future_times):
            # Build full feature vector from recent prices.
            # Append a dummy (NaN) entry so that .shift(1) on indicators
            # at the dummy index returns the indicator value computed at
            # the last *known* close — giving us a proper 1-step-ahead
            # feature vector without data leakage.
            recent_with_dummy = np.append(recent, np.nan)
            recent_series = pd.Series(recent_with_dummy, name="close")
            feat_df = build_features(recent_series, feat_cfg)
            feat_df = feat_df.dropna()

            if feat_df.empty:
                # Fallback: use only lag returns if full features unavailable
                log_rets = np.diff(np.log(recent))
                lag_feats = log_rets[-num_lags:][::-1].reshape(1, -1)
                pred = wrapper.predict_one(lag_feats)[0]
            else:
                # Use the last row of features for prediction
                pred = wrapper.predict_one(feat_df.iloc[[-1]].values)[0]

            if is_return_target:
                pred_price = _to_price(float(pred), recent[-1])
            else:
                pred_price = float(pred)

            recent = np.append(recent, pred_price)
            time_str = to_iso_date(t) if timeframe == "1D" else t.isoformat()
            points.append(ForecastPoint(time=time_str, predicted=round(float(pred_price), 6)))

    return points

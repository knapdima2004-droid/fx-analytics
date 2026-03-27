"""AI-Enhanced Ensemble prediction service.

Algorithm: Adaptive model selection with cross-window learning.
1. First window (no prior): follow Naive baseline.
2. Subsequent windows: follow the model with the best prior DA (from
   the previous window), with mid-window switching when cumulative
   rolling DA strongly favours a different model.
3. Prior DA is updated after each window for the next one.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import numpy as np

from app.core.config import settings
from app.core.logging_config import get_logger

log = get_logger(__name__)

_MAX_CONCURRENT = 8
_SEMAPHORE = asyncio.Semaphore(_MAX_CONCURRENT)

_RATE_LIMIT_THRESHOLD = 5
_consecutive_429 = 0
_rate_limited = False

_NAME_ALIASES: dict[str, str] = {
    "MA": "MovingAverage",
    "Moving Average": "MovingAverage",
    "moving_average": "MovingAverage",
    "movingaverage": "MovingAverage",
    "RF": "RandomForest",
    "Random Forest": "RandomForest",
    "random_forest": "RandomForest",
    "randomforest": "RandomForest",
    "naive": "Naive",
    "arima": "ARIMA",
    "Arima": "ARIMA",
    "ridge": "Ridge",
}


def _reset_circuit_breaker():
    global _consecutive_429, _rate_limited
    _consecutive_429 = 0
    _rate_limited = False


# ---------------------------------------------------------------------------
# Public API — Adaptive Model Selection
# ---------------------------------------------------------------------------

_SWITCH_THRESHOLD = 0.25  # 25pp rolling DA advantage to override prior leader
_SWITCH_MIN_BARS = 15     # need at least 15 bars before considering mid-window switch


async def predict_step(
    pair: str,
    recent_closes: list[float],
    base_predictions: dict[str, float],
    indicators: dict[str, float],
    recent_errors: dict[str, list[float]] | None = None,
    recent_da: dict[str, float] | None = None,
    prior_da: dict[str, float] | None = None,
    step_label: str = "",
    window_leader: str | None = None,
) -> dict[str, Any]:
    """Adaptive model selection: prior-based leader + mid-window override."""

    last = recent_closes[-1] if recent_closes else 0.0
    model_names = list(base_predictions.keys())

    has_prior = prior_da is not None and len(prior_da) > 0

    # Determine the window-level leader from prior DA
    if not has_prior:
        leader = "Naive" if "Naive" in base_predictions else model_names[0]
    else:
        leader = max(model_names, key=lambda m: prior_da.get(m, 0.5))

    # Mid-window adaptation: switch if cumulative rolling DA strongly disagrees
    n_samples = 0
    if recent_errors:
        sample_lens = [len(v) for v in recent_errors.values() if v]
        n_samples = max(sample_lens) if sample_lens else 0

    if n_samples >= _SWITCH_MIN_BARS and recent_da:
        rolling_best = max(model_names, key=lambda m: recent_da.get(m, 0.5))
        rolling_best_da = recent_da.get(rolling_best, 0.5)
        current_da = recent_da.get(leader, 0.5)
        if rolling_best_da - current_da >= _SWITCH_THRESHOLD:
            log.debug("ai_ensemble.mid_window_switch",
                      from_model=leader, to_model=rolling_best,
                      gap=f"{rolling_best_da - current_da:.1%}",
                      current_da=f"{current_da:.1%}")
            leader = rolling_best

    predicted = base_predictions[leader]
    weights = {m: (1.0 if m == leader else 0.0) for m in model_names}

    return {
        "predicted_close": predicted,
        "confidence": 0.5,
        "weights": weights,
        "direction": "up" if predicted > last else "down",
        "reasoning": f"Leader: {leader} (n={n_samples})",
    }


async def predict_batch(
    pair: str,
    all_contexts: list[dict],
) -> list[dict[str, Any]]:
    """Predict multiple steps concurrently."""
    tasks = [
        predict_step(
            pair=pair,
            recent_closes=ctx["recent_closes"],
            base_predictions=ctx["base_predictions"],
            indicators=ctx["indicators"],
            recent_errors=ctx.get("recent_errors"),
            recent_da=ctx.get("recent_da"),
            prior_da=ctx.get("prior_da"),
            step_label=ctx.get("step_label", ""),
        )
        for ctx in all_contexts
    ]
    return await asyncio.gather(*tasks)


# ---------------------------------------------------------------------------
# Technical indicators
# ---------------------------------------------------------------------------

def compute_indicators(close_array: np.ndarray) -> dict[str, float]:
    """Compute a compact set of indicators from a close-price array."""
    if len(close_array) < 26:
        return {}

    c = close_array.astype(float)
    indicators: dict[str, float] = {}

    indicators["SMA_20"] = float(np.mean(c[-20:]))

    ema = float(c[-20])
    alpha = 2.0 / 21.0
    for p in c[-19:]:
        ema = alpha * float(p) + (1 - alpha) * ema
    indicators["EMA_20"] = round(ema, 6)

    period = 14
    if len(c) >= period + 1:
        deltas = np.diff(c[-(period + 1):])
        gains = np.maximum(deltas, 0)
        losses = np.maximum(-deltas, 0)
        alpha_w = 1.0 / period
        avg_gain = float(gains[0])
        avg_loss = float(losses[0])
        for k in range(1, len(gains)):
            avg_gain = alpha_w * float(gains[k]) + (1 - alpha_w) * avg_gain
            avg_loss = alpha_w * float(losses[k]) + (1 - alpha_w) * avg_loss
        rs = avg_gain / max(avg_loss, 1e-10)
        indicators["RSI_14"] = round(100 - 100 / (1 + rs), 2)

    sma20 = np.mean(c[-20:])
    std20 = np.std(c[-20:])
    if std20 > 0:
        indicators["Bollinger_pct"] = round(
            (c[-1] - sma20) / (2 * std20), 4
        )
    else:
        indicators["Bollinger_pct"] = 0.0

    if len(c) >= 21:
        rets = np.diff(np.log(c[-21:]))
        indicators["Volatility_20"] = round(float(np.std(rets)), 6)

    if len(c) >= 26:
        def _ema(arr, span):
            a = 2.0 / (span + 1.0)
            val = float(arr[0])
            for p in arr[1:]:
                val = a * float(p) + (1 - a) * val
            return val
        ema12 = _ema(c[-12:], 12)
        ema26 = _ema(c[-26:], 26)
        indicators["MACD"] = round(ema12 - ema26, 6)

    if len(c) >= 6:
        indicators["Momentum_5"] = round((c[-1] / c[-6] - 1) * 100, 4)

    return indicators

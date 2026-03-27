"""Prediction quality metrics and statistical tests."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sp_stats
from statsmodels.tsa.stattools import adfuller
from statsmodels.stats.diagnostic import acorr_ljungbox


def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    yt = np.asarray(y_true, dtype=float).ravel()
    yp = np.asarray(y_pred, dtype=float).ravel()
    n = min(len(yt), len(yp))
    diff = np.abs(yt[:n] - yp[:n])
    mask = ~np.isnan(diff)
    if mask.sum() == 0:
        return float("nan")
    return float(np.mean(diff[mask]))


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    yt = np.asarray(y_true, dtype=float).ravel()
    yp = np.asarray(y_pred, dtype=float).ravel()
    n = min(len(yt), len(yp))
    sq = (yt[:n] - yp[:n]) ** 2
    mask = ~np.isnan(sq)
    if mask.sum() == 0:
        return float("nan")
    return float(np.sqrt(np.mean(sq[mask])))


def directional_accuracy(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Fraction of times the predicted direction matches actual direction.

    For each step t (t >= 1):
      actual direction = sign(y_true[t] - y_true[t-1])
      predicted direction = sign(y_pred[t] - y_true[t-1])

    This correctly handles multi-step forecasts by comparing each prediction
    against the previous *actual* value, rather than against the previous
    *predicted* value.
    """
    y_t = np.asarray(y_true, dtype=float).ravel()
    y_p = np.asarray(y_pred, dtype=float).ravel()
    n = min(len(y_t), len(y_p))
    if n < 2:
        return 0.0
    y_t, y_p = y_t[:n], y_p[:n]
    actual_dir = np.sign(y_t[1:] - y_t[:-1])
    pred_dir = np.sign(y_p[1:] - y_t[:-1])
    mask = actual_dir != 0  # ignore flat periods
    if int(mask.sum()) == 0:
        return 0.0
    return float(np.mean(actual_dir[mask] == pred_dir[mask]))


# ─── Statistical tests ──────────────────────────────────────────────────────

def adf_test(series: pd.Series) -> dict:
    """Augmented Dickey-Fuller test for stationarity."""
    clean = series.dropna()
    if len(clean) < 20:
        return {"statistic": 0.0, "pValue": 1.0, "isStationary": False}
    result = adfuller(clean, autolag="AIC")
    p_val = float(result[1])
    return {
        "statistic": round(float(result[0]), 6),
        "pValue": round(max(p_val, 1e-10), 6),  # avoid exact 0.0
        "isStationary": bool(p_val < 0.05),
    }


def ljung_box_test(residuals: pd.Series, lags: int | None = None) -> dict:
    """Ljung-Box test for autocorrelation in residuals.

    If *lags* is not given, it is set to min(10, len(residuals)//5) which
    keeps the Q-statistic well-scaled for both small and very large samples.
    """
    clean = residuals.dropna()
    if lags is None:
        lags = min(10, max(1, len(clean) // 5))
    if len(clean) < lags + 1:
        return {"statistic": 0.0, "pValue": 1.0, "noAutocorrelation": True}
    result = acorr_ljungbox(clean, lags=[lags], return_df=True)
    stat = float(result["lb_stat"].iloc[0])
    p_val = float(result["lb_pvalue"].iloc[0])
    return {
        "statistic": round(stat, 4),
        "pValue": round(float(max(p_val, 1e-10)), 6),  # avoid exact 0.0
        "noAutocorrelation": bool(p_val > 0.05),
    }


def diebold_mariano_test(
    e1: np.ndarray,
    e2: np.ndarray,
    model1_name: str,
    model2_name: str,
) -> dict:
    """Diebold-Mariano test comparing two sets of forecast errors.

    Uses squared-error loss differential: d_t = e1_t^2 - e2_t^2.
    H0: equal predictive accuracy.

    Includes Newey-West (HAC) variance estimator with h-1 truncation lag
    to account for autocorrelation in the loss differentials.
    """
    e1_flat = np.asarray(e1, dtype=float).ravel()
    e2_flat = np.asarray(e2, dtype=float).ravel()
    n = min(len(e1_flat), len(e2_flat))
    d = e1_flat[:n] ** 2 - e2_flat[:n] ** 2

    # Drop NaN values
    mask = ~np.isnan(d)
    d = d[mask]
    n = len(d)

    if n < 5:
        return {"statistic": 0.0, "pValue": 1.0, "betterModel": None}
    d_mean = float(np.mean(d))

    # HAC variance (Newey-West with h-1 lags, h=1 for 1-step-ahead)
    h = 1
    gamma_0 = float(np.mean((d - d_mean) ** 2))
    hac_var = gamma_0
    for k in range(1, h):
        w = 1.0 - k / h
        gamma_k = float(np.mean((d[k:] - d_mean) * (d[:-k] - d_mean)))
        hac_var += 2 * w * gamma_k
    d_var = hac_var / n

    if d_var <= 0:
        return {"statistic": 0.0, "pValue": 1.0, "betterModel": None}
    dm_stat = d_mean / np.sqrt(d_var)
    p_value = 2.0 * (1.0 - sp_stats.t.cdf(abs(dm_stat), df=n - 1))
    better = None
    if p_value < 0.05:
        better = model2_name if d_mean > 0 else model1_name
    return {
        "statistic": round(float(dm_stat), 6),
        "pValue": round(float(p_value), 6),
        "betterModel": better,
    }

"""Technical indicator computation for feature engineering."""

from __future__ import annotations

import numpy as np
import pandas as pd


def sma(series: pd.Series, period: int = 20) -> pd.Series:
    """Simple Moving Average."""
    return series.rolling(window=period, min_periods=period).mean()


def ema(series: pd.Series, period: int = 20) -> pd.Series:
    """Exponential Moving Average."""
    return series.ewm(span=period, adjust=False).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder)."""
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def macd(
    series: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """MACD line, signal line, histogram."""
    fast_ema = ema(series, fast)
    slow_ema = ema(series, slow)
    macd_line = fast_ema - slow_ema
    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def build_features(
    close: pd.Series,
    feature_config: dict,
) -> pd.DataFrame:
    """Build feature DataFrame from close prices and config.

    Parameters
    ----------
    close : pd.Series
        Close prices indexed by datetime.
    feature_config : dict
        Keys: lagReturns, numLags, sma, ema, rsi, macd (booleans / ints).

    Returns
    -------
    pd.DataFrame
        Feature matrix (rows with NaN from rolling windows are dropped).
    """
    features = pd.DataFrame(index=close.index)
    log_ret = np.log(close / close.shift(1))

    if feature_config.get("lagReturns", False):
        num_lags = feature_config.get("numLags", 5)
        for i in range(1, num_lags + 1):
            features[f"lag_ret_{i}"] = log_ret.shift(i)

    # ── IMPORTANT: All indicator features are shifted by 1 period ──────────
    # At prediction time t we may only use information available up to t-1.
    # Without the shift, SMA_20 at row t includes close[t] — the very value
    # we are trying to predict — which constitutes data leakage and leads to
    # unrealistically high metrics (e.g. DA > 80 %).
    # Lag returns are already correctly shifted (shift(i), i >= 1).

    if feature_config.get("sma", False):
        features["sma_20"] = sma(close, 20).shift(1)

    if feature_config.get("ema", False):
        features["ema_20"] = ema(close, 20).shift(1)

    if feature_config.get("rsi", False):
        features["rsi_14"] = rsi(close, 14).shift(1)

    if feature_config.get("macd", False):
        m_line, s_line, hist = macd(close)
        features["macd_line"] = m_line.shift(1)
        features["macd_signal"] = s_line.shift(1)
        features["macd_hist"] = hist.shift(1)

    return features

"""Data quality validation for OHLC bars.

Checks performed:
1. Invalid bars (high < low, close/open outside H-L range, non-positive prices)
2. Duplicate timestamps
3. Missing trading days (weekday gaps)
4. Outlier detection (price jumps > 3 std)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from app.core.logging_config import get_logger

log = get_logger(__name__)


def validate_ohlc_dataframe(df: pd.DataFrame) -> dict[str, Any]:
    """Validate an OHLC DataFrame and return quality report.

    Parameters
    ----------
    df : pd.DataFrame
        Must have columns: Open, High, Low, Close (and optionally Volume).
        Index must be DatetimeIndex.

    Returns
    -------
    dict with:
        total_bars, invalid_bars, invalid_bar_details,
        duplicate_timestamps, missing_weekdays, missing_weekday_dates,
        outlier_count, quality_score (0-100)
    """
    report: dict[str, Any] = {
        "total_bars": len(df),
        "invalid_bars": 0,
        "invalid_bar_details": [],
        "duplicate_timestamps": 0,
        "missing_weekdays": 0,
        "missing_weekday_dates": [],
        "outlier_count": 0,
        "quality_score": 100.0,
    }

    if df.empty:
        report["quality_score"] = 0.0
        return report

    # Normalize column names
    cols = {c.lower(): c for c in df.columns}
    open_col = cols.get("open", "Open")
    high_col = cols.get("high", "High")
    low_col = cols.get("low", "Low")
    close_col = cols.get("close", "Close")

    # 1. Check for invalid bars
    invalid_mask = (
        (df[high_col] < df[low_col]) |
        (df[close_col] < df[low_col] * 0.99) |  # 1% tolerance for floating point
        (df[close_col] > df[high_col] * 1.01) |
        (df[open_col] < df[low_col] * 0.99) |
        (df[open_col] > df[high_col] * 1.01) |
        (df[close_col] <= 0) |
        (df[open_col] <= 0)
    )
    invalid_count = int(invalid_mask.sum())
    report["invalid_bars"] = invalid_count
    if invalid_count > 0:
        invalid_dates = df.index[invalid_mask].strftime("%Y-%m-%d").tolist()[:10]
        report["invalid_bar_details"] = invalid_dates

    # 2. Check for duplicate timestamps
    dup_count = int(df.index.duplicated().sum())
    report["duplicate_timestamps"] = dup_count

    # 3. Check for missing weekdays
    if len(df) > 1:
        full_bdays = pd.bdate_range(start=df.index.min(), end=df.index.max())
        actual_dates = pd.DatetimeIndex(df.index.date)
        full_dates = pd.DatetimeIndex(full_bdays.date)
        missing = full_dates.difference(actual_dates)
        report["missing_weekdays"] = len(missing)
        report["missing_weekday_dates"] = [d.strftime("%Y-%m-%d") for d in missing[:20]]

    # 4. Check for outliers (price jumps > 3 std of returns)
    if len(df) > 10:
        returns = np.log(df[close_col] / df[close_col].shift(1)).dropna()
        std = returns.std()
        mean = returns.mean()
        outliers = ((returns - mean).abs() > 3 * std).sum()
        report["outlier_count"] = int(outliers)

    # Compute quality score (0-100)
    total = report["total_bars"]
    penalties = 0
    if total > 0:
        penalties += (report["invalid_bars"] / total) * 30
        penalties += (report["duplicate_timestamps"] / total) * 20
        penalties += min(report["missing_weekdays"] / max(total, 1), 1) * 30
        penalties += (report["outlier_count"] / total) * 20
    report["quality_score"] = round(max(0, 100 - penalties * 100), 1)

    log.info(
        "data_validation.done",
        bars=total,
        invalid=report["invalid_bars"],
        missing=report["missing_weekdays"],
        outliers=report["outlier_count"],
        score=report["quality_score"],
    )

    return report

"""OHLC data retrieval service."""

from __future__ import annotations

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orm import OHLCBarRow
from app.schemas.schemas import OHLCBar
from app.utils.time_helpers import parse_date


def _normalize_trading_dates(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Normalize timestamps to the correct trading-day date.

    yfinance daily FX bars arrive with CET/CEST timestamps. After the
    ingestion service converts them to UTC, midnight CET becomes 23:00 UTC
    the *previous* calendar day.  For example Monday 00:00 CET → Sunday
    23:00 UTC, making the date appear one day early.

    Fix: if hour >= 20, shift forward to the next calendar day midnight.
    This restores the original CET date for all bars.  Saturday bars
    (genuine non-trading) are dropped.
    """
    result = []
    for ts in idx:
        if ts.weekday() == 5:
            continue
        if ts.hour >= 20:
            ts = ts.normalize() + pd.Timedelta(days=1)
        else:
            ts = ts.normalize()
        result.append(ts)
    return pd.DatetimeIndex(result)


async def get_ohlc(
    db: AsyncSession,
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
) -> list[OHLCBar]:
    """Retrieve OHLC bars from DB for the given range."""
    start_dt = parse_date(start)
    end_dt = parse_date(end, end_of_day=True)

    MAX_OHLC_ROWS = 50_000
    stmt = (
        select(OHLCBarRow)
        .where(
            OHLCBarRow.symbol == symbol,
            OHLCBarRow.timeframe == timeframe,
            OHLCBarRow.time >= start_dt,
            OHLCBarRow.time <= end_dt,
        )
        .order_by(OHLCBarRow.time.asc())
        .limit(MAX_OHLC_ROWS)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    is_daily = timeframe == "1D"

    bars = []
    seen_dates: set[str] = set()
    for row in rows:
        ts = row.time
        if ts.weekday() == 5:
            continue
        if ts.weekday() == 6 and ts.hour >= 17:
            ts = ts + pd.Timedelta(hours=24 - ts.hour)
        date_key = ts.strftime("%Y-%m-%d") if is_daily else str(int(ts.timestamp()))
        if date_key in seen_dates:
            continue
        seen_dates.add(date_key)
        bars.append(
            OHLCBar(
                time=date_key,
                open=round(row.open, 6),
                high=round(row.high, 6),
                low=round(row.low, 6),
                close=round(row.close, 6),
                volume=row.volume,
            )
        )
    return bars


async def get_close_series(
    db: AsyncSession,
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
) -> pd.Series:
    """Return a pandas Series of close prices indexed by datetime."""
    start_dt = parse_date(start)
    end_dt = parse_date(end, end_of_day=True)

    stmt = (
        select(OHLCBarRow.time, OHLCBarRow.close)
        .where(
            OHLCBarRow.symbol == symbol,
            OHLCBarRow.timeframe == timeframe,
            OHLCBarRow.time >= start_dt,
            OHLCBarRow.time <= end_dt,
        )
        .order_by(OHLCBarRow.time.asc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        return pd.Series(dtype=float)

    times = [r[0] for r in rows]
    closes = [r[1] for r in rows]
    norm_idx = _normalize_trading_dates(pd.DatetimeIndex(times))
    closes = [closes[i] for i, ts in enumerate(pd.DatetimeIndex(times)) if ts.weekday() != 5]
    s = pd.Series(closes, index=norm_idx, name="close")
    s = s[s.index.weekday < 5]
    return s[~s.index.duplicated(keep="last")]


async def get_ohlc_dataframe(
    db: AsyncSession,
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
) -> pd.DataFrame:
    """Return a pandas DataFrame with OHLC columns indexed by datetime."""
    start_dt = parse_date(start)
    end_dt = parse_date(end, end_of_day=True)

    stmt = (
        select(
            OHLCBarRow.time,
            OHLCBarRow.open,
            OHLCBarRow.high,
            OHLCBarRow.low,
            OHLCBarRow.close,
            OHLCBarRow.volume,
        )
        .where(
            OHLCBarRow.symbol == symbol,
            OHLCBarRow.timeframe == timeframe,
            OHLCBarRow.time >= start_dt,
            OHLCBarRow.time <= end_dt,
        )
        .order_by(OHLCBarRow.time.asc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"])
    df.set_index("time", inplace=True)
    df = df[df.index.weekday != 5]
    df.index = _normalize_trading_dates(df.index)
    df = df[df.index.weekday < 5]
    return df[~df.index.duplicated(keep="last")]

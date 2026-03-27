"""FX data ingestion from yfinance.

yfinance provides free OHLC data for FX pairs via Yahoo Finance.
Ticker format: EURUSD=X, USDJPY=X, etc.

Intraday data limits (yfinance):
  - 1m:  max 7 days
  - 5m:  max 60 days
  - 15m: max 60 days
  - 30m: max 60 days
  - 1h:  max 730 days
  - 1d:  unlimited
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import yfinance as yf
from sqlalchemy import select, func
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging_config import get_logger
from app.models.orm import OHLCBarRow, DataUpdateRow
from app.schemas.schemas import DataSummary

log = get_logger(__name__)

# ─── Symbol mapping ──────────────────────────────────────────────────────────

YFINANCE_TICKER = {
    "EURUSD": "EURUSD=X",
    "USDJPY": "USDJPY=X",
    "GBPUSD": "GBPUSD=X",
    "EURGBP": "EURGBP=X",
    "USDCHF": "USDCHF=X",
}

# yfinance interval mapping + max history days
YF_INTERVAL = {
    "1D": ("1d", 10000),
    "4H": ("1h", 730),     # fetch 1h, aggregate to 4h
    "1H": ("1h", 730),
    "30M": ("30m", 60),
    "15M": ("15m", 60),
    "5M": ("5m", 60),
    "1M": ("1m", 7),
}

# Timeframes that need aggregation
AGGREGATE_MAP = {
    "4H": "4h",
}


def _to_yf_ticker(symbol: str) -> str:
    ticker = YFINANCE_TICKER.get(symbol.upper())
    if ticker is None:
        raise ValueError(f"Unsupported symbol: {symbol}")
    return ticker


def _aggregate(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    """Resample OHLC bars to a larger timeframe."""
    if df.empty:
        return df
    agg = df.resample(rule).agg({
        "Open": "first",
        "High": "max",
        "Low": "min",
        "Close": "last",
        "Volume": "sum",
    }).dropna(subset=["Open"])
    return agg


def _clamp_date_range(start: str, end: str, max_days: int) -> tuple[str, str]:
    """Clamp the start date to respect yfinance history limits."""
    end_dt = datetime.strptime(end, "%Y-%m-%d")
    start_dt = datetime.strptime(start, "%Y-%m-%d")
    earliest_allowed = end_dt - timedelta(days=max_days - 1)
    if start_dt < earliest_allowed:
        start_dt = earliest_allowed
    return start_dt.strftime("%Y-%m-%d"), end


# ─── Public API ───────────────────────────────────────────────────────────────

async def fetch_and_store(
    db: AsyncSession,
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
) -> DataSummary:
    """Download OHLC data from yfinance and upsert into the database."""
    ticker_str = _to_yf_ticker(symbol)
    interval_info = YF_INTERVAL.get(timeframe)
    if interval_info is None:
        raise ValueError(f"Unsupported timeframe: {timeframe}")

    yf_interval, max_days = interval_info

    log.info("ingestion.start", symbol=symbol, timeframe=timeframe, start=start, end=end)

    # Clamp date range for intraday limitations
    clamped_start, clamped_end = _clamp_date_range(start, end, max_days)

    # Never request future dates — yfinance returns flat/empty data for future
    today = datetime.now(timezone.utc).date().isoformat()
    if clamped_end > today:
        clamped_end = today
    if clamped_start > clamped_end:
        clamped_start = clamped_end

    # yfinance end date is exclusive, so add 1 day
    end_dt = datetime.strptime(clamped_end, "%Y-%m-%d") + timedelta(days=1)
    end_adj = end_dt.strftime("%Y-%m-%d")

    # Use yf.download for intraday — sometimes returns better FX data than Ticker.history
    df = pd.DataFrame()
    if yf_interval != "1d":
        try:
            df = yf.download(
                ticker_str,
                start=clamped_start,
                end=end_adj,
                interval=yf_interval,
                auto_adjust=True,
                progress=False,
                prepost=False,
                threads=False,
            )
            if not df.empty and isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
        except Exception as e:
            log.warning("ingestion.download_fallback", error=str(e))

    if yf_interval == "1d" or df.empty:
        ticker = yf.Ticker(ticker_str)
        df = ticker.history(
            start=clamped_start,
            end=end_adj,
            interval=yf_interval,
            auto_adjust=True,
        )

    if df.empty:
        db.add(DataUpdateRow(
            symbol=symbol, timeframe=timeframe, start=start, end=end,
            status="error", message="No data returned from yfinance",
        ))
        await db.commit()
        raise ValueError(f"No data returned from yfinance for {symbol} ({timeframe}) {start}–{end}")

    # Aggregate if needed (e.g., 4H from 1H)
    if timeframe in AGGREGATE_MAP:
        df = _aggregate(df, AGGREGATE_MAP[timeframe])

    if df.empty:
        raise ValueError("No data after aggregation")

    # Ensure timezone-aware index
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    else:
        df.index = df.index.tz_convert("UTC")

    # Prepare rows for upsert
    rows = []
    for ts, row in df.iterrows():
        rows.append({
            "symbol": symbol,
            "timeframe": timeframe,
            "time": ts.to_pydatetime(),
            "open": round(float(row["Open"]), 6),
            "high": round(float(row["High"]), 6),
            "low": round(float(row["Low"]), 6),
            "close": round(float(row["Close"]), 6),
            "volume": float(row.get("Volume", 0)) if not np.isnan(row.get("Volume", 0)) else None,
            "source": "yfinance",
        })

    # SQLite batch upsert (ON CONFLICT DO UPDATE) in chunks for performance
    BATCH_SIZE = 500
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        stmt = sqlite_insert(OHLCBarRow).values(batch)
        stmt = stmt.on_conflict_do_update(
            index_elements=["symbol", "timeframe", "time"],
            set_={
                "open": stmt.excluded.open,
                "high": stmt.excluded.high,
                "low": stmt.excluded.low,
                "close": stmt.excluded.close,
                "volume": stmt.excluded.volume,
                "source": stmt.excluded.source,
                "updated_at": func.now(),
            },
        )
        await db.execute(stmt)

    # Audit log
    db.add(DataUpdateRow(
        symbol=symbol, timeframe=timeframe, start=start, end=end,
        status="ok", message=f"Upserted {len(rows)} bars",
    ))
    await db.commit()

    log.info("ingestion.done", symbol=symbol, rows=len(rows))

    return await get_data_summary(db, symbol, timeframe)


async def get_data_summary(
    db: AsyncSession,
    symbol: str,
    timeframe: str,
) -> DataSummary:
    """Compute summary statistics for stored OHLC data."""
    count_q = select(func.count(OHLCBarRow.id)).where(
        OHLCBarRow.symbol == symbol,
        OHLCBarRow.timeframe == timeframe,
    )
    rows_result = await db.execute(count_q)
    total_rows = rows_result.scalar() or 0

    if total_rows == 0:
        return DataSummary(
            rows=0, start="", end="", missing=0, duplicates=0,
            lastUpdated=datetime.now(timezone.utc).isoformat(),
        )

    min_q = select(func.min(OHLCBarRow.time)).where(
        OHLCBarRow.symbol == symbol, OHLCBarRow.timeframe == timeframe,
    )
    max_q = select(func.max(OHLCBarRow.time)).where(
        OHLCBarRow.symbol == symbol, OHLCBarRow.timeframe == timeframe,
    )
    start_dt = (await db.execute(min_q)).scalar()
    end_dt = (await db.execute(max_q)).scalar()

    missing = 0
    if timeframe == "1D" and start_dt and end_dt:
        expected = len(pd.bdate_range(start=start_dt, end=end_dt))
        missing = max(0, expected - total_rows)

    last_update_q = select(func.max(OHLCBarRow.updated_at)).where(
        OHLCBarRow.symbol == symbol, OHLCBarRow.timeframe == timeframe,
    )
    last_updated = (await db.execute(last_update_q)).scalar()

    return DataSummary(
        rows=total_rows,
        start=start_dt.strftime("%Y-%m-%d") if start_dt else "",
        end=end_dt.strftime("%Y-%m-%d") if end_dt else "",
        missing=missing,
        duplicates=0,
        lastUpdated=last_updated.isoformat() if last_updated else datetime.now(timezone.utc).isoformat(),
    )

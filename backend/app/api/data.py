"""Data endpoints: OHLC retrieval, summary, update, CSV export."""

from __future__ import annotations

import io
import csv

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.schemas import (
    DataSummary,
    OHLCBar,
    SUPPORTED_SYMBOLS,
    TimeframeEnum,
    UpdateDataRequest,
    UpdateDataResponse,
)
from app.services.ingestion import fetch_and_store, get_data_summary
from app.services.ohlc_service import get_ohlc, get_ohlc_dataframe
from app.services.data_validation import validate_ohlc_dataframe
from app.schemas.schemas import DataQualityReport

router = APIRouter()


def _validate_symbol(pair: str) -> str:
    sym = pair.upper()
    if sym not in SUPPORTED_SYMBOLS:
        raise HTTPException(400, f"Unsupported pair: {pair}. Supported: {', '.join(sorted(SUPPORTED_SYMBOLS))}")
    return sym


# ─── GET /data/ohlc ──────────────────────────────────────────────────────────

@router.get("/data/ohlc", response_model=list[OHLCBar])
async def get_ohlc_endpoint(
    pair: str = Query(...),
    timeframe: TimeframeEnum = Query(...),
    start: str = Query(...),
    end: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    symbol = _validate_symbol(pair)
    bars = await get_ohlc(db, symbol, timeframe.value, start, end)
    if not bars:
        all_bars = await get_ohlc(db, symbol, timeframe.value, "2000-01-01", "2099-12-31")
        if all_bars:
            return all_bars
        raise HTTPException(404, f"No data found for {symbol} ({timeframe.value}) {start}–{end}")
    return bars


# ─── GET /data/summary ───────────────────────────────────────────────────────

@router.get("/data/summary", response_model=DataSummary)
async def get_data_summary_endpoint(
    pair: str = Query(...),
    timeframe: TimeframeEnum = Query(...),
    db: AsyncSession = Depends(get_db),
):
    symbol = _validate_symbol(pair)
    return await get_data_summary(db, symbol, timeframe.value)


# ─── POST /data/update ───────────────────────────────────────────────────────

@router.post("/data/update", response_model=UpdateDataResponse)
async def update_data_endpoint(
    req: UpdateDataRequest,
    db: AsyncSession = Depends(get_db),
):
    symbol = _validate_symbol(req.pair)
    try:
        summary = await fetch_and_store(
            db, symbol, req.timeframe.value, req.start, req.end,
        )
        return UpdateDataResponse(ok=True, message="Data updated successfully", summary=summary)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        from app.core.logging_config import get_logger
        log = get_logger(__name__)
        log.warning("data.ingestion_failed_trying_cache", error=str(e))
        cached = await get_ohlc(db, symbol, req.timeframe.value, req.start, req.end)
        if cached:
            log.info("data.serving_cached", bars=len(cached))
            return UpdateDataResponse(
                ok=True,
                message=f"Offline: serving {len(cached)} cached bars",
                summary=None,
            )
        log.error("data.no_cache_available", error=str(e))
        raise HTTPException(500, "No internet connection and no cached data available.")


# ─── GET /data/export (CSV) ──────────────────────────────────────────────────

@router.get("/data/export")
async def export_csv_endpoint(
    pair: str = Query(...),
    timeframe: TimeframeEnum = Query(...),
    start: str = Query(...),
    end: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    symbol = _validate_symbol(pair)
    bars = await get_ohlc(db, symbol, timeframe.value, start, end)
    if not bars:
        raise HTTPException(404, "No data to export")

    def _stream():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["time", "open", "high", "low", "close", "volume"])
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        for bar in bars:
            writer.writerow([bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume if bar.volume is not None else ""])
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

    filename = f"{symbol}_{timeframe.value}_{start}_{end}.csv"
    return StreamingResponse(
        _stream(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── GET /data/quality ───────────────────────────────────────────────────

@router.get("/data/quality", response_model=DataQualityReport)
async def get_data_quality_endpoint(
    pair: str = Query(...),
    timeframe: TimeframeEnum = Query(...),
    start: str = Query(...),
    end: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Run data quality validation on stored OHLC data."""
    symbol = _validate_symbol(pair)
    df = await get_ohlc_dataframe(db, symbol, timeframe.value, start, end)
    if df.empty:
        raise HTTPException(404, "No data found for quality analysis")

    report = validate_ohlc_dataframe(df)
    return DataQualityReport(
        totalBars=report["total_bars"],
        invalidBars=report["invalid_bars"],
        invalidBarDetails=report["invalid_bar_details"],
        duplicateTimestamps=report["duplicate_timestamps"],
        missingWeekdays=report["missing_weekdays"],
        missingWeekdayDates=report["missing_weekday_dates"],
        outlierCount=report["outlier_count"],
        qualityScore=report["quality_score"],
    )

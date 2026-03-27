"""Statistical analysis interpretation API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.schemas.schemas import (
    AiAnalysisRequest,
    SUPPORTED_SYMBOLS,
)
from app.services.ai_analysis import analyze_results

router = APIRouter(tags=["Analysis"])


@router.post("/analysis/interpret")
async def interpret_results(
    req: AiAnalysisRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate automated statistical interpretation of backtest/forecast results.

    Produces a scientific-grade analysis suitable for thesis inclusion.
    Falls back to rule-based analysis if the external API key is not configured.
    """
    symbol = req.pair.upper().replace("/", "")
    if symbol not in SUPPORTED_SYMBOLS:
        raise HTTPException(400, f"Unsupported symbol: {symbol}")

    result = await analyze_results(
        pair=symbol,
        timeframe=req.timeframe.value,
        start=req.start,
        end=req.end,
        backtest_results=req.backtestResults,
        statistical_tests=req.statisticalTests,
        data_summary=req.dataSummary,
        forecast_data=req.forecastData,
        language=req.language or "en",
    )

    return result


@router.get("/analysis/status")
async def analysis_status():
    """Check if automated analysis service is available."""
    return {
        "available": bool(settings.OPENAI_API_KEY),
        "model": settings.OPENAI_MODEL if settings.OPENAI_API_KEY else None,
    }

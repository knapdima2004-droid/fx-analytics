"""Model training, listing, forecasting and deletion endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging_config import get_logger

log = get_logger(__name__)
from app.schemas.schemas import (
    ForecastPoint,
    ForecastRequest,
    SUPPORTED_SYMBOLS,
    TrainRequest,
    TrainResponse,
)
from app.services.model_service import (
    delete_model,
    forecast,
    list_models,
    train_model,
)

router = APIRouter()


@router.post("/models/train", response_model=TrainResponse)
async def train_model_endpoint(
    req: TrainRequest,
    db: AsyncSession = Depends(get_db),
):
    if req.pair.upper() not in SUPPORTED_SYMBOLS:
        raise HTTPException(400, f"Unsupported pair: {req.pair}")
    try:
        return await train_model(db, req)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.error("model.train_failed", error=str(e))
        raise HTTPException(500, "Model training failed due to an internal error.")


@router.get("/models", response_model=list[TrainResponse])
async def list_models_endpoint(
    pair: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    symbol = pair.upper()
    if symbol not in SUPPORTED_SYMBOLS:
        raise HTTPException(400, f"Unsupported pair: {pair}")
    return await list_models(db, symbol)


@router.post("/models/forecast", response_model=list[ForecastPoint])
async def forecast_endpoint(
    req: ForecastRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await forecast(db, req.modelId, req.horizon)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        log.error("model.forecast_failed", error=str(e))
        raise HTTPException(500, "Forecast failed due to an internal error.")


@router.post("/models/forecast-excel")
async def forecast_excel_endpoint(
    req: ForecastRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate a detailed Excel report for a model forecast."""
    from app.services.forecast_excel_service import generate_forecast_excel

    try:
        report_id, file_path, filename = await generate_forecast_excel(
            db, req.modelId, req.horizon,
        )
        return FileResponse(
            path=str(file_path),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=filename,
        )
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        log.error("model.forecast_excel_failed", error=str(e))
        raise HTTPException(500, "Forecast report generation failed due to an internal error.")


@router.delete("/models/{model_id}")
async def delete_model_endpoint(
    model_id: str,
    db: AsyncSession = Depends(get_db),
):
    ok = await delete_model(db, model_id)
    if not ok:
        raise HTTPException(404, f"Model {model_id} not found")
    return {"ok": True, "message": "Model deleted"}

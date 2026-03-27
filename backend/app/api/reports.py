"""Report endpoints."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.core.config import settings
from app.core.database import get_db
from app.core.logging_config import get_logger

log = get_logger(__name__)
from app.models.orm import BacktestRunRow
from app.schemas.schemas import (
    BacktestResponse,
    BacktestResult,
    StatisticalTests,
    GenerateReportRequest,
    ReportItem,
    SUPPORTED_SYMBOLS,
    TimeframeEnum,
)
from app.services.report_service import (
    delete_report,
    generate_report,
    get_report,
    list_reports,
)

router = APIRouter()


class ReportFromRunRequest(BaseModel):
    runId: str
    language: Optional[str] = "en"
    includeCharts: Optional[bool] = True
    includeTests: Optional[bool] = True


@router.get("/reports", response_model=list[ReportItem])
async def list_reports_endpoint(
    db: AsyncSession = Depends(get_db),
):
    return await list_reports(db)


@router.post("/reports/generate", response_model=ReportItem)
async def generate_report_endpoint(
    req: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
):
    if req.pair.upper() not in SUPPORTED_SYMBOLS:
        raise HTTPException(400, f"Unsupported pair: {req.pair}")
    try:
        return await generate_report(db, req)
    except Exception as e:
        log.error("report.generation_failed", error=str(e))
        raise HTTPException(500, "Report generation failed due to an internal error.")


@router.post("/reports/from-run", response_model=ReportItem)
async def generate_report_from_run(
    req: ReportFromRunRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate HTML + Excel report from an existing backtest run (no re-computation)."""
    # Load the backtest run from DB
    stmt = select(BacktestRunRow).where(BacktestRunRow.id == req.runId)
    result = await db.execute(stmt)
    run_row = result.scalar_one_or_none()

    if run_row is None:
        raise HTTPException(404, f"Backtest run {req.runId} not found")

    if not run_row.results_json or not run_row.tests_json:
        raise HTTPException(400, "Backtest run has no saved results")

    # Reconstruct BacktestResponse from stored JSON
    try:
        results = [BacktestResult(**r) for r in run_row.results_json]
        tests = StatisticalTests(**run_row.tests_json)
        bt_resp = BacktestResponse(
            runId=run_row.id,
            results=results,
            tests=tests,
        )
    except Exception as e:
        log.error("report.reconstruct_failed", error=str(e))
        raise HTTPException(500, "Failed to reconstruct backtest data.")

    # Build a GenerateReportRequest from the stored run metadata
    # Determine models from the stored results
    from app.schemas.schemas import ModelTypeEnum
    models = [ModelTypeEnum(r.model) for r in results]

    report_req = GenerateReportRequest(
        pair=run_row.symbol,
        timeframe=TimeframeEnum(run_row.timeframe),
        start=run_row.start,
        end=run_row.end,
        models=models,
        includeCharts=req.includeCharts,
        includeTests=req.includeTests,
        language=req.language,
    )

    try:
        return await generate_report(db, report_req, precomputed_bt_resp=bt_resp)
    except Exception as e:
        log.error("report.generation_failed", error=str(e))
        raise HTTPException(500, "Report generation failed due to an internal error.")


@router.get("/reports/{report_id}/download")
async def download_report_endpoint(
    report_id: str,
    db: AsyncSession = Depends(get_db),
):
    row = await get_report(db, report_id)
    if row is None:
        raise HTTPException(404, "Report not found")
    if row.status != "Ready":
        raise HTTPException(404, f"Report is not ready (status: {row.status})")
    if not row.file_path:
        raise HTTPException(404, "Report file path not set")

    file_path = Path(row.file_path)
    if not file_path.exists():
        raise HTTPException(404, "Report file not found on disk")

    # Security: ensure file is within artifacts directory
    try:
        file_path.resolve().relative_to(settings.artifacts_path.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")

    return FileResponse(
        path=str(file_path),
        media_type=row.content_type or "text/html",
        filename=f"report_{report_id}.html",
    )


@router.get("/reports/{report_id}/download-excel")
async def download_excel_report_endpoint(
    report_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Download the Excel version of a report (generated alongside HTML)."""
    row = await get_report(db, report_id)
    if row is None:
        raise HTTPException(404, "Report not found")
    if not row.excel_path:
        raise HTTPException(404, "Excel version not available for this report")

    file_path = Path(row.excel_path)
    if not file_path.exists():
        raise HTTPException(404, "Excel file not found on disk")

    try:
        file_path.resolve().relative_to(settings.artifacts_path.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")

    return FileResponse(
        path=str(file_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"report_{row.symbol}_{row.timeframe}_{report_id[:8]}.xlsx",
    )


@router.delete("/reports/{report_id}")
async def delete_report_endpoint(
    report_id: str,
    db: AsyncSession = Depends(get_db),
):
    ok = await delete_report(db, report_id)
    if not ok:
        raise HTTPException(404, "Report not found")
    return {"ok": True, "message": "Report deleted"}

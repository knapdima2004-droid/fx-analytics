"""Backtest endpoint with background task support and cancellation."""

from __future__ import annotations

import asyncio
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging_config import get_logger
from app.models.orm import BacktestRunRow
from app.schemas.schemas import BacktestRequest, BacktestResponse, SUPPORTED_SYMBOLS
from app.services.backtest_service import run_backtest

router = APIRouter()
log = get_logger(__name__)

# ─── In-memory task tracking ────────────────────────────────────────────────
_tasks: dict[str, dict] = {}
# Each entry: {"status": "running"|"completed"|"failed"|"cancelled",
#              "cancel_event": asyncio.Event, "result": ..., "error": ...,
#              "progress": dict}


# ─── FIXED-PATH ROUTES MUST COME BEFORE {task_id} ROUTES ───────────────────

@router.post("/backtest/start")
async def backtest_start(
    req: BacktestRequest,
    db: AsyncSession = Depends(get_db),
):
    """Start a backtest as a background task. Returns task_id immediately."""
    if req.pair.upper() not in SUPPORTED_SYMBOLS:
        raise HTTPException(400, f"Unsupported pair: {req.pair}")

    task_id = str(uuid.uuid4())
    cancel_event = asyncio.Event()
    progress = {}

    _tasks[task_id] = {
        "status": "running",
        "cancel_event": cancel_event,
        "result": None,
        "error": None,
        "progress": progress,
    }

    async def _run():
        from app.core.database import async_session
        try:
            async with async_session() as bg_db:
                result = await run_backtest(bg_db, req, cancel_event=cancel_event, progress=progress)
                if cancel_event.is_set():
                    _tasks[task_id]["status"] = "cancelled"
                else:
                    _tasks[task_id]["status"] = "completed"
                    _tasks[task_id]["result"] = result
        except asyncio.CancelledError:
            _tasks[task_id]["status"] = "cancelled"
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            log.error("backtest.task_failed", task_id=task_id, error=str(e), traceback=tb)
            _tasks[task_id]["status"] = "failed"
            _tasks[task_id]["error"] = str(e)

    asyncio.create_task(_run())
    return {"taskId": task_id, "status": "running"}


@router.post("/backtest/run", response_model=BacktestResponse)
async def backtest_endpoint(
    req: BacktestRequest,
    db: AsyncSession = Depends(get_db),
):
    """Legacy synchronous backtest endpoint."""
    if req.pair.upper() not in SUPPORTED_SYMBOLS:
        raise HTTPException(400, f"Unsupported pair: {req.pair}")
    try:
        return await run_backtest(db, req)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.error("backtest.sync_failed", error=str(e))
        raise HTTPException(500, "Backtest failed due to an internal error.")


@router.get("/backtest/history")
async def backtest_history(
    pair: str = Query(...),
    timeframe: str = Query(...),
    limit: int = Query(default=20, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Return saved backtest runs for a given pair/timeframe."""
    stmt = (
        select(BacktestRunRow)
        .where(BacktestRunRow.symbol == pair.upper())
        .where(BacktestRunRow.timeframe == timeframe)
        .order_by(desc(BacktestRunRow.created_at))
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    return [
        {
            "id": r.id,
            "symbol": r.symbol,
            "timeframe": r.timeframe,
            "start": r.start,
            "end": r.end,
            "createdAt": r.created_at.isoformat() if r.created_at else None,
            "results": r.results_json,
            "tests": r.tests_json,
        }
        for r in rows
    ]


# ─── PARAMETERIZED ROUTES ({task_id}) ──────────────────────────────────────

@router.get("/backtest/{task_id}")
async def backtest_status(task_id: str):
    """Poll backtest task status. Returns results when completed."""
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    resp: dict = {"taskId": task_id, "status": task["status"]}

    # Include progress info for running tasks
    if task["status"] == "running" and task.get("progress"):
        resp["progress"] = task["progress"]

    if task["status"] == "completed" and task["result"]:
        resp["runId"] = task["result"].runId
        resp["results"] = [r.model_dump() for r in task["result"].results]
        resp["tests"] = task["result"].tests.model_dump()
        # Clean up after delivering results
        _tasks.pop(task_id, None)

    elif task["status"] == "failed":
        resp["error"] = task.get("error", "Unknown error")
        _tasks.pop(task_id, None)

    elif task["status"] == "cancelled":
        _tasks.pop(task_id, None)

    return resp


@router.post("/backtest/{task_id}/cancel")
async def backtest_cancel(task_id: str):
    """Cancel a running backtest."""
    task = _tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if task["status"] != "running":
        return {"ok": True, "status": task["status"]}

    task["cancel_event"].set()
    task["status"] = "cancelled"
    log.info("backtest.cancelled", task_id=task_id)
    return {"ok": True, "status": "cancelled"}

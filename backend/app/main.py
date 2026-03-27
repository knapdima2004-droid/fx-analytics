"""FX Analytics – FastAPI application entry point.

Run with:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.database import create_tables
from app.core.logging_config import setup_logging, get_logger

from app.api.health import router as health_router
from app.api.data import router as data_router
from app.api.models_router import router as models_router
from app.api.backtest import router as backtest_router
from app.api.reports import router as reports_router
from app.api.analysis import router as analysis_router
from app.api.rates import router as rates_router

log = get_logger(__name__)


# ─── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown logic."""
    setup_logging()
    log.info("app.startup", version=settings.APP_VERSION)
    # Create tables if they don't exist (dev convenience)
    await create_tables()
    yield
    log.info("app.shutdown")


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="FX Analytics API",
    description="Backend for FX currency pair analysis, prediction and backtesting.",
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# CORS – allow frontend origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ──────────────────────────────────────────────────────────────────

app.include_router(health_router, tags=["Health"])
app.include_router(data_router, tags=["Data"])
app.include_router(models_router, tags=["Models"])
app.include_router(backtest_router, tags=["Backtest"])
app.include_router(reports_router, tags=["Reports"])
app.include_router(analysis_router, tags=["Analysis"])
app.include_router(rates_router, tags=["Rates"])


# ─── Global exception handler ────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("unhandled_exception", path=str(request.url), error=str(exc))
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An internal error occurred. Please try again later.",
            }
        },
    )

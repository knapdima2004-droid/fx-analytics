"""Pydantic v2 schemas – must match frontend TypeScript types exactly."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator
import re


# ─── Enums ────────────────────────────────────────────────────────────────────

SUPPORTED_SYMBOLS = {"EURUSD", "USDJPY", "GBPUSD", "EURGBP", "USDCHF"}


class TimeframeEnum(str, Enum):
    D1 = "1D"
    H4 = "4H"
    H1 = "1H"
    M30 = "30M"
    M15 = "15M"
    M5 = "5M"
    M1 = "1M"


class ModelTypeEnum(str, Enum):
    Naive = "Naive"
    MovingAverage = "MovingAverage"
    ARIMA = "ARIMA"
    Ridge = "Ridge"
    RandomForest = "RandomForest"
    AIEnsemble = "AIEnsemble"


class TargetEnum(str, Enum):
    close = "close"
    log_return = "log_return"


# ─── OHLC ─────────────────────────────────────────────────────────────────────

class OHLCBar(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: Optional[float] = None


class DataSummary(BaseModel):
    rows: int
    start: str
    end: str
    missing: int
    duplicates: int
    lastUpdated: str


# ─── Data update ──────────────────────────────────────────────────────────────

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _check_date(v: str) -> str:
    if not _DATE_RE.match(v):
        raise ValueError(f"Invalid date format: '{v}'. Expected YYYY-MM-DD.")
    return v


class UpdateDataRequest(BaseModel):
    pair: str
    timeframe: TimeframeEnum
    start: str
    end: str

    _val_start = field_validator("start")(_check_date)
    _val_end = field_validator("end")(_check_date)


class UpdateDataResponse(BaseModel):
    ok: bool = True
    message: str
    summary: Optional[DataSummary] = None


# ─── Training ─────────────────────────────────────────────────────────────────

class FeatureConfig(BaseModel):
    lagReturns: Optional[bool] = False
    numLags: Optional[int] = 5
    sma: Optional[bool] = False
    ema: Optional[bool] = False
    rsi: Optional[bool] = False
    macd: Optional[bool] = False


class TrainRequest(BaseModel):
    pair: str
    timeframe: TimeframeEnum
    start: str
    end: str
    model: ModelTypeEnum
    target: Optional[TargetEnum] = TargetEnum.close
    features: Optional[FeatureConfig] = None
    hyperparams: Optional[dict] = None

    _val_start = field_validator("start")(_check_date)
    _val_end = field_validator("end")(_check_date)


class MetricsPreview(BaseModel):
    mae: float
    rmse: float


class TrainResponse(BaseModel):
    modelId: str
    model: ModelTypeEnum
    trainedAt: str
    metricsPreview: Optional[MetricsPreview] = None


# ─── Forecast ─────────────────────────────────────────────────────────────────

class ForecastRequest(BaseModel):
    modelId: str
    horizon: int = Field(ge=1, le=365)


class ForecastPoint(BaseModel):
    time: str
    actual: Optional[float] = None
    predicted: float
    lower: Optional[float] = None
    upper: Optional[float] = None


# ─── Backtest ─────────────────────────────────────────────────────────────────

class BacktestRequest(BaseModel):
    pair: str
    timeframe: TimeframeEnum
    start: str
    end: str
    models: list[ModelTypeEnum]
    windowTrainDays: int = Field(ge=10)
    windowTestDays: int = Field(ge=1)
    stepDays: int = Field(ge=1)

    _val_start = field_validator("start")(_check_date)
    _val_end = field_validator("end")(_check_date)


class BacktestWindowResult(BaseModel):
    trainStart: str
    trainEnd: str
    testStart: str
    testEnd: str
    mae: float
    rmse: float
    directionalAccuracy: float


class BacktestMetrics(BaseModel):
    mae: float
    rmse: float
    directionalAccuracy: float


class BacktestResult(BaseModel):
    model: ModelTypeEnum
    metrics: BacktestMetrics
    windows: list[BacktestWindowResult]


class AdfTest(BaseModel):
    statistic: float
    pValue: float
    isStationary: bool


class LjungBoxTest(BaseModel):
    statistic: float
    pValue: float
    noAutocorrelation: bool


class DieboldMarianoTest(BaseModel):
    statistic: float
    pValue: float
    betterModel: Optional[ModelTypeEnum] = None


class StatisticalTests(BaseModel):
    adf: AdfTest
    ljungBox: LjungBoxTest
    dieboldMariano: Optional[DieboldMarianoTest] = None


class BacktestResponse(BaseModel):
    runId: Optional[str] = None
    results: list[BacktestResult]
    tests: StatisticalTests


# ─── Reports ──────────────────────────────────────────────────────────────────

class GenerateReportRequest(BaseModel):
    pair: str
    timeframe: TimeframeEnum
    start: str
    end: str
    models: list[ModelTypeEnum]
    includeCharts: Optional[bool] = True
    includeTests: Optional[bool] = True
    language: Optional[str] = "en"

    _val_start = field_validator("start")(_check_date)
    _val_end = field_validator("end")(_check_date)


class ReportItem(BaseModel):
    id: str
    createdAt: str
    pair: str
    timeframe: str
    start: str
    end: str
    models: list[str]
    status: str
    downloadUrl: Optional[str] = None
    hasExcel: bool = False


# ─── AI Analysis ─────────────────────────────────────────────────────────

class AiAnalysisRequest(BaseModel):
    pair: str
    timeframe: TimeframeEnum
    start: str
    end: str
    backtestResults: Optional[list[dict]] = None
    statisticalTests: Optional[dict] = None
    dataSummary: Optional[dict] = None
    forecastData: Optional[list[dict]] = None
    language: Optional[str] = "en"


class AiAnalysisResponse(BaseModel):
    summary: str
    modelComparison: str = Field(alias="model_comparison", default="")
    testInterpretation: str = Field(alias="test_interpretation", default="")
    recommendation: str = ""
    conclusion: str = ""

    model_config = {"populate_by_name": True}


# ─── Data Quality ────────────────────────────────────────────────────────

class DataQualityReport(BaseModel):
    totalBars: int = 0
    invalidBars: int = 0
    invalidBarDetails: list[str] = []
    duplicateTimestamps: int = 0
    missingWeekdays: int = 0
    missingWeekdayDates: list[str] = []
    outlierCount: int = 0
    qualityScore: float = 100.0


# ─── Health ───────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    ok: bool = True
    version: str


# ─── Error ────────────────────────────────────────────────────────────────────

class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Optional[str] = None


class ErrorResponse(BaseModel):
    error: ErrorDetail

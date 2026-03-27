"""SQLAlchemy ORM models."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.sqlite import JSON

from app.core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


# ─── OHLC Bars ───────────────────────────────────────────────────────────────

class OHLCBarRow(Base):
    __tablename__ = "ohlc_bars"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(10), nullable=False, index=True)
    timeframe = Column(String(4), nullable=False, index=True)
    time = Column(DateTime(timezone=True), nullable=False, index=True)
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Float, nullable=True)
    source = Column(String(50), nullable=False, default="yfinance")
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    __table_args__ = (
        UniqueConstraint("symbol", "timeframe", "time", name="uq_ohlc_symbol_tf_time"),
        Index("ix_ohlc_symbol_tf_time", "symbol", "timeframe", "time"),
    )


# ─── Data Update Audit Log ───────────────────────────────────────────────────

class DataUpdateRow(Base):
    __tablename__ = "data_updates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(10), nullable=False)
    timeframe = Column(String(4), nullable=False)
    start = Column(String(20), nullable=False)
    end = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False)  # ok / error
    message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)


# ─── Trained Models ──────────────────────────────────────────────────────────

class TrainedModelRow(Base):
    __tablename__ = "trained_models"

    id = Column(String(36), primary_key=True, default=_new_id)
    symbol = Column(String(10), nullable=False, index=True)
    timeframe = Column(String(4), nullable=False)
    model_type = Column(String(30), nullable=False)
    target_type = Column(String(20), nullable=False, default="close")
    config_json = Column(JSON, nullable=True)
    metrics_json = Column(JSON, nullable=True)
    artifact_path = Column(String(500), nullable=True)
    trained_at = Column(DateTime(timezone=True), default=_utcnow)
    created_at = Column(DateTime(timezone=True), default=_utcnow)


# ─── Backtest Runs ───────────────────────────────────────────────────────────

class BacktestRunRow(Base):
    __tablename__ = "backtest_runs"

    id = Column(String(36), primary_key=True, default=_new_id)
    symbol = Column(String(10), nullable=False)
    timeframe = Column(String(4), nullable=False)
    start = Column(String(20), nullable=False)
    end = Column(String(20), nullable=False)
    request_json = Column(JSON, nullable=True)
    results_json = Column(JSON, nullable=True)
    tests_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)


# ─── Reports ─────────────────────────────────────────────────────────────────

class ReportRow(Base):
    __tablename__ = "reports"

    id = Column(String(36), primary_key=True, default=_new_id)
    symbol = Column(String(10), nullable=False)
    timeframe = Column(String(4), nullable=False)
    start = Column(String(20), nullable=False)
    end = Column(String(20), nullable=False)
    models = Column(JSON, nullable=True)
    options_json = Column(JSON, nullable=True)
    status = Column(String(20), nullable=False, default="Generating")
    file_path = Column(String(500), nullable=True)
    excel_path = Column(String(500), nullable=True)
    content_type = Column(String(50), nullable=True, default="text/html")
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

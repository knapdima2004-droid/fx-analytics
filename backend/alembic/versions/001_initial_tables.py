"""Initial tables

Revision ID: 001
Revises:
Create Date: 2025-01-01 00:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── ohlc_bars ──
    op.create_table(
        "ohlc_bars",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("symbol", sa.String(10), nullable=False),
        sa.Column("timeframe", sa.String(4), nullable=False),
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", sa.Float(), nullable=False),
        sa.Column("high", sa.Float(), nullable=False),
        sa.Column("low", sa.Float(), nullable=False),
        sa.Column("close", sa.Float(), nullable=False),
        sa.Column("volume", sa.Float(), nullable=True),
        sa.Column("source", sa.String(50), nullable=False, server_default="yfinance"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("symbol", "timeframe", "time", name="uq_ohlc_symbol_tf_time"),
    )
    op.create_index("ix_ohlc_symbol", "ohlc_bars", ["symbol"])
    op.create_index("ix_ohlc_timeframe", "ohlc_bars", ["timeframe"])
    op.create_index("ix_ohlc_time", "ohlc_bars", ["time"])
    op.create_index("ix_ohlc_symbol_tf_time", "ohlc_bars", ["symbol", "timeframe", "time"])

    # ── data_updates ──
    op.create_table(
        "data_updates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("symbol", sa.String(10), nullable=False),
        sa.Column("timeframe", sa.String(4), nullable=False),
        sa.Column("start", sa.String(20), nullable=False),
        sa.Column("end", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── trained_models ──
    op.create_table(
        "trained_models",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("symbol", sa.String(10), nullable=False),
        sa.Column("timeframe", sa.String(4), nullable=False),
        sa.Column("model_type", sa.String(30), nullable=False),
        sa.Column("target_type", sa.String(20), nullable=False, server_default="close"),
        sa.Column("config_json", sa.JSON(), nullable=True),
        sa.Column("metrics_json", sa.JSON(), nullable=True),
        sa.Column("artifact_path", sa.String(500), nullable=True),
        sa.Column("trained_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_trained_models_symbol", "trained_models", ["symbol"])

    # ── backtest_runs ──
    op.create_table(
        "backtest_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("symbol", sa.String(10), nullable=False),
        sa.Column("timeframe", sa.String(4), nullable=False),
        sa.Column("start", sa.String(20), nullable=False),
        sa.Column("end", sa.String(20), nullable=False),
        sa.Column("request_json", sa.JSON(), nullable=True),
        sa.Column("results_json", sa.JSON(), nullable=True),
        sa.Column("tests_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── reports ──
    op.create_table(
        "reports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("symbol", sa.String(10), nullable=False),
        sa.Column("timeframe", sa.String(4), nullable=False),
        sa.Column("start", sa.String(20), nullable=False),
        sa.Column("end", sa.String(20), nullable=False),
        sa.Column("models", sa.JSON(), nullable=True),
        sa.Column("options_json", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="Generating"),
        sa.Column("file_path", sa.String(500), nullable=True),
        sa.Column("content_type", sa.String(50), nullable=True, server_default="text/html"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("reports")
    op.drop_table("backtest_runs")
    op.drop_table("trained_models")
    op.drop_table("data_updates")
    op.drop_table("ohlc_bars")

"""Report generation service – produces professional HTML reports.

Features:
- Modern, clean design with professional typography
- Embedded matplotlib charts (price, returns, backtest metrics)
- Automated statistical interpretation
- Multi-language support (English, Slovak)
"""

from __future__ import annotations

import base64
import io
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.ticker as mticker
from jinja2 import Environment, BaseLoader
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging_config import get_logger
from app.models.orm import ReportRow
from app.schemas.schemas import GenerateReportRequest, ReportItem
from app.services.ohlc_service import get_close_series, get_ohlc_dataframe

log = get_logger(__name__)

# ─── Helpers ──────────────────────────────────────────────────────────────────

TIMEFRAME_LABELS = {
    "en": {"1D": "1 Day", "4H": "4 Hours", "1H": "1 Hour", "30M": "30 Minutes",
            "15M": "15 Minutes", "5M": "5 Minutes", "1M": "1 Minute"},
    "sk": {"1D": "1 deň", "4H": "4 hodiny", "1H": "1 hodina", "30M": "30 minút",
            "15M": "15 minút", "5M": "5 minút", "1M": "1 minúta"},
}

MODEL_DESCRIPTIONS = {
    "en": {
        "Naive":         "Baseline – predicts next = last observed value",
        "MovingAverage":  "Mean of last N observations (window = 20)",
        "ARIMA":          "ARIMA(1,1,1) – parametric time-series model",
        "Ridge":          "Ridge regression (α = 1.0) with lag-return features",
        "RandomForest":   "Random Forest (100 trees, max_depth = 10) with lag-return features",
        "AIEnsemble":     "AI-Enhanced Ensemble – analyses price context, indicators, "
                          "and base model predictions to produce weighted forecast",
    },
    "sk": {
        "Naive":          "Základný model – predikcia = posledná pozorovaná hodnota",
        "MovingAverage":  "Priemer posledných N pozorovaní (okno = 20)",
        "ARIMA":          "ARIMA(1,1,1) – parametrický model časových radov",
        "Ridge":          "Ridge regresia (α = 1,0) s oneskorenými výnosmi",
        "RandomForest":   "Random Forest (100 stromov, max_depth = 10) s oneskorenými výnosmi",
        "AIEnsemble":     "AI-vylepšený ansámbl – analyzuje cenový kontext, indikátory "
                          "a predikcie základných modelov na vytvorenie váženej predikcie",
    },
}


def _format_pval(p: float) -> str:
    """Format p-value: show '< 0.001' instead of '0.0'."""
    if p < 0.001:
        return "< 0.001"
    return f"{p:.6f}"


def _human_timeframe(tf: str, lang: str) -> str:
    return TIMEFRAME_LABELS.get(lang, TIMEFRAME_LABELS["en"]).get(tf, tf)


# ─── Chart styling ────────────────────────────────────────────────────────────

# Professional colour palette
_C = {
    "blue":    "#2563eb",
    "blue_d":  "#1d4ed8",
    "blue_l":  "#93c5fd",
    "red":     "#dc2626",
    "red_l":   "#fca5a5",
    "green":   "#16a34a",
    "green_l": "#86efac",
    "amber":   "#f59e0b",
    "purple":  "#7c3aed",
    "teal":    "#0d9488",
    "slate":   "#64748b",
    "bg":      "#f8fafc",
    "grid":    "#e2e8f0",
    "border":  "#cbd5e1",
    "text":    "#1e293b",
    "muted":   "#94a3b8",
}

CHART_STYLE = {
    "figure.facecolor": "#ffffff",
    "axes.facecolor": "#fafbfd",
    "axes.edgecolor": "#e2e8f0",
    "axes.grid": True,
    "grid.color": "#eef1f6",
    "grid.alpha": 0.8,
    "grid.linewidth": 0.6,
    "grid.linestyle": "--",
    "font.family": "sans-serif",
    "font.size": 10,
    "axes.titlesize": 15,
    "axes.titleweight": "bold",
    "axes.titlepad": 14,
    "axes.labelsize": 11,
    "axes.labelpad": 8,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "xtick.labelsize": 9,
    "ytick.labelsize": 9,
    "xtick.major.pad": 6,
    "ytick.major.pad": 6,
    "lines.linewidth": 1.8,
    "lines.antialiased": True,
    "legend.frameon": True,
    "legend.fancybox": True,
    "legend.shadow": False,
    "legend.framealpha": 0.92,
    "legend.edgecolor": "#e2e8f0",
}

_INTRADAY_TFS = {"1M", "5M", "15M", "30M", "1H"}


def _is_intraday(close: pd.Series) -> bool:
    """Detect intraday data based on the time span."""
    if len(close) < 2:
        return False
    span = (close.index[-1] - close.index[0]).total_seconds()
    return span < 15 * 86400  # less than 15 days → treat as intraday


def _auto_xaxis(ax, close: pd.Series):
    """Configure x-axis ticks & format depending on data density."""
    if _is_intraday(close):
        span_h = (close.index[-1] - close.index[0]).total_seconds() / 3600
        if span_h <= 12:
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
            ax.xaxis.set_major_locator(mdates.HourLocator(interval=1))
        elif span_h <= 72:
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b %H:%M"))
            ax.xaxis.set_major_locator(mdates.HourLocator(interval=max(1, int(span_h / 10))))
        else:
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b %H:%M"))
            ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    else:
        span_d = (close.index[-1] - close.index[0]).days
        if span_d <= 90:
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
            ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=2))
        elif span_d <= 365:
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
            ax.xaxis.set_major_locator(mdates.MonthLocator())
        else:
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
            ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))


def _fig_to_base64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=180, bbox_inches="tight",
                facecolor="#ffffff", edgecolor="none", pad_inches=0.15)
    buf.seek(0)
    encoded = base64.b64encode(buf.read()).decode("utf-8")
    plt.close(fig)
    return f"data:image/png;base64,{encoded}"


# ────────────────────────────────── Price Chart ──────────────────────────────

def _make_price_chart(close: pd.Series, symbol: str, lang: str) -> str:
    """Professional close-price chart with Bollinger Bands, SMA, and auto-scaled Y-axis."""
    intraday = _is_intraday(close)

    with plt.rc_context(CHART_STYLE):
        fig, ax = plt.subplots(figsize=(13, 5.5))

        # ── Y-axis padding: data-range based (NEVER start from 0) ──
        ymin, ymax = close.min(), close.max()
        margin = (ymax - ymin) * 0.12 if ymax != ymin else ymax * 0.001
        ax.set_ylim(ymin - margin, ymax + margin)

        # ── Main price line ──
        ax.plot(close.index, close.values, color=_C["blue"], linewidth=1.6,
                label="Close", zorder=4, solid_capstyle="round")

        # ── Fill between SMA line and close (soft gradient effect) ──
        if len(close) > 20:
            sma20 = close.rolling(20).mean()
            # Bollinger Bands
            std20 = close.rolling(20).std()
            upper_bb = sma20 + 2 * std20
            lower_bb = sma20 - 2 * std20

            ax.plot(close.index, sma20.values, color=_C["amber"], linewidth=1.2,
                    alpha=0.9, label="SMA(20)", linestyle="--", zorder=3)
            ax.fill_between(close.index, lower_bb.values, upper_bb.values,
                            alpha=0.10, color=_C["blue"], label="Bollinger ±2σ", zorder=1)
            ax.plot(close.index, upper_bb.values, color=_C["blue_l"], linewidth=0.6,
                    alpha=0.5, zorder=2)
            ax.plot(close.index, lower_bb.values, color=_C["blue_l"], linewidth=0.6,
                    alpha=0.5, zorder=2)

        # ── Min / Max annotations ──
        min_idx = close.idxmin()
        max_idx = close.idxmax()
        for idx, val, color, dy in [
            (min_idx, close[min_idx], _C["red"], -28),
            (max_idx, close[max_idx], _C["green"], 22),
        ]:
            ax.annotate(
                f"{'Min' if dy < 0 else 'Max'}: {val:.5f}",
                xy=(idx, val), xytext=(0, dy), textcoords="offset points",
                fontsize=8, color=color, ha="center", fontweight="bold",
                arrowprops=dict(arrowstyle="->", color=color, lw=1.2),
                bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=color, alpha=0.85),
                zorder=5,
            )

        # ── Stats box (top-right) ──
        pct_change = (close.iloc[-1] / close.iloc[0] - 1) * 100
        arrow = "▲" if pct_change >= 0 else "▼"
        pct_color = _C["green"] if pct_change >= 0 else _C["red"]
        stats_lines = [
            f"Open:   {close.iloc[0]:.5f}",
            f"Close:  {close.iloc[-1]:.5f}",
            f"Change: {arrow} {abs(pct_change):.3f}%",
            f"Range:  {ymax - ymin:.5f}",
            f"Bars:   {len(close)}",
        ]
        stats_txt = "\n".join(stats_lines)
        ax.text(0.98, 0.97, stats_txt, transform=ax.transAxes, fontsize=8,
                verticalalignment="top", horizontalalignment="right",
                bbox=dict(boxstyle="round,pad=0.5", fc="white", ec=_C["border"], alpha=0.92),
                fontfamily="monospace", zorder=6)

        # ── Title & labels ──
        if intraday:
            title = f"{symbol} – {'Uzatváracia cena (intraday)' if lang == 'sk' else 'Close Price (Intraday)'}"
        else:
            title = f"{symbol} – {'Denná uzatváracia cena' if lang == 'sk' else 'Daily Close Price'}"
        ax.set_title(title, pad=15, fontsize=14)
        ax.set_ylabel("Price" if lang == "en" else "Cena")
        ax.legend(loc="upper left", framealpha=0.92, fontsize=8, ncol=2,
                  fancybox=True, shadow=False)
        _auto_xaxis(ax, close)
        fig.autofmt_xdate(rotation=25)
        fig.tight_layout(pad=1.5)

        return _fig_to_base64(fig)


# ────────────────────────────── Returns Chart ────────────────────────────────

def _make_returns_chart(close: pd.Series, symbol: str, lang: str) -> str:
    """Log-return chart: line plot for high-freq data, bars for daily.
    Right panel: histogram with KDE and normal overlay."""
    returns = np.log(close / close.shift(1)).dropna()
    n_bars = len(returns)
    use_line = n_bars > 300  # switch to line for dense data

    with plt.rc_context(CHART_STYLE):
        fig, axes = plt.subplots(1, 2, figsize=(13, 5),
                                 gridspec_kw={"width_ratios": [2.2, 1]})

        # ── Left: returns time-series ──
        ax1 = axes[0]
        mu = float(returns.mean())
        sigma = float(returns.std())

        if use_line:
            # For intraday / large datasets: smooth line plot
            ax1.fill_between(returns.index, 0, returns.values,
                             where=returns.values >= 0, alpha=0.35, color=_C["green"],
                             interpolate=True, zorder=2)
            ax1.fill_between(returns.index, 0, returns.values,
                             where=returns.values < 0, alpha=0.35, color=_C["red"],
                             interpolate=True, zorder=2)
            ax1.plot(returns.index, returns.values, color=_C["text"], linewidth=0.4,
                     alpha=0.6, zorder=3)
        else:
            # For daily: classic bar chart
            colors = [_C["green"] if r >= 0 else _C["red"] for r in returns.values]
            ax1.bar(returns.index, returns.values, color=colors, alpha=0.7,
                    width=max(0.5, 1.5 if n_bars < 200 else 0.8))

        ax1.axhline(y=0, color=_C["slate"], linewidth=0.8, zorder=1)
        ax1.axhline(y=mu, color=_C["blue"], linewidth=1.2, linestyle="--",
                    label=f"μ = {mu:.6f}", zorder=4)
        ax1.axhline(y=mu + 2 * sigma, color=_C["amber"], linewidth=0.8,
                    linestyle=":", alpha=0.8, zorder=4)
        ax1.axhline(y=mu - 2 * sigma, color=_C["amber"], linewidth=0.8,
                    linestyle=":", alpha=0.8, label=f"±2σ = {2 * sigma:.6f}", zorder=4)

        # Mark outliers (> 3σ)
        outliers = returns[returns.abs() > 3 * sigma]
        if len(outliers) > 0 and len(outliers) < 20:
            ax1.scatter(outliers.index, outliers.values, color=_C["purple"],
                        s=18, zorder=5, label=f"Outliers (>{3}σ): {len(outliers)}", marker="o")

        title1 = "Logaritmické výnosy" if lang == "sk" else "Log Returns"
        ax1.set_title(title1, fontsize=13)
        ax1.legend(fontsize=7.5, loc="upper right", framealpha=0.9)
        _auto_xaxis(ax1, close)

        # ── Right: distribution histogram + KDE + Normal overlay ──
        ax2 = axes[1]
        n_bins = min(80, max(30, n_bars // 20))
        counts, bin_edges, patches = ax2.hist(
            returns.values, bins=n_bins, color=_C["blue"], alpha=0.55,
            edgecolor=_C["blue_d"], linewidth=0.3, orientation="horizontal",
            density=True,
        )

        # KDE curve
        try:
            from scipy.stats import gaussian_kde, norm
            kde = gaussian_kde(returns.values)
            y_range = np.linspace(returns.min(), returns.max(), 200)
            ax2.plot(kde(y_range), y_range, color=_C["blue_d"], linewidth=1.8,
                     label="KDE", zorder=3)
            # Normal overlay
            normal_pdf = norm.pdf(y_range, loc=mu, scale=sigma)
            ax2.plot(normal_pdf, y_range, color=_C["red"], linewidth=1.2,
                     linestyle="--", label="Normal", alpha=0.8, zorder=3)
        except ImportError:
            pass

        ax2.axhline(y=0, color=_C["slate"], linewidth=0.8)
        ax2.axhline(y=mu, color=_C["blue"], linewidth=1.5, linestyle="--")

        title2 = "Rozdelenie" if lang == "sk" else "Distribution"
        ax2.set_title(title2, fontsize=13)
        ax2.set_xlabel("Density" if lang == "en" else "Hustota")
        ax2.legend(fontsize=7.5, loc="upper right")

        # Stats box
        stats_text = (
            f"n      = {n_bars}\n"
            f"μ      = {mu:.6f}\n"
            f"σ      = {sigma:.6f}\n"
            f"skew   = {float(returns.skew()):.4f}\n"
            f"kurt   = {float(returns.kurtosis()):.4f}\n"
            f"min    = {float(returns.min()):.6f}\n"
            f"max    = {float(returns.max()):.6f}"
        )
        ax2.text(0.95, 0.03, stats_text, transform=ax2.transAxes, fontsize=7,
                 verticalalignment="bottom", horizontalalignment="right",
                 bbox=dict(boxstyle="round,pad=0.4", fc="white", ec=_C["border"], alpha=0.92),
                 fontfamily="monospace", zorder=5)

        fig.autofmt_xdate(rotation=25)
        fig.tight_layout(pad=2)
        return _fig_to_base64(fig)


# ────────────────────────────── Backtest Chart ───────────────────────────────

def _make_backtest_chart(backtest_results: list[dict], lang: str) -> str:
    """Side-by-side horizontal bar chart for MAE/RMSE + gauge for DA.
    Handles 1 model gracefully."""
    if not backtest_results:
        return ""

    models = [r["model"] for r in backtest_results]
    maes = [r["mae"] for r in backtest_results]
    rmses = [r["rmse"] for r in backtest_results]
    das = [r["da"] for r in backtest_results]
    n_models = len(models)

    # Colours per model (cycle)
    palette = [_C["blue"], _C["teal"], _C["amber"], _C["purple"], _C["red"]]
    bar_colors = [palette[i % len(palette)] for i in range(n_models)]

    with plt.rc_context(CHART_STYLE):
        fig, axes = plt.subplots(1, 3, figsize=(14, max(3.5, 1.5 + n_models * 0.9)))

        y = np.arange(n_models)
        bar_h = max(0.35, 0.7 / max(1, n_models / 3))

        # ── MAE (horizontal bars) ──
        axes[0].barh(y, maes, bar_h, color=bar_colors, edgecolor="white", alpha=0.85)
        axes[0].set_yticks(y)
        axes[0].set_yticklabels(models, fontsize=10, fontweight="600")
        axes[0].set_title("MAE", fontsize=13)
        axes[0].invert_yaxis()
        for i, val in enumerate(maes):
            axes[0].text(val + max(maes) * 0.02, i, f"{val:.6f}",
                         va="center", fontsize=9, fontweight="bold", color=_C["text"])

        # ── RMSE (horizontal bars) ──
        axes[1].barh(y, rmses, bar_h, color=bar_colors, edgecolor="white", alpha=0.85)
        axes[1].set_yticks(y)
        axes[1].set_yticklabels([""] * n_models)
        axes[1].set_title("RMSE", fontsize=13)
        axes[1].invert_yaxis()
        for i, val in enumerate(rmses):
            axes[1].text(val + max(rmses) * 0.02, i, f"{val:.6f}",
                         va="center", fontsize=9, fontweight="bold", color=_C["text"])

        # ── Directional Accuracy (gauge-style) ──
        ax3 = axes[2]
        da_colors = [_C["green"] if d >= 50 else (_C["amber"] if d >= 40 else _C["red"]) for d in das]
        ax3.barh(y, das, bar_h, color=da_colors, edgecolor="white", alpha=0.85)
        ax3.axvline(x=50, color=_C["slate"], linewidth=1.2, linestyle="--",
                    label="50 % baseline", zorder=0)
        ax3.set_yticks(y)
        ax3.set_yticklabels([""] * n_models)
        title_da = "Smerová presnosť (%)" if lang == "sk" else "Dir. Accuracy (%)"
        ax3.set_title(title_da, fontsize=13)
        ax3.set_xlim(0, 100)
        ax3.invert_yaxis()
        ax3.legend(fontsize=8, loc="lower right")
        for i, val in enumerate(das):
            ax3.text(val + 1.5, i, f"{val:.1f}%",
                     va="center", fontsize=9, fontweight="bold", color=_C["text"])

        fig.tight_layout(pad=2)
        return _fig_to_base64(fig)


# ────────────────────────── Cumulative Returns ────────────────────────────────

def _make_cumulative_chart(close: pd.Series, symbol: str, lang: str) -> str:
    """Cumulative return chart showing the equity curve over time."""
    returns = np.log(close / close.shift(1)).dropna()
    cum_ret = returns.cumsum().apply(np.exp) - 1  # convert back to simple percentage

    with plt.rc_context(CHART_STYLE):
        fig, ax = plt.subplots(figsize=(13, 5))

        ax.fill_between(cum_ret.index, 0, cum_ret.values * 100,
                         where=cum_ret.values >= 0, alpha=0.25, color=_C["green"],
                         interpolate=True, zorder=1)
        ax.fill_between(cum_ret.index, 0, cum_ret.values * 100,
                         where=cum_ret.values < 0, alpha=0.25, color=_C["red"],
                         interpolate=True, zorder=1)
        ax.plot(cum_ret.index, cum_ret.values * 100, color=_C["blue"],
                linewidth=1.8, zorder=3)
        ax.axhline(y=0, color=_C["slate"], linewidth=1, linestyle="-", zorder=2)

        final_ret = cum_ret.iloc[-1] * 100
        ax.annotate(f"{'+' if final_ret >= 0 else ''}{final_ret:.3f}%",
                    xy=(cum_ret.index[-1], final_ret),
                    fontsize=11, fontweight="bold",
                    color=_C["green"] if final_ret >= 0 else _C["red"],
                    ha="right", va="bottom" if final_ret >= 0 else "top",
                    bbox=dict(boxstyle="round,pad=0.3", fc="white", ec=_C["border"], alpha=0.9),
                    zorder=5)

        # Max drawdown area
        cum_max = cum_ret.cummax()
        drawdown = (cum_ret - cum_max) * 100
        dd_min_idx = drawdown.idxmin()
        if drawdown.min() < -0.1:
            ax.fill_between(cum_ret.index, cum_max.values * 100, cum_ret.values * 100,
                            alpha=0.08, color=_C["red"], zorder=0,
                            label=f"Max DD: {drawdown.min():.3f}%")
            ax.legend(fontsize=8, loc="lower left", framealpha=0.9)

        title = "Kumulatívny výnos (%)" if lang == "sk" else "Cumulative Return (%)"
        ax.set_title(f"{symbol} — {title}", pad=12, fontsize=14)
        ax.set_ylabel("%" if lang == "en" else "%")
        ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.2f%%"))
        _auto_xaxis(ax, close)
        fig.autofmt_xdate(rotation=25)
        fig.tight_layout(pad=1.5)
        return _fig_to_base64(fig)


# ────────────────────────── QQ-Plot ───────────────────────────────────────────

def _make_qq_chart(close: pd.Series, lang: str) -> str:
    """Q-Q plot comparing return distribution against normal distribution."""
    returns = np.log(close / close.shift(1)).dropna().values

    with plt.rc_context(CHART_STYLE):
        fig, ax = plt.subplots(figsize=(6.5, 6))

        from scipy import stats as sp_stats
        (osm, osr), (slope, intercept, r_sq) = sp_stats.probplot(returns, dist="norm")

        ax.scatter(osm, osr, s=14, alpha=0.6, color=_C["blue"], edgecolors="none", zorder=3)
        fit_line = slope * np.array(osm) + intercept
        ax.plot(osm, fit_line, color=_C["red"], linewidth=1.6, linestyle="--",
                label=f"R² = {r_sq**2:.4f}", zorder=4)

        ax.set_xlabel("Theoretical Quantiles" if lang == "en" else "Teoretické kvantily")
        ax.set_ylabel("Sample Quantiles" if lang == "en" else "Výberové kvantily")
        title = "Q-Q Plot (vs Normal)" if lang == "en" else "Q-Q graf (vs normálne rozdelenie)"
        ax.set_title(title, fontsize=13)
        ax.legend(fontsize=10, loc="upper left")

        skew = float(pd.Series(returns).skew())
        kurt = float(pd.Series(returns).kurtosis())
        stats_txt = f"Skew = {skew:.4f}\nKurtosis = {kurt:.4f}\nn = {len(returns)}"
        ax.text(0.97, 0.03, stats_txt, transform=ax.transAxes, fontsize=9,
                va="bottom", ha="right",
                bbox=dict(boxstyle="round,pad=0.4", fc="white", ec=_C["border"], alpha=0.92),
                fontfamily="monospace", zorder=5)

        fig.tight_layout(pad=1.5)
        return _fig_to_base64(fig)


# ────────────────────── Rolling Volatility ────────────────────────────────────

def _make_volatility_chart(close: pd.Series, symbol: str, lang: str) -> str:
    """Rolling 20-day annualized volatility with regime zones."""
    returns = np.log(close / close.shift(1)).dropna()
    roll_vol = returns.rolling(20).std() * np.sqrt(252) * 100
    roll_vol = roll_vol.dropna()

    if len(roll_vol) < 5:
        return ""

    with plt.rc_context(CHART_STYLE):
        fig, ax = plt.subplots(figsize=(13, 5))

        ax.fill_between(roll_vol.index, 0, roll_vol.values, alpha=0.3, color=_C["blue"], zorder=1)
        ax.plot(roll_vol.index, roll_vol.values, color=_C["blue"], linewidth=1.5, zorder=3)

        mean_vol = roll_vol.mean()
        ax.axhline(y=mean_vol, color=_C["amber"], linewidth=1.2, linestyle="--",
                    label=f"Mean: {mean_vol:.2f}%", zorder=4)

        low_th = 5.0
        high_th = 15.0
        ax.axhspan(0, low_th, alpha=0.06, color=_C["green"], zorder=0)
        ax.axhspan(high_th, roll_vol.max() * 1.1, alpha=0.06, color=_C["red"], zorder=0)

        low_label = "Nízka" if lang == "sk" else "Low"
        high_label = "Vysoká" if lang == "sk" else "High"
        ax.text(roll_vol.index[0], low_th - 0.5, f"← {low_label}",
                fontsize=8, color=_C["green"], alpha=0.8, va="top")
        if roll_vol.max() > high_th:
            ax.text(roll_vol.index[0], high_th + 0.5, f"← {high_label}",
                    fontsize=8, color=_C["red"], alpha=0.8, va="bottom")

        title = "Rolujúca 20-dňová anualizovaná volatilita (%)" if lang == "sk" else "Rolling 20-Day Annualized Volatility (%)"
        ax.set_title(f"{symbol} — {title}", pad=12, fontsize=14)
        ax.set_ylabel("Volatility (%)" if lang == "en" else "Volatilita (%)")
        ax.legend(fontsize=9, loc="upper right", framealpha=0.9)
        _auto_xaxis(ax, close)
        fig.autofmt_xdate(rotation=25)
        fig.tight_layout(pad=1.5)
        return _fig_to_base64(fig)


# ────────────────────── ACF (Autocorrelation) ─────────────────────────────────

def _make_acf_chart(close: pd.Series, lang: str) -> str:
    """Autocorrelation function plot for log returns."""
    returns = np.log(close / close.shift(1)).dropna().values
    n = len(returns)
    if n < 30:
        return ""

    max_lag = min(30, n // 3)
    mean_r = np.mean(returns)
    denom = np.sum((returns - mean_r) ** 2)
    acf_vals = []
    for k in range(max_lag + 1):
        if k == 0:
            acf_vals.append(1.0)
        else:
            numer = np.sum((returns[k:] - mean_r) * (returns[:-k] - mean_r))
            acf_vals.append(numer / denom if denom > 0 else 0.0)

    with plt.rc_context(CHART_STYLE):
        fig, ax = plt.subplots(figsize=(13, 4.5))

        lags = list(range(max_lag + 1))
        markerline, stemlines, baseline = ax.stem(lags, acf_vals, linefmt='-',
                                                   markerfmt='o', basefmt='-')
        markerline.set_color(_C["blue"])
        markerline.set_markersize(4)
        stemlines.set_color(_C["blue"])
        stemlines.set_linewidth(1.2)
        baseline.set_color(_C["slate"])

        conf = 1.96 / np.sqrt(n)
        ax.axhspan(-conf, conf, alpha=0.12, color=_C["blue"],
                    label=f"95% CI (±{conf:.4f})", zorder=0)
        ax.axhline(y=0, color=_C["slate"], linewidth=0.8)

        title = "Autokorelačná funkcia (ACF) log výnosov" if lang == "sk" else "Autocorrelation Function (ACF) of Log Returns"
        ax.set_title(title, fontsize=13)
        ax.set_xlabel("Lag" if lang == "en" else "Oneskorenie")
        ax.set_ylabel("ACF")
        ax.set_xlim(-0.5, max_lag + 0.5)
        ax.legend(fontsize=8, loc="upper right", framealpha=0.9)
        fig.tight_layout(pad=1.5)
        return _fig_to_base64(fig)


# ──────────────────── Prediction vs Actual ────────────────────────────────────

def _make_pred_vs_actual_chart(bt_response, close: pd.Series, lang: str) -> str:
    """Show actual vs predicted values for the best model across walk-forward windows."""
    if not bt_response or not bt_response.results:
        return ""

    sorted_r = sorted(bt_response.results, key=lambda r: r.metrics.rmse)
    best = sorted_r[0] if sorted_r else None
    if not best or not best.windows or len(best.windows) < 2:
        return ""

    with plt.rc_context(CHART_STYLE):
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 8),
                                        gridspec_kw={"height_ratios": [2, 1]})

        model_name = best.model.value
        window_maes = [w.mae for w in best.windows]
        window_rmses = [w.rmse for w in best.windows]
        window_das = [w.directionalAccuracy * 100 for w in best.windows]
        xs = list(range(1, len(best.windows) + 1))

        ax1.plot(xs, window_maes, color=_C["blue"], linewidth=2, marker="o",
                 markersize=6, label="MAE", zorder=3)
        ax1.plot(xs, window_rmses, color=_C["red"], linewidth=2, marker="s",
                 markersize=5, label="RMSE", alpha=0.8, zorder=3)
        ax1.fill_between(xs, window_maes, alpha=0.15, color=_C["blue"], zorder=1)

        mean_mae = np.mean(window_maes)
        ax1.axhline(y=mean_mae, color=_C["amber"], linewidth=1.2, linestyle="--",
                    label=f"Mean MAE: {mean_mae:.6f}", zorder=2)

        title1 = f"{model_name} — MAE & RMSE" + (" po oknách" if lang == "sk" else " across windows")
        ax1.set_title(title1, fontsize=13)
        ax1.set_ylabel("Error" if lang == "en" else "Chyba")
        ax1.legend(fontsize=8, loc="upper right", framealpha=0.9)

        bar_colors = [_C["green"] if d >= 50 else (_C["amber"] if d >= 40 else _C["red"]) for d in window_das]
        ax2.bar(xs, window_das, color=bar_colors, alpha=0.8, edgecolor="white")
        ax2.axhline(y=50, color=_C["slate"], linewidth=1.2, linestyle="--",
                    label="50% baseline", zorder=2)
        mean_da = np.mean(window_das)
        ax2.axhline(y=mean_da, color=_C["blue"], linewidth=1, linestyle=":",
                    label=f"Mean: {mean_da:.1f}%", zorder=2)
        ax2.set_ylim(0, 100)

        title2 = "Smerová presnosť (%)" if lang == "sk" else "Directional Accuracy (%)"
        ax2.set_title(title2, fontsize=12)
        ax2.set_xlabel("Window #" if lang == "en" else "Okno č.")
        ax2.set_ylabel("DA (%)")
        ax2.legend(fontsize=8, loc="lower right", framealpha=0.9)

        fig.tight_layout(pad=2)
        return _fig_to_base64(fig)


# ──────────────────────── Rolling Window Performance ─────────────────────────

def _make_rolling_chart(bt_response, lang: str) -> str:
    """Plot MAE and directional accuracy over walk-forward windows for each model."""
    palette = [_C["blue"], _C["teal"], _C["amber"], _C["purple"], _C["red"]]

    with plt.rc_context(CHART_STYLE):
        fig, (ax_mae, ax_da) = plt.subplots(2, 1, figsize=(13, 6), sharex=True)

        for idx, result in enumerate(bt_response.results):
            if not result.windows:
                continue
            model_name = result.model.value
            color = palette[idx % len(palette)]
            window_maes = [w.mae for w in result.windows]
            window_das = [w.directionalAccuracy * 100 for w in result.windows]
            xs = list(range(1, len(window_maes) + 1))

            ax_mae.plot(xs, window_maes, color=color, linewidth=1.8, marker="o",
                        markersize=5, label=model_name, zorder=3)
            ax_da.plot(xs, window_das, color=color, linewidth=1.8, marker="s",
                       markersize=5, label=model_name, zorder=3)

        # MAE subplot
        ax_mae.set_title("MAE" if lang == "en" else "MAE (priemerná absolútna chyba)",
                         fontsize=12)
        ax_mae.set_ylabel("MAE")
        ax_mae.legend(fontsize=8, loc="upper right", framealpha=0.9)

        # DA subplot
        ax_da.axhline(y=50, color=_C["slate"], linewidth=1, linestyle="--",
                      label="50 % baseline", alpha=0.7)
        title_da = "Smerová presnosť (%)" if lang == "sk" else "Directional Accuracy (%)"
        ax_da.set_title(title_da, fontsize=12)
        ax_da.set_ylabel("DA (%)")
        ax_da.set_xlabel("Window #" if lang == "en" else "Okno č.")
        ax_da.set_ylim(0, 100)
        ax_da.legend(fontsize=8, loc="lower right", framealpha=0.9)

        # X ticks as integers
        n_max = max(len(r.windows) for r in bt_response.results if r.windows) if bt_response.results else 0
        if n_max > 0:
            ax_da.set_xticks(range(1, n_max + 1))

        fig.tight_layout(pad=2)
        return _fig_to_base64(fig)


# ─── Translations ─────────────────────────────────────────────────────────────

TRANSLATIONS = {
    "en": {
        "title": "FX Analytics – Statistical Analysis Report",
        "subtitle": "Statistical Processing and Evaluation of Currency Pair Data",
        "pair_label": "Currency Pair",
        "tf_label": "Timeframe",
        "period_label": "Analysis Period",
        "generated_label": "Generated",
        "data_summary": "Data Summary",
        "total_rows": "Total observations",
        "date_range": "Date range",
        "mean_close": "Mean close",
        "std_close": "Standard deviation",
        "min_close": "Minimum",
        "max_close": "Maximum",
        "price_chart": "Close Price Analysis",
        "returns_analysis": "Log Returns Analysis",
        "models_section": "Forecasting Models",
        "models_desc": "The following forecasting models were trained and evaluated",
        "model_desc_col": "Description / Configuration",
        "ranked_by": "★ = best overall model (lowest RMSE with DA ≥ Naive baseline). ⚠ = DA below 40%.",
        "ranked_by_conflict": "★ = best overall model. 📉 = lowest RMSE but weaker directional accuracy than Naive. ⚠ = DA below 40%.",
        "backtest_title": "Walk-Forward Backtest Results",
        "backtest_desc": "Models were evaluated using a rolling walk-forward validation approach, which provides a realistic assessment of out-of-sample predictive performance.",
        "model_col": "Model",
        "mae_col": "MAE",
        "rmse_col": "RMSE",
        "da_col": "Dir. Accuracy",
        "metrics_chart": "Performance Metrics Comparison",
        "rolling_chart_title": "Rolling Window Performance (MAE over time)",
        "stat_tests": "Statistical Tests",
        "adf_title": "Augmented Dickey-Fuller Test (Stationarity)",
        "adf_desc": "Tests whether the log-return series has a unit root. A stationary series (p < 0.05) is prerequisite for reliable time-series forecasting.",
        "lb_title": "Ljung-Box Test (Residual Autocorrelation)",
        "lb_desc": "Evaluates whether model residuals exhibit significant autocorrelation. No autocorrelation (p > 0.05) indicates the model adequately captures temporal dependencies.",
        "dm_title": "Diebold-Mariano Test (Predictive Accuracy)",
        "dm_desc": "Compares the predictive accuracy of two competing models. A significant result (p < 0.05) indicates a statistically meaningful difference.",
        "statistic": "Test statistic",
        "pvalue": "p-value",
        "result": "Result",
        "stationary_yes": "Stationary",
        "stationary_no": "Non-stationary",
        "no_ac_yes": "No autocorrelation",
        "no_ac_no": "Autocorrelation detected",
        "better_model": "Superior model",
        "interpretation": "Statistical Interpretation and Conclusions",
        "summary_sec": "Summary",
        "comparison_sec": "Model Comparison",
        "tests_sec": "Statistical Test Interpretation",
        "recommendation_sec": "Recommendation",
        "conclusion_sec": "Conclusion",
        "cumulative_title": "Cumulative Returns",
        "qq_title": "Q-Q Plot (Normality Test)",
        "volatility_title": "Rolling Volatility Analysis",
        "acf_title": "Autocorrelation Analysis",
        "pred_vs_actual_title": "Best Model – Detailed Performance",
        "footer": "Generated by FX Analytics v{version} on {date}.",
        "methodology": "Walk-forward cross-validation with standard econometric tests.",
    },
    "sk": {
        "title": "FX Analytics – Štatistická analýza",
        "subtitle": "Štatistické spracovanie a vyhodnotenie údajov o menovom páre",
        "pair_label": "Menový pár",
        "tf_label": "Časový rámec",
        "period_label": "Obdobie analýzy",
        "generated_label": "Vygenerované",
        "data_summary": "Súhrn údajov",
        "total_rows": "Celkový počet pozorovaní",
        "date_range": "Rozsah dátumov",
        "mean_close": "Priemerná uzatváracia cena",
        "std_close": "Štandardná odchýlka",
        "min_close": "Minimum",
        "max_close": "Maximum",
        "price_chart": "Analýza uzatváracej ceny",
        "returns_analysis": "Analýza logaritmických výnosov",
        "models_section": "Predikčné modely",
        "models_desc": "Nasledujúce predikčné modely boli natrénované a vyhodnotené",
        "model_desc_col": "Popis / Konfigurácia",
        "ranked_by": "★ = najlepší celkový model (najnižší RMSE s DA ≥ Naive). ⚠ = DA pod 40 %.",
        "ranked_by_conflict": "★ = najlepší celkový model. 📉 = najnižší RMSE, ale slabšia smerová presnosť ako Naive. ⚠ = DA pod 40 %.",
        "backtest_title": "Výsledky walk-forward backtestu",
        "backtest_desc": "Modely boli vyhodnotené pomocou metódy postupnej walk-forward validácie, ktorá poskytuje realistické posúdenie predikčného výkonu mimo vzorky.",
        "model_col": "Model",
        "mae_col": "MAE",
        "rmse_col": "RMSE",
        "da_col": "Smer. presnosť",
        "metrics_chart": "Porovnanie výkonnostných metrík",
        "rolling_chart_title": "Priebeh výkonnosti v čase (MAE podľa okien)",
        "stat_tests": "Štatistické testy",
        "adf_title": "Rozšírený Dickey-Fullerov test (stacionarita)",
        "adf_desc": "Testuje, či má rad logaritmických výnosov jednotkový koreň. Stacionárny rad (p < 0.05) je predpokladom pre spoľahlivé predikovanie časových radov.",
        "lb_title": "Ljung-Boxov test (autokorelácia reziduálov)",
        "lb_desc": "Vyhodnocuje, či reziduály modelu vykazujú významnú autokoreláciu. Absencia autokorelácie (p > 0.05) naznačuje, že model adekvátne zachytáva časové závislosti.",
        "dm_title": "Diebold-Marianov test (predikčná presnosť)",
        "dm_desc": "Porovnáva predikčnú presnosť dvoch konkurenčných modelov. Významný výsledok (p < 0.05) naznačuje štatisticky významný rozdiel.",
        "statistic": "Testovacia štatistika",
        "pvalue": "p-hodnota",
        "result": "Výsledok",
        "stationary_yes": "Stacionárny",
        "stationary_no": "Nestacionárny",
        "no_ac_yes": "Bez autokorelácie",
        "no_ac_no": "Zistená autokorelácia",
        "better_model": "Lepší model",
        "interpretation": "Štatistická interpretácia a závery",
        "summary_sec": "Súhrn",
        "comparison_sec": "Porovnanie modelov",
        "tests_sec": "Interpretácia štatistických testov",
        "recommendation_sec": "Odporúčanie",
        "conclusion_sec": "Záver",
        "cumulative_title": "Kumulatívny výnos",
        "qq_title": "Q-Q graf (test normality)",
        "volatility_title": "Analýza rolujúcej volatility",
        "acf_title": "Analýza autokorelácie",
        "pred_vs_actual_title": "Najlepší model – detailná výkonnosť",
        "footer": "Vygenerované systémom FX Analytics v{version} dňa {date}.",
        "methodology": "Walk-forward krížová validácia so štandardnými ekonometrickými testami.",
    },
}

# ─── HTML Template ────────────────────────────────────────────────────────────

_jinja_env = Environment(loader=BaseLoader(), autoescape=True)
REPORT_TEMPLATE = _jinja_env.from_string("""\
<!DOCTYPE html>
<html lang="{{ lang }}">
<head>
<meta charset="utf-8">
<title>{{ t.title }} – {{ symbol }}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

  :root {
    --blue-50: #eff6ff; --blue-100: #dbeafe; --blue-500: #3b82f6;
    --blue-600: #2563eb; --blue-700: #1d4ed8; --blue-900: #1e3a5f;
    --slate-50: #f8fafc; --slate-100: #f1f5f9; --slate-200: #e2e8f0;
    --slate-300: #cbd5e1; --slate-400: #94a3b8; --slate-500: #64748b;
    --slate-600: #475569; --slate-700: #334155; --slate-800: #1e293b;
    --slate-900: #0f172a;
    --green-50: #f0fdf4; --green-500: #22c55e; --green-600: #16a34a; --green-700: #15803d;
    --red-50: #fef2f2; --red-500: #ef4444; --red-600: #dc2626; --red-700: #b91c1c;
    --amber-50: #fffbeb; --amber-500: #f59e0b; --amber-600: #d97706;
    --radius: 12px;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
    --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);
    --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.04);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
    color: var(--slate-800); background: #ffffff;
    max-width: 960px; margin: 0 auto; padding: 48px 56px;
    line-height: 1.7; font-size: 14px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* ── Header ────────────────────────────────────── */
  .report-header {
    background: linear-gradient(135deg, var(--slate-900) 0%, var(--blue-700) 100%);
    color: white; border-radius: var(--radius); padding: 32px 36px;
    margin-bottom: 36px; box-shadow: var(--shadow-lg);
    position: relative; overflow: hidden;
  }
  .report-header::before {
    content: ''; position: absolute; top: -50%; right: -20%;
    width: 300px; height: 300px; border-radius: 50%;
    background: rgba(255,255,255,0.04);
  }
  .report-header::after {
    content: ''; position: absolute; bottom: -40%; left: 60%;
    width: 200px; height: 200px; border-radius: 50%;
    background: rgba(255,255,255,0.03);
  }
  .report-header h1 {
    font-size: 28px; font-weight: 800; letter-spacing: -0.5px;
    margin-bottom: 4px; position: relative; z-index: 1;
  }
  .report-header .subtitle {
    font-size: 14px; color: rgba(255,255,255,0.7);
    margin-bottom: 24px; font-weight: 400;
    position: relative; z-index: 1;
  }
  .meta-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
    position: relative; z-index: 1;
  }
  .meta-item {
    background: rgba(255,255,255,0.1); backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 10px;
    padding: 12px 16px; transition: background 0.2s;
  }
  .meta-item .label {
    font-size: 10px; color: rgba(255,255,255,0.55);
    text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600;
  }
  .meta-item .value {
    font-size: 15px; font-weight: 700; color: #ffffff; margin-top: 3px;
  }

  /* ── Section headings ──────────────────────────── */
  h2 {
    font-size: 20px; color: var(--slate-900);
    margin-top: 44px; margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: none;
    counter-increment: section; font-weight: 700;
    letter-spacing: -0.3px;
    position: relative;
  }
  h2::before {
    content: counter(section, decimal-leading-zero);
    color: var(--blue-600); font-size: 13px; font-weight: 800;
    display: block; margin-bottom: 4px; letter-spacing: 1px;
  }
  h2::after {
    content: ''; position: absolute; bottom: 0; left: 0;
    width: 48px; height: 3px; background: var(--blue-600);
    border-radius: 2px;
  }
  body { counter-reset: section; }

  h3 {
    font-size: 16px; color: var(--slate-700);
    margin-top: 28px; margin-bottom: 10px; font-weight: 600;
  }
  p { margin: 8px 0; color: var(--slate-600); }
  .section-desc {
    color: var(--slate-500); font-size: 13.5px; margin-bottom: 18px;
    line-height: 1.6;
  }

  /* ── Tables ────────────────────────────────────── */
  table {
    border-collapse: separate; border-spacing: 0;
    width: 100%; margin: 18px 0; font-size: 13px;
    border-radius: var(--radius); overflow: hidden;
    box-shadow: var(--shadow);
    border: 1px solid var(--slate-200);
  }
  th {
    background: var(--slate-900); color: #ffffff;
    font-weight: 600; text-align: center;
    padding: 12px 16px; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.5px;
    border: none;
  }
  th:first-child { text-align: left; }
  td {
    padding: 10px 16px; text-align: right;
    border-bottom: 1px solid var(--slate-100);
    border-left: none; border-right: none; border-top: none;
    font-variant-numeric: tabular-nums;
  }
  td:first-child { text-align: left; font-weight: 500; color: var(--slate-700); }
  tr:nth-child(even) td { background: var(--slate-50); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--blue-50); }
  .best-row td { background: var(--blue-50) !important; }

  /* ── Charts ────────────────────────────────────── */
  .chart-container {
    margin: 24px 0; text-align: center;
    background: white; border-radius: var(--radius);
    padding: 8px; border: 1px solid var(--slate-200);
    box-shadow: var(--shadow-md);
  }
  .chart-container img {
    width: 100%; max-width: 880px; border-radius: 8px;
    display: block; margin: 0 auto;
  }

  /* ── Stat badges ───────────────────────────────── */
  .stat-pass {
    display: inline-block; background: var(--green-50);
    color: var(--green-700); padding: 4px 12px;
    border-radius: 20px; font-size: 12px; font-weight: 600;
    border: 1px solid rgba(22, 163, 74, 0.2);
  }
  .stat-fail {
    display: inline-block; background: var(--red-50);
    color: var(--red-700); padding: 4px 12px;
    border-radius: 20px; font-size: 12px; font-weight: 600;
    border: 1px solid rgba(220, 38, 38, 0.2);
  }

  /* ── Test cards ────────────────────────────────── */
  .test-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 18px; margin: 20px 0;
  }
  .test-card {
    background: white; border: 1px solid var(--slate-200);
    border-radius: var(--radius); padding: 22px;
    box-shadow: var(--shadow); transition: box-shadow 0.2s, transform 0.2s;
  }
  .test-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  .test-card h4 {
    font-size: 14px; color: var(--slate-900); margin-bottom: 4px;
    font-weight: 700;
  }
  .test-card .test-desc {
    font-size: 11.5px; color: var(--slate-400); margin-bottom: 14px;
    line-height: 1.5;
  }
  .test-card .test-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 0; font-size: 13px;
    border-bottom: 1px solid var(--slate-100);
  }
  .test-card .test-row:last-child { border-bottom: none; }
  .test-card .test-row .test-label { color: var(--slate-500); }
  .test-card .test-row .test-value {
    font-weight: 600;
    font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
    font-size: 12.5px;
  }

  /* ── Interpretation ────────────────────────────── */
  .interp-section {
    background: var(--slate-50); border: 1px solid var(--slate-200);
    border-radius: var(--radius); padding: 28px 32px; margin: 24px 0;
    box-shadow: var(--shadow);
  }
  .interp-section h3 {
    color: var(--slate-900); margin-top: 0; margin-bottom: 16px; font-size: 17px;
  }
  .interp-label {
    font-weight: 700; color: var(--blue-600); font-size: 12px;
    margin-top: 20px; margin-bottom: 6px;
    text-transform: uppercase; letter-spacing: 0.6px;
    display: flex; align-items: center; gap: 8px;
  }
  .interp-label::before {
    content: ''; display: inline-block;
    width: 4px; height: 16px; background: var(--blue-600);
    border-radius: 2px;
  }
  .interp-label:first-of-type { margin-top: 0; }
  .interp-text {
    color: var(--slate-600); font-size: 13.5px; line-height: 1.75;
    padding-left: 12px;
  }

  .conclusion-box {
    background: linear-gradient(135deg, var(--blue-50) 0%, var(--green-50) 100%);
    border: 1px solid #bae6fd; border-left: 5px solid var(--blue-600);
    border-radius: var(--radius); padding: 24px 28px; margin: 24px 0;
    box-shadow: var(--shadow);
  }
  .conclusion-box h4 {
    color: var(--blue-900); margin-bottom: 10px; font-size: 15px;
    font-weight: 700;
  }
  .conclusion-box p {
    color: var(--slate-700); font-style: italic;
    line-height: 1.8; font-size: 13.5px;
  }

  /* ── Warning callout ───────────────────────────── */
  .warning-callout {
    font-size: 12.5px; color: var(--amber-600);
    background: var(--amber-50);
    border: 1px solid #fde68a; border-left: 4px solid var(--amber-500);
    border-radius: 8px; padding: 10px 14px; margin-top: 10px;
    line-height: 1.6;
  }

  /* ── Ranking note ──────────────────────────────── */
  .ranking-note {
    font-size: 11.5px; color: var(--slate-400);
    margin-top: 6px; line-height: 1.5;
  }

  /* ── Footer ────────────────────────────────────── */
  .footer {
    margin-top: 56px; padding: 20px 0;
    border-top: 2px solid var(--slate-200);
    font-size: 11.5px; color: var(--slate-400); text-align: center;
  }
  .footer .methodology {
    margin-bottom: 4px; font-weight: 500;
    color: var(--slate-500);
  }

  /* ── Print ─────────────────────────────────────── */
  @media print {
    body { padding: 20px; max-width: 100%; }
    .report-header { break-after: auto; }
    .chart-container { break-inside: avoid; }
    .test-card { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
  @media (max-width: 700px) {
    body { padding: 20px 16px; }
    .meta-grid { grid-template-columns: repeat(2, 1fr); }
    .test-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>

<div class="report-header">
  <h1>{{ t.title }}</h1>
  <div class="subtitle">{{ t.subtitle }}</div>
  <div class="meta-grid">
    <div class="meta-item"><div class="label">{{ t.pair_label }}</div><div class="value">{{ symbol }}</div></div>
    <div class="meta-item"><div class="label">{{ t.tf_label }}</div><div class="value">{{ timeframe_human }} ({{ timeframe }})</div></div>
    <div class="meta-item"><div class="label">{{ t.period_label }}</div><div class="value">{{ data_start }} – {{ data_end }}</div></div>
    <div class="meta-item"><div class="label">{{ t.generated_label }}</div><div class="value">{{ generated_at }}</div></div>
  </div>
</div>

<h2>{{ t.data_summary }}</h2>
<table>
  <tr><td>{{ t.total_rows }}</td><td>{{ data_rows }}</td></tr>
  <tr><td>{{ t.date_range }}</td><td>{{ data_start }} – {{ data_end }}</td></tr>
  <tr><td>{{ t.mean_close }}</td><td>{{ mean_close }}</td></tr>
  <tr><td>{{ t.std_close }}</td><td>{{ std_close }}</td></tr>
  <tr><td>{{ t.min_close }}</td><td>{{ min_close }}</td></tr>
  <tr><td>{{ t.max_close }}</td><td>{{ max_close }}</td></tr>
</table>

{% if price_chart %}
<h2>{{ t.price_chart }}</h2>
<div class="chart-container"><img src="{{ price_chart }}" alt="Price Chart" /></div>
{% endif %}

{% if returns_chart %}
<h2>{{ t.returns_analysis }}</h2>
<div class="chart-container"><img src="{{ returns_chart }}" alt="Returns" /></div>
{% endif %}

{% if cumulative_chart %}
<h2>{{ t.cumulative_title }}</h2>
<div class="chart-container"><img src="{{ cumulative_chart }}" alt="Cumulative Returns" /></div>
{% endif %}

{% if qq_chart %}
<h2>{{ t.qq_title }}</h2>
<div class="chart-container"><img src="{{ qq_chart }}" alt="Q-Q Plot" /></div>
{% endif %}

{% if volatility_chart %}
<h2>{{ t.volatility_title }}</h2>
<div class="chart-container"><img src="{{ volatility_chart }}" alt="Volatility" /></div>
{% endif %}

{% if acf_chart %}
<h2>{{ t.acf_title }}</h2>
<div class="chart-container"><img src="{{ acf_chart }}" alt="ACF" /></div>
{% endif %}

{% if models_section %}
<h2>{{ t.models_section }}</h2>
<p class="section-desc">{{ t.models_desc }}: <strong>{{ models_list }}</strong></p>
{% if model_details %}
<table>
  <tr><th>{{ t.model_col }}</th><th>{{ t.model_desc_col }}</th></tr>
  {% for md in model_details %}
  <tr><td>{{ md.name }}</td><td>{{ md.desc }}</td></tr>
  {% endfor %}
</table>
{% endif %}
{% endif %}

{% if backtest_section %}
<h2>{{ t.backtest_title }}</h2>
<p class="section-desc">{{ t.backtest_desc }}</p>
<table>
  <tr><th>{{ t.model_col }}</th><th>{{ t.mae_col }}</th><th>{{ t.rmse_col }}</th><th>{{ t.da_col }}</th></tr>
  {% for m in backtest_results %}
  <tr{% if loop.index0 == best_model_idx %} class="best-row"{% elif da_rmse_conflict and loop.index0 == best_rmse_idx %} style="background:var(--amber-50)"{% endif %}>
    <td>{{ m.model }}{% if loop.index0 == best_model_idx %} ★{% endif %}{% if da_rmse_conflict and loop.index0 == best_rmse_idx and loop.index0 != best_model_idx %} 📉{% endif %}{% if m.da < 40 %} ⚠{% endif %}</td>
    <td>{{ m.mae }}</td>
    <td>{{ m.rmse }}</td>
    <td{% if m.da >= 50 %} style="color:var(--green-600);font-weight:600"{% elif m.da < 50 %} style="color:var(--red-600)"{% endif %}>{{ m.da }}%</td>
  </tr>
  {% endfor %}
</table>
<p class="ranking-note">{% if da_rmse_conflict %}{{ t.ranked_by_conflict }}{% else %}{{ t.ranked_by }}{% endif %}{% if bt_windows_note %} {{ bt_windows_note }}{% endif %}</p>
{% if conflict_note %}
<div class="warning-callout">⚠ {{ conflict_note }}</div>
{% endif %}
{% if backtest_chart %}
<h3>{{ t.metrics_chart }}</h3>
<div class="chart-container"><img src="{{ backtest_chart }}" alt="Metrics" /></div>
{% endif %}
{% if rolling_chart %}
<h3>{{ t.rolling_chart_title }}</h3>
<div class="chart-container"><img src="{{ rolling_chart }}" alt="Rolling Metrics" /></div>
{% endif %}
{% if pred_actual_chart %}
<h3>{{ t.pred_vs_actual_title }}</h3>
<div class="chart-container"><img src="{{ pred_actual_chart }}" alt="Best Model Performance" /></div>
{% endif %}
{% endif %}

{% if tests_section %}
<h2>{{ t.stat_tests }}</h2>
<div class="test-grid">
  <div class="test-card">
    <h4>{{ t.adf_title }}</h4>
    <div class="test-desc">{{ t.adf_desc }}</div>
    <div class="test-row"><span class="test-label">{{ t.statistic }}</span><span class="test-value">{{ adf_stat }}</span></div>
    <div class="test-row"><span class="test-label">{{ t.pvalue }}</span><span class="test-value">{{ adf_pval_fmt }}</span></div>
    <div class="test-row"><span class="test-label">{{ t.result }}</span><span>{% if adf_stationary %}<span class="stat-pass">{{ t.stationary_yes }}</span>{% else %}<span class="stat-fail">{{ t.stationary_no }}</span>{% endif %}</span></div>
  </div>
  <div class="test-card">
    <h4>{{ t.lb_title }}</h4>
    <div class="test-desc">{{ t.lb_desc }}</div>
    <div class="test-row"><span class="test-label">{{ t.statistic }}</span><span class="test-value">{{ lb_stat }}</span></div>
    <div class="test-row"><span class="test-label">{{ t.pvalue }}</span><span class="test-value">{{ lb_pval_fmt }}</span></div>
    <div class="test-row"><span class="test-label">{{ t.result }}</span><span>{% if lb_no_ac %}<span class="stat-pass">{{ t.no_ac_yes }}</span>{% else %}<span class="stat-fail">{{ t.no_ac_no }}</span>{% endif %}</span></div>
  </div>
  {% if dm_section %}
  <div class="test-card">
    <h4>{{ t.dm_title }}</h4>
    <div class="test-desc">{{ t.dm_desc }}</div>
    <div class="test-row"><span class="test-label">{{ t.statistic }}</span><span class="test-value">{{ dm_stat }}</span></div>
    <div class="test-row"><span class="test-label">{{ t.pvalue }}</span><span class="test-value">{{ dm_pval_fmt }}</span></div>
    <div class="test-row"><span class="test-label">{{ t.better_model }}</span><span class="test-value">{{ dm_better }}</span></div>
  </div>
  {% endif %}
</div>
{% endif %}

{% if ai_analysis %}
<h2>{{ t.interpretation }}</h2>
<div class="interp-section">
  {% if ai_analysis.summary %}
  <div class="interp-label">{{ t.summary_sec }}</div>
  <div class="interp-text">{{ ai_analysis.summary }}</div>
  {% endif %}
  {% if ai_analysis.model_comparison %}
  <div class="interp-label">{{ t.comparison_sec }}</div>
  <div class="interp-text">{{ ai_analysis.model_comparison }}</div>
  {% endif %}
  {% if ai_analysis.test_interpretation %}
  <div class="interp-label">{{ t.tests_sec }}</div>
  <div class="interp-text">{{ ai_analysis.test_interpretation }}</div>
  {% endif %}
  {% if ai_analysis.recommendation %}
  <div class="interp-label">{{ t.recommendation_sec }}</div>
  <div class="interp-text">{{ ai_analysis.recommendation }}</div>
  {% endif %}
</div>
{% if ai_analysis.conclusion %}
<div class="conclusion-box">
  <h4>{{ t.conclusion_sec }}</h4>
  <p>{{ ai_analysis.conclusion }}</p>
</div>
{% endif %}
{% endif %}

<div class="footer">
  <div class="methodology">{{ t.methodology }}</div>
  <div>{{ footer_text }}</div>
</div>

</body>
</html>
""")


# ─── Public API ───────────────────────────────────────────────────────────────

async def generate_report(
    db: AsyncSession,
    req: GenerateReportRequest,
    precomputed_bt_resp=None,
) -> ReportItem:
    """Generate a professional HTML report with optional charts and analysis.

    If *precomputed_bt_resp* (a BacktestResponse) is provided, the backtest
    step is skipped and the supplied results are used instead.  This ensures
    the report shows exactly the same numbers the user saw on the Analysis page.
    """
    report_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    symbol = req.pair
    lang = req.language or "en"
    t = TRANSLATIONS.get(lang, TRANSLATIONS["en"])

    row = ReportRow(
        id=report_id,
        symbol=symbol,
        timeframe=req.timeframe.value,
        start=req.start,
        end=req.end,
        models=[m.value for m in req.models],
        options_json={
            "includeCharts": req.includeCharts,
            "includeTests": req.includeTests,
            "language": lang,
        },
        status="Generating",
    )
    db.add(row)
    await db.commit()

    try:
        close = await get_close_series(db, symbol, req.timeframe.value, req.start, req.end)

        # Compute actual data range (may differ from requested range)
        data_start_str = close.index[0].strftime("%Y-%m-%d") if len(close) > 0 else "N/A"
        data_end_str = close.index[-1].strftime("%Y-%m-%d") if len(close) > 0 else "N/A"

        # Build model details table
        model_descs = MODEL_DESCRIPTIONS.get(lang, MODEL_DESCRIPTIONS["en"])
        model_details = [
            {"name": m.value, "desc": model_descs.get(m.value, m.value)}
            for m in req.models
        ]

        template_vars = {
            "t": t,
            "lang": lang,
            "symbol": symbol,
            "timeframe": req.timeframe.value,
            "timeframe_human": _human_timeframe(req.timeframe.value, lang),
            "start": req.start,
            "end": req.end,
            "generated_at": now.strftime("%Y-%m-%d %H:%M UTC"),
            "version": settings.APP_VERSION,
            "data_rows": len(close),
            "data_start": data_start_str,
            "data_end": data_end_str,
            "mean_close": round(float(close.mean()), 6) if len(close) > 0 else "N/A",
            "std_close": round(float(close.std()), 6) if len(close) > 0 else "N/A",
            "min_close": round(float(close.min()), 6) if len(close) > 0 else "N/A",
            "max_close": round(float(close.max()), 6) if len(close) > 0 else "N/A",
            "models_section": bool(req.models),
            "models_list": ", ".join(m.value for m in req.models),
            "model_details": model_details,
            "backtest_section": False,
            "backtest_results": [],
            "backtest_chart": "",
            "rolling_chart": "",
            "best_model_idx": 0,
            "best_rmse_idx": 0,
            "best_da_idx": 0,
            "da_rmse_conflict": False,
            "conflict_note": "",
            "bt_windows_note": "",
            "tests_section": req.includeTests,
            "dm_section": False,
            "adf_stat": 0.0,
            "adf_pval": 1.0,
            "adf_pval_fmt": "N/A",
            "adf_stationary": False,
            "lb_stat": 0.0,
            "lb_pval": 1.0,
            "lb_pval_fmt": "N/A",
            "lb_no_ac": True,
            "dm_stat": 0.0,
            "dm_pval": 1.0,
            "dm_pval_fmt": "N/A",
            "dm_better": "N/A",
            "price_chart": "",
            "returns_chart": "",
            "cumulative_chart": "",
            "qq_chart": "",
            "volatility_chart": "",
            "acf_chart": "",
            "pred_actual_chart": "",
            "ai_analysis": None,
            "footer_text": t["footer"].replace("{version}", settings.APP_VERSION).replace("{date}", now.strftime("%Y-%m-%d %H:%M UTC")),
        }

        # Charts
        if req.includeCharts and len(close) > 1:
            try:
                template_vars["price_chart"] = _make_price_chart(close, symbol, lang)
                template_vars["returns_chart"] = _make_returns_chart(close, symbol, lang)
            except Exception as e:
                log.warning("report.chart_failed", error=str(e))
            try:
                template_vars["cumulative_chart"] = _make_cumulative_chart(close, symbol, lang)
            except Exception as e:
                log.warning("report.cumulative_chart_failed", error=str(e))
            try:
                template_vars["qq_chart"] = _make_qq_chart(close, lang)
            except Exception as e:
                log.warning("report.qq_chart_failed", error=str(e))
            try:
                template_vars["volatility_chart"] = _make_volatility_chart(close, symbol, lang)
            except Exception as e:
                log.warning("report.volatility_chart_failed", error=str(e))
            try:
                template_vars["acf_chart"] = _make_acf_chart(close, lang)
            except Exception as e:
                log.warning("report.acf_chart_failed", error=str(e))

        # Backtest
        backtest_data_for_ai = None
        tests_data_for_ai = None
        bt_resp = precomputed_bt_resp  # may be None

        if bt_resp is None and req.models and len(close) >= 60:
            from app.services.backtest_service import run_backtest
            from app.schemas.schemas import BacktestRequest

            bt_req = BacktestRequest(
                pair=symbol,
                timeframe=req.timeframe,
                start=req.start,
                end=req.end,
                models=req.models,
                windowTrainDays=max(30, len(close) // 3),
                windowTestDays=max(5, len(close) // 10),
                stepDays=max(5, len(close) // 10),
            )
            bt_resp = await run_backtest(db, bt_req)

        if bt_resp is not None and req.models:

            # Sort by RMSE (best first) — more standard in literature
            sorted_results = sorted(bt_resp.results, key=lambda r: r.metrics.rmse)

            bt_results_list = [
                {
                    "model": r.model.value,
                    "mae": round(r.metrics.mae, 6),
                    "rmse": round(r.metrics.rmse, 6),
                    "da": round(r.metrics.directionalAccuracy * 100, 1),
                }
                for r in sorted_results
            ]

            if not bt_results_list:
                log.warning("report.empty_backtest_results", symbol=req.pair, timeframe=req.timeframe)

            # ── Smart best-model selection ──────────────────────────────
            best_idx = 0
            best_rmse_idx = 0
            best_da_idx = 0
            da_rmse_conflict = False
            conflict_note = ""

            if bt_results_list:
                # Find Naive DA as the baseline to beat
                naive_da = 50.0  # default fallback
                for r in bt_results_list:
                    if r["model"] == "Naive":
                        naive_da = r["da"]
                        break

                # Best by RMSE (among models with DA >= Naive DA)
                viable = [
                    (i, r) for i, r in enumerate(bt_results_list)
                    if r["da"] >= naive_da
                ]
                if viable:
                    best_rmse_idx = min(viable, key=lambda x: x[1]["rmse"])[0]

                # Best by DA (highest directional accuracy)
                best_da_idx = max(range(len(bt_results_list)), key=lambda i: bt_results_list[i]["da"])

                # Determine overall best: if best-RMSE model has DA < Naive, prefer Naive or best-DA
                best_rmse_model = bt_results_list[best_rmse_idx]
                best_da_model = bt_results_list[best_da_idx]
                rmse_beats_naive_da = best_rmse_model["da"] >= naive_da

                # Mark the row to highlight — use best-RMSE if it also beats Naive on DA,
                # otherwise use best-DA model
                if rmse_beats_naive_da:
                    best_idx = best_rmse_idx
                else:
                    best_idx = best_da_idx

                # Build warning note about RMSE-best vs DA-best conflict
                da_rmse_conflict = (best_rmse_idx != best_da_idx)
                if da_rmse_conflict:
                    rmse_name = best_rmse_model["model"]
                    da_name = best_da_model["model"]
                    rmse_da = best_rmse_model["da"]
                    da_da = best_da_model["da"]
                    if lang == "sk":
                        conflict_note = (
                            f"Poznámka: {rmse_name} má najnižší RMSE, ale jeho smerová presnosť "
                            f"({rmse_da}%) je nižšia ako u modelu {da_name} ({da_da}%). "
                            f"Nízka smerová presnosť znamená, že model síce minimalizuje absolútnu chybu, "
                            f"ale nemusí správne predpovedať smer pohybu ceny."
                        )
                    else:
                        conflict_note = (
                            f"Note: {rmse_name} has the lowest RMSE, but its directional accuracy "
                            f"({rmse_da}%) is lower than {da_name} ({da_da}%). "
                            f"Low directional accuracy means the model minimizes absolute error "
                            f"but may not correctly predict price direction."
                        )

            template_vars["backtest_section"] = True
            template_vars["backtest_results"] = bt_results_list
            template_vars["best_model_idx"] = best_idx
            template_vars["best_rmse_idx"] = best_rmse_idx
            template_vars["best_da_idx"] = best_da_idx
            template_vars["da_rmse_conflict"] = da_rmse_conflict
            template_vars["conflict_note"] = conflict_note

            # Backtest window info
            n_windows = len(sorted_results[0].windows) if sorted_results and sorted_results[0].windows else 0
            if lang == "sk":
                template_vars["bt_windows_note"] = (
                    f"Walk-forward: {n_windows} okien."
                )
            else:
                template_vars["bt_windows_note"] = (
                    f"Walk-forward: {n_windows} windows."
                )

            if req.includeCharts and bt_results_list:
                try:
                    template_vars["backtest_chart"] = _make_backtest_chart(bt_results_list, lang)
                except Exception as e:
                    log.warning("report.backtest_chart_failed", error=str(e))
                # Rolling performance chart (MAE/DA over windows)
                try:
                    template_vars["rolling_chart"] = _make_rolling_chart(bt_resp, lang)
                except Exception as e:
                    log.warning("report.rolling_chart_failed", error=str(e))
                # Best model detailed performance chart
                try:
                    template_vars["pred_actual_chart"] = _make_pred_vs_actual_chart(bt_resp, close, lang)
                except Exception as e:
                    log.warning("report.pred_actual_chart_failed", error=str(e))

            backtest_data_for_ai = [
                {
                    "model": r.model.value,
                    "mae": r.metrics.mae,
                    "rmse": r.metrics.rmse,
                    "directionalAccuracy": r.metrics.directionalAccuracy,
                }
                for r in sorted_results
            ]

            if req.includeTests:
                template_vars["adf_stat"] = round(bt_resp.tests.adf.statistic, 6)
                template_vars["adf_pval"] = round(bt_resp.tests.adf.pValue, 6)
                template_vars["adf_pval_fmt"] = _format_pval(bt_resp.tests.adf.pValue)
                template_vars["adf_stationary"] = bt_resp.tests.adf.isStationary
                template_vars["lb_stat"] = round(bt_resp.tests.ljungBox.statistic, 6)
                template_vars["lb_pval"] = round(bt_resp.tests.ljungBox.pValue, 6)
                template_vars["lb_pval_fmt"] = _format_pval(bt_resp.tests.ljungBox.pValue)
                template_vars["lb_no_ac"] = bt_resp.tests.ljungBox.noAutocorrelation

                tests_data_for_ai = {
                    "adf": {
                        "statistic": bt_resp.tests.adf.statistic,
                        "pValue": bt_resp.tests.adf.pValue,
                        "pValue_display": _format_pval(bt_resp.tests.adf.pValue),
                        "isStationary": bt_resp.tests.adf.isStationary,
                    },
                    "ljungBox": {
                        "statistic": bt_resp.tests.ljungBox.statistic,
                        "pValue": bt_resp.tests.ljungBox.pValue,
                        "pValue_display": _format_pval(bt_resp.tests.ljungBox.pValue),
                        "noAutocorrelation": bt_resp.tests.ljungBox.noAutocorrelation,
                    },
                }

                if bt_resp.tests.dieboldMariano:
                    dm_better = bt_resp.tests.dieboldMariano.betterModel
                    dm_better_str = dm_better.value if dm_better else "N/A"
                    template_vars["dm_section"] = True
                    template_vars["dm_stat"] = round(bt_resp.tests.dieboldMariano.statistic, 6)
                    template_vars["dm_pval"] = round(bt_resp.tests.dieboldMariano.pValue, 6)
                    template_vars["dm_pval_fmt"] = _format_pval(bt_resp.tests.dieboldMariano.pValue)
                    template_vars["dm_better"] = dm_better_str
                    tests_data_for_ai["dieboldMariano"] = {
                        "statistic": bt_resp.tests.dieboldMariano.statistic,
                        "pValue": bt_resp.tests.dieboldMariano.pValue,
                        "betterModel": dm_better_str,
                    }
            else:
                template_vars["tests_section"] = False

        # AI Analysis
        if settings.OPENAI_API_KEY and (backtest_data_for_ai or tests_data_for_ai):
            try:
                from app.services.ai_analysis import analyze_results

                # Provide best-model context to AI so it can be honest about comparisons
                _loc = locals()
                data_summary = {
                    "rows": len(close),
                    "start": template_vars["data_start"],
                    "end": template_vars["data_end"],
                    "mean_close": template_vars["mean_close"],
                    "std_close": template_vars["std_close"],
                    "naive_da": _loc.get("naive_da"),
                    "best_rmse_model": best_rmse_model["model"] if "best_rmse_model" in _loc else None,
                    "best_rmse_da": best_rmse_model["da"] if "best_rmse_model" in _loc else None,
                    "best_da_model": best_da_model["model"] if "best_da_model" in _loc else None,
                    "best_da_value": best_da_model["da"] if "best_da_model" in _loc else None,
                    "da_rmse_conflict": _loc.get("da_rmse_conflict", False),
                }

                ai_result = await analyze_results(
                    pair=symbol,
                    timeframe=req.timeframe.value,
                    start=req.start,
                    end=req.end,
                    backtest_results=backtest_data_for_ai,
                    statistical_tests=tests_data_for_ai,
                    data_summary=data_summary,
                    language=lang,
                )
                template_vars["ai_analysis"] = ai_result
            except Exception as e:
                log.warning("report.ai_analysis_failed", error=str(e))

        html_content = REPORT_TEMPLATE.render(**template_vars)

        report_path = settings.reports_path / f"{report_id}.html"
        report_path.write_text(html_content, encoding="utf-8")

        # Also generate Excel from the same backtest data
        excel_path_str = None
        try:
            from app.services.excel_report_service import generate_excel_report
            _, excel_file_path = await generate_excel_report(
                db, req, precomputed_bt_resp=bt_resp,
            )
            excel_path_str = str(excel_file_path)
            log.info("report.excel_also_generated", report_id=report_id)
        except Exception as e:
            log.warning("report.excel_generation_failed", error=str(e))

        row.status = "Ready"
        row.file_path = str(report_path)
        row.excel_path = excel_path_str
        row.content_type = "text/html"
        row.updated_at = now
        await db.commit()

        log.info("report.generated", report_id=report_id)

    except Exception as e:
        log.error("report.failed", report_id=report_id, error=str(e))
        row.status = "Failed"
        row.updated_at = datetime.now(timezone.utc)
        await db.commit()

    return _row_to_item(row)


async def list_reports(db: AsyncSession) -> list[ReportItem]:
    stmt = select(ReportRow).order_by(ReportRow.created_at.desc()).limit(100)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [_row_to_item(r) for r in rows]


async def get_report(db: AsyncSession, report_id: str) -> ReportRow | None:
    stmt = select(ReportRow).where(ReportRow.id == report_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


def _safe_unlink(file_path: str) -> None:
    """Delete a file only if it is within the artifacts directory."""
    p = Path(file_path).resolve()
    try:
        p.relative_to(settings.artifacts_path.resolve())
    except ValueError:
        log.warning("delete.path_outside_artifacts", path=str(p))
        return
    if p.exists():
        p.unlink()


async def delete_report(db: AsyncSession, report_id: str) -> bool:
    stmt = select(ReportRow).where(ReportRow.id == report_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None:
        return False
    if row.file_path:
        _safe_unlink(row.file_path)
    if row.excel_path:
        _safe_unlink(row.excel_path)
    await db.execute(sql_delete(ReportRow).where(ReportRow.id == report_id))
    await db.commit()
    return True


def _row_to_item(row: ReportRow) -> ReportItem:
    return ReportItem(
        id=row.id,
        createdAt=row.created_at.isoformat() if row.created_at else "",
        pair=row.symbol,
        timeframe=row.timeframe,
        start=row.start,
        end=row.end,
        models=row.models or [],
        status=row.status,
        downloadUrl=f"/reports/{row.id}/download" if row.status == "Ready" else None,
        hasExcel=bool(row.excel_path),
    )

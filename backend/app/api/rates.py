"""Live exchange rates and currency converter API."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.logging_config import get_logger

log = get_logger(__name__)

router = APIRouter(tags=["Rates"])

# ─── Rate cache (simple in-memory) ───────────────────────────────────────────

_rate_cache: dict = {"rates": {}, "updated_at": 0}
CACHE_TTL = 30  # seconds

# All currency pairs vs USD that we support
# Format: "XXXUSD=X" means 1 XXX = Y USD  (or "USDXXX=X" means 1 USD = Y XXX)
RATE_TICKERS = {
    "EUR": "EURUSD=X",    # 1 EUR = X USD
    "GBP": "GBPUSD=X",    # 1 GBP = X USD
    "CHF": "USDCHF=X",    # 1 USD = X CHF (inverted)
    "JPY": "USDJPY=X",    # 1 USD = X JPY (inverted)
    "CAD": "USDCAD=X",    # 1 USD = X CAD (inverted)
    "AUD": "AUDUSD=X",    # 1 AUD = X USD
    "NZD": "NZDUSD=X",    # 1 NZD = X USD
    "SEK": "USDSEK=X",    # 1 USD = X SEK (inverted)
    "NOK": "USDNOK=X",    # 1 USD = X NOK (inverted)
    "DKK": "USDDKK=X",    # 1 USD = X DKK (inverted)
    "PLN": "USDPLN=X",    # 1 USD = X PLN (inverted)
    "CZK": "USDCZK=X",    # 1 USD = X CZK (inverted)
    "HUF": "USDHUF=X",    # 1 USD = X HUF (inverted)
    "TRY": "USDTRY=X",    # 1 USD = X TRY (inverted)
    "CNY": "USDCNY=X",    # 1 USD = X CNY (inverted)
}

# Currencies where the ticker gives "1 XXX = Y USD" (direct quote vs USD)
DIRECT_QUOTE = {"EUR", "GBP", "AUD", "NZD"}

# All supported currencies
ALL_CURRENCIES = ["USD"] + sorted(RATE_TICKERS.keys())


def _fetch_rates_from_yfinance() -> dict[str, float]:
    """Fetch current exchange rates from yfinance. Returns rates as X per 1 USD."""
    import yfinance as yf

    rates_vs_usd: dict[str, float] = {"USD": 1.0}

    tickers_list = list(RATE_TICKERS.values())

    try:
        # Use download for batch fetching (faster than individual Ticker calls)
        data = yf.download(
            tickers_list,
            period="1d",
            interval="1m",
            progress=False,
            threads=True,
        )

        if data.empty:
            # Fallback: try individual tickers
            return _fetch_rates_individual()

        # Get the latest close price for each ticker
        close_data = data["Close"] if "Close" in data.columns else data.get("close", data)

        for currency, ticker in RATE_TICKERS.items():
            try:
                if ticker in close_data.columns:
                    series = close_data[ticker].dropna()
                elif len(RATE_TICKERS) == 1:
                    # Single ticker case: close_data is a Series
                    series = close_data.dropna()
                else:
                    continue

                if series.empty:
                    continue

                price = float(series.iloc[-1])

                if currency in DIRECT_QUOTE:
                    # ticker gives "1 XXX = price USD", we want "1 USD = 1/price XXX"
                    rates_vs_usd[currency] = round(1.0 / price, 6) if price > 0 else 0
                else:
                    # ticker gives "1 USD = price XXX"
                    rates_vs_usd[currency] = round(price, 6)
            except Exception as e:
                log.warning("rates.parse_error", currency=currency, error=str(e))

    except Exception as e:
        log.error("rates.batch_fetch_error", error=str(e))
        return _fetch_rates_individual()

    return rates_vs_usd


def _fetch_rates_individual() -> dict[str, float]:
    """Fallback: fetch rates one by one."""
    import yfinance as yf

    rates_vs_usd: dict[str, float] = {"USD": 1.0}

    for currency, ticker_str in RATE_TICKERS.items():
        try:
            ticker = yf.Ticker(ticker_str)
            hist = ticker.history(period="1d")
            if hist.empty:
                continue
            price = float(hist["Close"].iloc[-1])
            if currency in DIRECT_QUOTE:
                rates_vs_usd[currency] = round(1.0 / price, 6) if price > 0 else 0
            else:
                rates_vs_usd[currency] = round(price, 6)
        except Exception as e:
            log.warning("rates.individual_error", currency=currency, error=str(e))

    return rates_vs_usd


def _get_cached_rates() -> dict[str, float]:
    """Get rates from cache or refresh if stale."""
    now = time.time()
    if now - _rate_cache["updated_at"] > CACHE_TTL or not _rate_cache["rates"]:
        log.info("rates.refreshing")
        rates = _fetch_rates_from_yfinance()
        if rates and len(rates) > 1:  # at least USD + 1 other
            _rate_cache["rates"] = rates
            _rate_cache["updated_at"] = now
        elif _rate_cache["rates"]:
            # Keep stale data if refresh failed
            pass
        else:
            _rate_cache["rates"] = {"USD": 1.0}
    return _rate_cache["rates"]


# ─── Schemas ──────────────────────────────────────────────────────────────────

class RateInfo(BaseModel):
    currency: str
    rateVsUsd: float  # How many units of this currency per 1 USD
    name: str


class LiveRatesResponse(BaseModel):
    baseCurrency: str
    rates: list[RateInfo]
    updatedAt: str


class ConvertRequest(BaseModel):
    fromCurrency: str
    toCurrency: str
    amount: float


class ConvertResponse(BaseModel):
    fromCurrency: str
    toCurrency: str
    amount: float
    result: float
    rate: float
    updatedAt: str


# Currency display names
CURRENCY_NAMES = {
    "USD": "US Dollar",
    "EUR": "Euro",
    "GBP": "British Pound",
    "JPY": "Japanese Yen",
    "CHF": "Swiss Franc",
    "CAD": "Canadian Dollar",
    "AUD": "Australian Dollar",
    "NZD": "New Zealand Dollar",
    "SEK": "Swedish Krona",
    "NOK": "Norwegian Krone",
    "DKK": "Danish Krone",
    "PLN": "Polish Złoty",
    "CZK": "Czech Koruna",
    "HUF": "Hungarian Forint",
    "TRY": "Turkish Lira",
    "CNY": "Chinese Yuan",
}


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/rates/live", response_model=LiveRatesResponse)
async def get_live_rates():
    """Get current exchange rates for all supported currencies vs USD."""
    rates = _get_cached_rates()

    rate_list = []
    for currency in ALL_CURRENCIES:
        if currency in rates:
            rate_list.append(RateInfo(
                currency=currency,
                rateVsUsd=rates[currency],
                name=CURRENCY_NAMES.get(currency, currency),
            ))

    return LiveRatesResponse(
        baseCurrency="USD",
        rates=rate_list,
        updatedAt=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/rates/convert", response_model=ConvertResponse)
async def convert_currency(req: ConvertRequest):
    """Convert an amount between two currencies using latest rates."""
    from_curr = req.fromCurrency.upper()
    to_curr = req.toCurrency.upper()

    rates = _get_cached_rates()

    if from_curr not in rates and from_curr != "USD":
        raise HTTPException(400, f"Unsupported currency: {from_curr}")
    if to_curr not in rates and to_curr != "USD":
        raise HTTPException(400, f"Unsupported currency: {to_curr}")

    # Convert: from_curr → USD → to_curr
    from_rate = rates.get(from_curr, 1.0)  # units per 1 USD
    to_rate = rates.get(to_curr, 1.0)      # units per 1 USD

    # amount in from_curr → USD: amount / from_rate (if from_rate is units per USD)
    # Actually: from_rate = "how many from_curr per 1 USD"
    # So: amount_usd = amount / from_rate
    # Then: result = amount_usd * to_rate

    if from_rate == 0:
        raise HTTPException(400, f"Rate for {from_curr} is zero")

    amount_usd = req.amount / from_rate
    result = amount_usd * to_rate
    direct_rate = to_rate / from_rate  # 1 from_curr = direct_rate to_curr

    return ConvertResponse(
        fromCurrency=from_curr,
        toCurrency=to_curr,
        amount=req.amount,
        result=round(result, 4),
        rate=round(direct_rate, 6),
        updatedAt=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/rates/currencies")
async def list_currencies():
    """List all supported currencies."""
    return [
        {"code": c, "name": CURRENCY_NAMES.get(c, c)}
        for c in ALL_CURRENCIES
    ]

# FX Analytics – Backend

Python/FastAPI backend for statistical processing and prediction of FX currency pairs.

## Tech Stack

- **FastAPI** – web framework
- **SQLAlchemy 2.0** – async ORM (SQLite by default)
- **Alembic** – database migrations
- **yfinance** – FX data ingestion (free, no API key required)
- **statsmodels** – ARIMA time-series modeling
- **scikit-learn** – Ridge, RandomForest regression
- **Pydantic v2** – request/response validation
- **structlog** – structured logging

## Quick Start

### 1. Create virtual environment

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Linux/Mac
# venv\Scripts\activate    # Windows
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Environment variables

```bash
cp .env.example .env
# Edit .env if needed (defaults work out of the box)
```

### 4. Run migrations (optional – tables are auto-created on startup)

```bash
alembic upgrade head
```

### 5. Start the server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API is now available at **http://localhost:8000**.
OpenAPI docs at **http://localhost:8000/docs**.

### 6. Connect the frontend

In the frontend, go to **Settings** and:
1. Set **API Base URL** to `http://localhost:8000`
2. Turn **off** Mock Mode

## Docker

```bash
docker-compose up --build
```

## API Endpoints

| Method | Path                       | Description              |
|--------|----------------------------|--------------------------|
| GET    | `/health`                  | Health check             |
| GET    | `/data/ohlc`               | Get OHLC bars            |
| GET    | `/data/summary`            | Data summary             |
| POST   | `/data/update`             | Ingest data from yfinance|
| GET    | `/data/export`             | Export CSV               |
| POST   | `/models/train`            | Train a model            |
| GET    | `/models`                  | List trained models      |
| POST   | `/models/forecast`         | Generate forecast        |
| DELETE | `/models/{id}`             | Delete a model           |
| POST   | `/backtest/run`            | Run backtest             |
| GET    | `/reports`                 | List reports             |
| POST   | `/reports/generate`        | Generate report          |
| GET    | `/reports/{id}/download`   | Download report file     |
| DELETE | `/reports/{id}`            | Delete a report          |

## Sample curl Requests

### Ingest data
```bash
curl -X POST http://localhost:8000/data/update \
  -H "Content-Type: application/json" \
  -d '{"pair":"EURUSD","timeframe":"1D","start":"2023-01-01","end":"2024-12-31"}'
```

### Get OHLC data
```bash
curl "http://localhost:8000/data/ohlc?pair=EURUSD&timeframe=1D&start=2023-01-01&end=2024-12-31"
```

### Train a model
```bash
curl -X POST http://localhost:8000/models/train \
  -H "Content-Type: application/json" \
  -d '{
    "pair":"EURUSD","timeframe":"1D",
    "start":"2023-01-01","end":"2024-12-31",
    "model":"ARIMA",
    "hyperparams":{"p":1,"d":1,"q":1}
  }'
```

### Forecast
```bash
curl -X POST http://localhost:8000/models/forecast \
  -H "Content-Type: application/json" \
  -d '{"modelId":"<model-id-from-train>","horizon":10}'
```

### Run backtest
```bash
curl -X POST http://localhost:8000/backtest/run \
  -H "Content-Type: application/json" \
  -d '{
    "pair":"EURUSD","timeframe":"1D",
    "start":"2023-01-01","end":"2024-12-31",
    "models":["Naive","ARIMA","Ridge"],
    "windowTrainDays":120,"windowTestDays":20,"stepDays":20
  }'
```

### Generate report
```bash
curl -X POST http://localhost:8000/reports/generate \
  -H "Content-Type: application/json" \
  -d '{
    "pair":"EURUSD","timeframe":"1D",
    "start":"2023-01-01","end":"2024-12-31",
    "models":["ARIMA","Ridge"],
    "includeCharts":true,"includeTests":true
  }'
```

## Supported Currency Pairs

| Pair   | yfinance Ticker |
|--------|-----------------|
| EURUSD | EURUSD=X        |
| USDJPY | USDJPY=X        |
| GBPUSD | GBPUSD=X        |
| EURGBP | EURGBP=X        |
| USDCHF | USDCHF=X        |

## Timeframes

- **1D** – daily (primary, fully supported)
- **1H** – hourly (yfinance: last ~730 days)
- **4H** – 4-hour (aggregated from 1H data)

## Project Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI application
│   ├── core/                 # Config, database, logging
│   ├── models/               # SQLAlchemy ORM models
│   ├── schemas/              # Pydantic schemas
│   ├── services/             # Business logic
│   │   ├── ingestion.py      # yfinance data ingestion
│   │   ├── ohlc_service.py   # OHLC data retrieval
│   │   ├── model_service.py  # Model training & forecasting
│   │   ├── backtest_service.py  # Walk-forward backtesting
│   │   └── report_service.py # HTML report generation
│   ├── api/                  # FastAPI route handlers
│   └── utils/                # Helpers (metrics, indicators, time)
├── alembic/                  # Database migrations
├── artifacts/                # Trained models & reports
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

# FX Analytics — Statistical Processing and Evaluation of Currency Pair Data

> **Bakalárska práca:** Štatistické spracovanie a vyhodnotenie údajov o vybraných menových pároch

A full-stack web application for collecting, analyzing, predicting, and backtesting foreign exchange (FX) currency pair data.

## Features

- **Data Collection** — Automated OHLC data ingestion from Yahoo Finance for major FX pairs (EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, NZD/USD)
- **Interactive Charts** — Candlestick charts with technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands)
- **Model Training & Forecasting** — Train and compare prediction models:
  - Naive (baseline)
  - Moving Average
  - ARIMA (auto-parameter selection via pmdarima)
  - Ridge Regression
  - Random Forest
  - AI-Enhanced Ensemble (GPT-4o-mini)
- **Walk-Forward Backtesting** — Rigorous out-of-sample evaluation with statistical tests (ADF, Ljung-Box, Diebold-Mariano)
- **Comprehensive Reports** — HTML and Excel reports with charts, risk analysis, technical indicators, and model comparison
- **Currency Converter** — Real-time exchange rates with live updates
- **Interactive Guide** — Step-by-step "How It Works" page explaining the methodology

## Tech Stack

### Frontend
- React 18 + TypeScript
- Vite (build tool)
- Tailwind CSS + shadcn/ui
- Lightweight Charts (TradingView)
- React Query (data fetching)
- Recharts (additional charts)

### Backend
- Python 3.11+ / FastAPI
- SQLAlchemy 2.0 (async) + SQLite
- pandas, NumPy, scikit-learn, statsmodels, pmdarima
- OpenAI API (for AI Ensemble model)
- openpyxl (Excel report generation)
- Jinja2 (HTML report templates)

## Quick Start

### Prerequisites
- Node.js 20+
- Python 3.11+
- npm

### Frontend

```bash
npm install
npm run dev
```

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Linux/Mac
pip install -r requirements.txt

# Create .env file
cp .env.example .env
# Edit .env and set your OPENAI_API_KEY (optional, only for AI Ensemble)

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Docker (alternative)

```bash
cd backend
docker-compose up --build
```

## Project Structure

```
├── src/                    # Frontend (React + TypeScript)
│   ├── api/client.ts       # API client
│   ├── pages/              # Page components
│   ├── components/         # Reusable UI components
│   ├── hooks/              # Custom React hooks
│   └── types/              # TypeScript type definitions
├── backend/                # Backend (Python + FastAPI)
│   ├── app/
│   │   ├── api/            # API route handlers
│   │   ├── services/       # Business logic
│   │   ├── models/         # Database ORM models
│   │   ├── schemas/        # Pydantic schemas
│   │   ├── utils/          # Helper utilities
│   │   └── core/           # Config, database, logging
│   ├── alembic/            # Database migrations
│   ├── requirements.txt    # Python dependencies
│   └── Dockerfile          # Container support
├── deploy.sh               # Server deployment script
└── package.json            # Frontend dependencies
```

## API Documentation

When the backend is running, visit:
- Swagger UI: `http://localhost:8000/docs`
- OpenAPI spec: `http://localhost:8000/openapi.json`

## Live Demo

- **Website:** [https://fx-analytics.xyz](https://fx-analytics.xyz)

## Author

Bakalárska práca — TUKE 2026

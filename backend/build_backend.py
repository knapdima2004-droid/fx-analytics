"""Build script: packages the FastAPI backend into a standalone directory
using PyInstaller. Run from the backend/ folder:

    python build_backend.py

Output goes to ../backend_dist/
"""
import PyInstaller.__main__
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, '..', 'backend_dist')

if os.path.exists(DIST):
    shutil.rmtree(DIST)

PyInstaller.__main__.run([
    'fx_backend_entry.py',
    '--name=fx-backend',
    '--onedir',
    f'--distpath={DIST}',
    '--noconfirm',
    '--clean',
    # Include the entire app package
    '--collect-all=app',
    '--collect-all=jinja2',
    '--collect-all=sqlalchemy',
    '--collect-all=aiosqlite',
    '--collect-all=yfinance',
    '--collect-all=pmdarima',
    '--collect-all=statsmodels',
    '--collect-all=sklearn',
    '--collect-all=scipy',
    '--collect-all=numpy',
    '--collect-all=pandas',
    '--collect-all=openpyxl',
    '--collect-all=matplotlib',
    '--collect-all=openai',
    '--collect-all=pydantic',
    '--collect-all=pydantic_settings',
    '--collect-all=uvicorn',
    '--collect-all=fastapi',
    '--collect-all=starlette',
    '--hidden-import=app.main',
    '--hidden-import=app.api.health',
    '--hidden-import=app.api.data',
    '--hidden-import=app.api.models_router',
    '--hidden-import=app.api.backtest',
    '--hidden-import=app.api.reports',
    '--hidden-import=app.api.analysis',
    '--hidden-import=app.api.rates',
    '--hidden-import=app.services.ingestion',
    '--hidden-import=app.services.ohlc_service',
    '--hidden-import=app.services.model_service',
    '--hidden-import=app.services.backtest_service',
    '--hidden-import=app.services.report_service',
    '--hidden-import=app.services.excel_report_service',
    '--hidden-import=app.services.forecast_excel_service',
    '--hidden-import=app.services.ai_prediction',
    '--hidden-import=app.services.ai_analysis',
    '--hidden-import=app.services.data_validation',
    '--hidden-import=app.core.config',
    '--hidden-import=app.core.database',
    '--hidden-import=app.core.logging_config',
    '--hidden-import=app.models.orm',
    '--hidden-import=app.schemas.schemas',
    '--hidden-import=app.utils.metrics',
    '--hidden-import=app.utils.indicators',
    '--hidden-import=app.utils.time_helpers',
    '--hidden-import=uvicorn.logging',
    '--hidden-import=uvicorn.loops',
    '--hidden-import=uvicorn.loops.auto',
    '--hidden-import=uvicorn.protocols',
    '--hidden-import=uvicorn.protocols.http',
    '--hidden-import=uvicorn.protocols.http.auto',
    '--hidden-import=uvicorn.protocols.websockets',
    '--hidden-import=uvicorn.protocols.websockets.auto',
    '--hidden-import=uvicorn.lifespan',
    '--hidden-import=uvicorn.lifespan.on',
    '--hidden-import=engineio.async_drivers.aiohttp',
    '--hidden-import=multipart',
    '--hidden-import=structlog',
    '--hidden-import=joblib',
])

print(f"\nBackend built successfully to: {os.path.abspath(DIST)}")
print("Copy the fx-backend/ directory into electron resources for packaging.")

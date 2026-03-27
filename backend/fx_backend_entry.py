"""Entry point for PyInstaller-packaged backend.

Launches uvicorn with the FastAPI app using settings from environment
or .env file located next to the executable.
"""
import os
import sys

if getattr(sys, 'frozen', False):
    os.chdir(os.path.dirname(sys.executable))

import uvicorn
from app.core.config import settings

if __name__ == '__main__':
    uvicorn.run(
        'app.main:app',
        host=settings.HOST,
        port=settings.PORT,
        log_level='info',
    )

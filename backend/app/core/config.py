"""Application configuration loaded from environment variables."""

from __future__ import annotations

from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./fx_analytics.db"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:8080,http://localhost:3000"

    # Logging
    LOG_LEVEL: str = "INFO"

    # Artifacts
    ARTIFACTS_DIR: str = "./artifacts"

    # Optional API keys
    ALPHA_VANTAGE_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    OPENAI_MODEL: str = "gpt-4o-mini"

    # App metadata
    APP_VERSION: str = "0.1.0"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def artifacts_path(self) -> Path:
        p = Path(self.ARTIFACTS_DIR)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def models_path(self) -> Path:
        p = self.artifacts_path / "models"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def reports_path(self) -> Path:
        p = self.artifacts_path / "reports"
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()

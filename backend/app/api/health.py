"""Health-check endpoint."""

from fastapi import APIRouter

from app.core.config import settings
from app.schemas.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(ok=True, version=settings.APP_VERSION)

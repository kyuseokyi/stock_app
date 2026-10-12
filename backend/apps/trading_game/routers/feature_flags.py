"""기능 on/off 관리자 API (Phase 5b)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import FeatureFlagResponse, FeatureFlagUpdate
from apps.trading_game.services import feature_flag_service

router = APIRouter(prefix="/api/game/admin", tags=["trading-game-admin"])


def _dto(f) -> FeatureFlagResponse:
    return FeatureFlagResponse(key=f.key, enabled=f.enabled, updated_at=f.updated_at)


@router.get("/feature-flags", response_model=list[FeatureFlagResponse])
async def list_feature_flags(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return [_dto(f) for f in await feature_flag_service.list_flags(db)]


@router.put("/feature-flags/{key}", response_model=FeatureFlagResponse)
async def update_feature_flag(
    key: str,
    body: FeatureFlagUpdate,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = await feature_flag_service.set_flag(db, deps.get_redis(), key, body.enabled)
    except feature_flag_service.UnknownFlag:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "알 수 없는 기능 플래그입니다.")
    return _dto(row)

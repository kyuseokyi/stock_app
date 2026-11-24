"""기능 on/off 관리자 API (Phase 5b)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared import admin_permissions as P
from shared.auth import ensure_permission, require_permission
from shared.database import get_db
from shared.models import User
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import FeatureFlagResponse, FeatureFlagUpdate
from apps.trading_game.services import feature_flag_service, real_market

log = logging.getLogger("trading_game.flags_admin")
router = APIRouter(prefix="/api/game/admin", tags=["trading-game-admin"])


def _dto(f) -> FeatureFlagResponse:
    return FeatureFlagResponse(key=f.key, enabled=f.enabled, updated_at=f.updated_at)


@router.get("/feature-flags", response_model=list[FeatureFlagResponse])
async def list_feature_flags(
    _admin: User = Depends(require_permission(P.GAME_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    return [_dto(f) for f in await feature_flag_service.list_flags(db)]


@router.put("/feature-flags/{key}", response_model=FeatureFlagResponse)
async def update_feature_flag(
    key: str,
    body: FeatureFlagUpdate,
    admin: User = Depends(require_permission(P.GAME_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    if key == real_market.FLAG:
        # 실시간 게임 = 실시간 시세 노출 — 전체 시세 스위치와 같은 권한을 추가로 요구한다(게임 관리 권한만으로는 못 켬)
        await ensure_permission(db, admin, P.SCREENER_SETTINGS)
    try:
        row = await feature_flag_service.set_flag(db, deps.get_redis(), key, body.enabled)
    except feature_flag_service.UnknownFlag:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "알 수 없는 기능 플래그입니다.")
    log.info("기능 플래그 변경 key=%s enabled=%s admin=%s", key, body.enabled, admin.id)
    return _dto(row)

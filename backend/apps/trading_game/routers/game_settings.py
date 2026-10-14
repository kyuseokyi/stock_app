"""게임 운영 설정 — 관리자 조회·변경 + 공개 보상 안내(reward-config)."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User
from apps.trading_game.services import game_settings_service

log = logging.getLogger("trading_game.settings_admin")
router = APIRouter(prefix="/api/game", tags=["trading-game-settings"])


@router.get("/admin/settings")
async def get_game_settings(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await game_settings_service.get_settings(db)


@router.put("/admin/settings")
async def update_game_settings(
    body: Any = Body(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """부분 갱신 — 보낸 키만 바꾼다. 검증 실패 422."""
    try:
        out = await game_settings_service.update_settings(db, body)
    except game_settings_service.InvalidSettings as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    log.info("게임 설정 변경 keys=%s admin=%s", sorted(body), admin.id)
    return out


@router.get("/reward-config")
async def reward_config(db: AsyncSession = Depends(get_db)):
    """공개 — 클라이언트 보상 안내 문구용 금액."""
    s = await game_settings_service.get_settings(db)
    return {"weekly": s["weekly_rewards"], "monthly": s["monthly_rewards"], "streak": s["streak_rewards"]}

"""야간 차트 퀴즈 + 연속 출석 REST (Phase 5b)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import StreakResponse
from apps.trading_game.services import feature_flag_service, streak_service

router = APIRouter(prefix="/api/game", tags=["trading-game-quiz"])
log = logging.getLogger("trading_game.quiz")


@router.get("/streak/my", response_model=StreakResponse)
async def my_streak(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    enabled = await feature_flag_service.is_enabled(db, deps.get_redis(), "STREAK")
    row = await streak_service.get_streak(db, user.id)
    if row is None:
        return StreakResponse(current_streak=0, highest_streak=0, last_activity_date=None, enabled=enabled)
    return StreakResponse(
        current_streak=row.current_streak, highest_streak=row.highest_streak,
        last_activity_date=row.last_activity_date, enabled=enabled,
    )

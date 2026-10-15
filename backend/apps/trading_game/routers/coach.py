"""데일리 스마트 코치 REST (Phase 5a) — 관리자 발행 + 유저 오늘 코칭 조회."""
from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user, require_admin
from shared.database import get_db
from shared.models import User
from apps.trading_game.schemas.game_dtos import (
    CoachLevelsResponse, CoachMessageResponse, CoachTodayResponse, CoachType, CoachUpsertRequest,
    SeasonOption,
)
from apps.trading_game.services import account_service, coach_levels_service, coach_service, ws_bus

router = APIRouter(prefix="/api/game", tags=["trading-game-coach"])
log = logging.getLogger("trading_game.coach")

_ERROR_STATUS = {
    "SEASON_NOT_FOUND": status.HTTP_404_NOT_FOUND,
    "ALREADY_PUBLISHED": status.HTTP_409_CONFLICT,
    "SLOT_CONFLICT": status.HTTP_409_CONFLICT,
}


@router.put("/admin/coach-messages", response_model=CoachMessageResponse)
async def upsert_coach_message(
    body: CoachUpsertRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        msg = await coach_service.upsert_coach_message(db, req=body, author_id=admin.id)
    except coach_service.CoachError as e:
        raise HTTPException(_ERROR_STATUS[e.code], str(e))
    if body.action == "publish":
        try:
            active = await account_service.get_active_season(db)
            if (
                active is not None
                and active.id == msg.season_id
                and msg.target_date == coach_service.kst_today()
            ):
                await ws_bus.publish_users(coach_service.coach_push_payload(msg))  # 코치는 로그인 전용
        except Exception:
            log.warning("코치 발행 WS push 실패(발행은 정상 완료) id=%s", msg.id, exc_info=True)
    return coach_service.to_dto(msg)


@router.get("/admin/coach-messages", response_model=list[CoachMessageResponse])
async def list_coach_messages(
    season_id: int,
    target_date: date,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await coach_service.list_slot_messages(db, season_id, target_date)
    return [coach_service.to_dto(m) for m in rows]


@router.get("/admin/coach-levels/suggest", response_model=CoachLevelsResponse)
async def suggest_coach_levels(
    season_id: int,
    target_date: date,
    coach_type: CoachType,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """시즌 종목 일봉으로 지지·저항 추천값 계산 — 폼 채우기용, 저장하지 않는다."""
    try:
        return await coach_levels_service.suggest(db, season_id, target_date, coach_type)
    except coach_levels_service.SeasonNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "시즌을 찾을 수 없습니다.")
    except coach_levels_service.BarsUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "일봉 데이터를 불러올 수 없어요.")


@router.get("/admin/seasons", response_model=list[SeasonOption])
async def list_seasons(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return [
        SeasonOption(
            id=s.id, season_number=s.season_number, ticker=s.ticker, stock_name=s.stock_name,
            status=s.status, start_at=s.start_at, end_at=s.end_at,
            period=s.period,
        )
        for s in await coach_service.list_seasons(db)
    ]


@router.get("/coach/today", response_model=CoachTodayResponse)
async def coach_today(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = coach_service.kst_today()
    season_id, morning, evening = await coach_service.today_coach(db, today)
    m = coach_service.to_dto(morning) if morning else None
    e = coach_service.to_dto(evening) if evening else None
    return CoachTodayResponse(target_date=today, season_id=season_id, morning=m, evening=e, active=e or m)

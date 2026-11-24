"""교육용 합성 종가 게임 REST — /api/game/edu/* + 관리자 /api/game/admin/edu/*.

명세: docs/edu_synthetic_daily_game_spec_and_plan.md 4.3
- 게임 탭 노출은 실시간 시즌(/api/game/seasons/active)과 분리 — GET /state 가 항상 enabled 를 준다.
- 탭(메뉴) 노출 판단만 필요하면 GET /features(전역 플래그 두 개, 인증 무시, 시즌 생성 없음)를 쓴다.
- EDU_DAILY_GAME OFF: state 는 200 {enabled:false}, action·history·leaderboard 는 403 {"detail":"edu_game_disabled"}.
- 합성 데이터라 REAL_MARKET(A안 시세 비노출) 판정을 걸지 않는다. 비로그인도 state·leaderboard 조회 가능.
- 관리자 API 는 플래그와 무관하게 동작(GAME_MANAGE 권한).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared import admin_permissions as P
from shared.auth import get_current_user, get_optional_user, require_permission
from shared.database import get_db
from shared.models import User
from apps.trading_game import deps
from apps.trading_game.schemas.edu_game_dtos import (
    EduActionRequest, EduActionResponse, EduAdminSeasonDTO, EduAdvanceResponse, EduHistoryResponse,
    EduFeaturesResponse, EduLeaderboardResponse, EduNewSeasonRequest, EduRegimeRequest, EduStateResponse,
)
from apps.trading_game.services import edu_game_service as svc
from apps.trading_game.services import feature_flag_service
from apps.trading_game.services import real_market

log = logging.getLogger("trading_game.edu_router")
router = APIRouter(tags=["trading-game-edu"])


async def _enabled(db: AsyncSession) -> bool:
    return await feature_flag_service.is_enabled(db, deps.get_redis(), svc.FLAG)


async def _require_enabled(db: AsyncSession) -> None:
    if not await _enabled(db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, svc.DISABLED_DETAIL)


def _http(e: svc.EduGameError) -> HTTPException:
    return HTTPException(e.status, detail={"code": e.code, "message": str(e)})


# ---------------------------------------------------------------- 사용자
FEATURES_CACHE_CONTROL = "public, max-age=30"  # 플래그 Redis 캐시(30초)와 같은 주기 — 사용자와 무관한 공개 값


async def _safe_enabled(db: AsyncSession) -> bool:
    """EDU_DAILY_GAME 플래그. 조회 오류 = false(닫힘) — features 는 탭 노출 판단용이라 500 대신 닫는다."""
    try:
        return await _enabled(db)
    except Exception as exc:  # noqa: BLE001 — 기본은 닫힘
        log.warning("EDU_DAILY_GAME 플래그 조회 실패 — OFF 로 판정: %s", type(exc).__name__)
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return False


@router.get("/api/game/edu/features", response_model=EduFeaturesResponse)
async def edu_features(response: Response, db: AsyncSession = Depends(get_db)):
    """게임 탭(메뉴) 노출 판단값만 — 전역 플래그 두 개. 인증을 보지 않는다(토큰이 없거나 잘못돼도 200).

    /state 와 달리 시즌을 만들지 않고 DB 에 아무것도 쓰지 않는다(크롤러·미리 불러오기가 시즌을 만들지 않게).
    """
    switch = await real_market.flag_on(db, deps.get_redis())
    enabled = await _safe_enabled(db)
    response.headers["Cache-Control"] = FEATURES_CACHE_CONTROL
    return EduFeaturesResponse(enabled=enabled, real_market_switch=switch)


@router.get("/api/game/edu/state", response_model=EduStateResponse)
async def edu_state(
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """교육 시즌·최근 120봉·오늘 해설·참여자 심리 + (로그인 시) 내 계좌·오늘 참가 여부. 활성 시즌이 없으면 자동 생성.

    real_market_switch = 관리자 전역 REAL_MARKET 스위치(화면이 실시간/가상 데이터 게임 중 무엇을 보일지 정한다).
    시즌 생성·commit 전에 먼저 읽는다(flag_on 은 실패 시 rollback 하고 false 로 닫는다).
    """
    switch = await real_market.flag_on(db, deps.get_redis())
    if not await _enabled(db):
        return EduStateResponse(enabled=False, real_market_switch=switch)
    return {**await svc.get_edu_state(db, user), "real_market_switch": switch}


@router.post("/api/game/edu/action", response_model=EduActionResponse)
async def edu_action(
    body: EduActionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """하루(봉) 1회 의사결정 제출. 이미 냈으면 409 ALREADY_PARTICIPATED_TODAY."""
    await _require_enabled(db)
    try:
        return await svc.submit_daily_action(db, deps.get_redis(), user, body.model_dump())
    except svc.EduGameError as e:
        raise _http(e)


@router.get("/api/game/edu/leaderboard", response_model=EduLeaderboardResponse)
async def edu_leaderboard(
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_enabled(db)
    return await svc.get_leaderboard(db, user)


@router.get("/api/game/edu/history", response_model=EduHistoryResponse)
async def edu_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_enabled(db)
    return await svc.get_history(db, user)


# ---------------------------------------------------------------- 관리자
async def _admin_season_dto(db: AsyncSession, s) -> EduAdminSeasonDTO:
    return EduAdminSeasonDTO(
        id=s.id, season_number=s.season_number, synthetic_code=s.synthetic_code, title=s.title,
        theme_category=s.theme_category, hide_name=s.hide_name, current_day_index=s.current_day_index,
        current_regime=s.current_regime, regime_days_left=s.regime_days_left,
        next_regime_override=s.next_regime_override, status=s.status, start_date=s.start_date,
        last_advanced_date=s.last_advanced_date, participants=await svc.count_participants(db, s.id),
    )


@router.get("/api/game/admin/edu/season", response_model=EduAdminSeasonDTO | None)
async def admin_edu_season(
    _admin: User = Depends(require_permission(P.GAME_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    """관리자 카드용 현재 교육 시즌(국면·남은 봉 수 포함). 없으면 null."""
    s = await svc.get_active_season(db)
    return None if s is None else await _admin_season_dto(db, s)


@router.post("/api/game/admin/edu/advance-day", response_model=EduAdvanceResponse)
async def admin_edu_advance_day(
    admin: User = Depends(require_permission(P.GAME_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    """즉시 다음 봉 1개 생성 + 전 계좌 정산(하루 1회 제한 없음). 활성 시즌이 없으면 먼저 만든다."""
    await svc.get_or_create_active_season(db)
    result = await svc.advance_day_and_settle(db, force=True)
    log.info("교육 게임 관리자 진행 admin=%s result=%s", admin.id, result)
    return result


@router.post("/api/game/admin/edu/new-season", response_model=EduAdminSeasonDTO,
             status_code=status.HTTP_201_CREATED)
async def admin_edu_new_season(
    body: EduNewSeasonRequest,
    admin: User = Depends(require_permission(P.GAME_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    """기존 ACTIVE 교육 시즌을 CLOSED 로 바꾸고 새 시즌 + 워밍업 120봉 생성."""
    try:
        s = await svc.start_new_season(
            db, title=body.title, theme_category=body.theme_category, hide_name=body.hide_name,
            start_price=body.start_price,
        )
    except svc.EduGameError as e:
        raise _http(e)
    log.info("교육 게임 새 시즌 admin=%s season=%s", admin.id, s.id)
    return await _admin_season_dto(db, s)


@router.put("/api/game/admin/edu/regime", response_model=EduAdminSeasonDTO)
async def admin_edu_regime(
    body: EduRegimeRequest,
    admin: User = Depends(require_permission(P.GAME_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    """다음 봉부터 적용할 시장 국면 지정(null = 해제). 한 번 적용되면 자동으로 지워진다."""
    try:
        s = await svc.set_regime_override(db, body.regime)
    except svc.EduGameError as e:
        raise _http(e)
    log.info("교육 게임 국면 지정 admin=%s regime=%s", admin.id, body.regime)
    return await _admin_season_dto(db, s)

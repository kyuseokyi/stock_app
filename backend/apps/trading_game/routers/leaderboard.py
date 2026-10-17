"""트레이딩 게임 랭킹/명예의전당 REST."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from shared.game_models import GameSeason, HallOfFame
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import ActiveSeason, GameFeatures
from apps.trading_game.services import (
    account_service, board_cache, feature_flag_service, monthly_service, ranking_service, weekly_service,
)

router = APIRouter(prefix="/api/game", tags=["trading-game-ranking"])


@router.get("/seasons/active", response_model=ActiveSeason | None)
async def active_season(db: AsyncSession = Depends(get_db)):
    """현재 ACTIVE 시즌(공개) + 기능 on/off. 없으면 null — 유저 웹/앱 게임 화면 헤더용."""
    s = await account_service.get_active_season(db)
    if s is None:
        return None
    redis = deps.get_redis()
    return ActiveSeason(
        id=s.id, season_number=s.season_number, ticker=s.ticker, stock_name=s.stock_name,
        status=s.status, start_at=s.start_at, end_at=s.end_at,
        period=s.period,
        features=GameFeatures(
            quiz=await feature_flag_service.is_enabled(db, redis, "QUIZ"),
            streak=await feature_flag_service.is_enabled(db, redis, "STREAK"),
        ),
    )


@router.get("/seasons/{season_id}/leaderboard")
async def leaderboard(season_id: int, db: AsyncSession = Depends(get_db)):
    redis = deps.get_redis()
    return await board_cache.cached(
        redis, board_cache.cache_key("season", season_id),
        lambda: ranking_service.top_leaderboard(redis, db, season_id, limit=100),
    )


@router.get("/seasons/{season_id}/my-rank")
async def my_rank(
    season_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ranking_service.my_rank(deps.get_redis(), season_id, user.id)


@router.get("/hall-of-fame")
async def hall_of_fame(season_id: int | None = Query(default=None), db: AsyncSession = Depends(get_db)):
    stmt = select(HallOfFame, GameSeason.season_number).join(GameSeason, GameSeason.id == HallOfFame.season_id)
    if season_id is not None:
        stmt = stmt.where(HallOfFame.season_id == season_id)
    stmt = stmt.order_by(HallOfFame.season_id.desc(), HallOfFame.rank.asc()).limit(300)
    rows = (await db.execute(stmt)).all()
    return [
        {"season_id": h.season_id, "season_number": season_number, "rank": h.rank, "nickname": h.user_nickname,
         "final_roi": float(h.final_roi), "final_asset": float(h.final_asset),
         "win_rate": float(h.win_rate), "trading_mbti": h.trading_mbti}
        for h, season_number in rows
    ]


# ---------------------------------------------------------------- 주간 랭킹
async def _season_or_404(db: AsyncSession, season_id: int) -> GameSeason:
    s = await db.get(GameSeason, season_id)
    if s is None:
        raise HTTPException(status_code=404, detail="SEASON_NOT_FOUND")
    return s


@router.get("/seasons/{season_id}/weekly-leaderboard")
async def weekly_leaderboard(season_id: int, db: AsyncSession = Depends(get_db)):
    """공개 — 이번 주 Top 100(월 09:00 시작, 시즌 경계로 잘림)."""
    redis = deps.get_redis()

    async def build():
        return await weekly_service.weekly_leaderboard(db, redis, await _season_or_404(db, season_id))

    return await board_cache.cached(redis, board_cache.cache_key("week", season_id), build)


@router.get("/seasons/{season_id}/weekly-my-rank")
async def weekly_my_rank(
    season_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    season = await _season_or_404(db, season_id)
    return await weekly_service.weekly_my_rank(deps.get_redis(), season, user.id)


@router.get("/weekly-results")
async def weekly_results(
    season_id: int | None = Query(default=None),
    limit: int = Query(default=4, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """공개 — 지난 주들의 Top 3(최신 주 먼저)."""
    return await weekly_service.weekly_results(db, season_id, limit)


@router.get("/weekly-rewards/unseen")
async def weekly_rewards_unseen(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """미확인 보상(주간·월간) — 항목 period_type: week|month. 확인은 /weekly-rewards/{id}/ack 공용."""
    return await weekly_service.unseen_rewards(db, user.id)


@router.post("/weekly-rewards/{result_id}/ack", status_code=204)
async def weekly_reward_ack(
    result_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if not await weekly_service.ack_reward(db, user.id, result_id):
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return Response(status_code=204)


# ---------------------------------------------------------------- 월간 랭킹(분기 시즌 전용, 월간 시즌이면 빈 결과)
@router.get("/seasons/{season_id}/monthly-leaderboard")
async def monthly_leaderboard(season_id: int, db: AsyncSession = Depends(get_db)):
    """공개 — 이번 달 Top 100(1일 09:00 시작, 시즌 경계로 잘림)."""
    redis = deps.get_redis()

    async def build():
        return await monthly_service.monthly_leaderboard(db, redis, await _season_or_404(db, season_id))

    return await board_cache.cached(redis, board_cache.cache_key("month", season_id), build)


@router.get("/seasons/{season_id}/monthly-my-rank")
async def monthly_my_rank(
    season_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    season = await _season_or_404(db, season_id)
    return await monthly_service.monthly_my_rank(deps.get_redis(), season, user.id)


@router.get("/monthly-results")
async def monthly_results(
    season_id: int | None = Query(default=None),
    limit: int = Query(default=3, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    """공개 — 지난달들의 Top 3(최신 달 먼저)."""
    return await monthly_service.monthly_results(db, season_id, limit)

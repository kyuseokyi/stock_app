"""트레이딩 게임 랭킹/명예의전당 REST."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from shared.game_models import HallOfFame
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import SeasonOption
from apps.trading_game.services import account_service, ranking_service

router = APIRouter(prefix="/api/game", tags=["trading-game-ranking"])


@router.get("/seasons/active", response_model=SeasonOption | None)
async def active_season(db: AsyncSession = Depends(get_db)):
    """현재 ACTIVE 시즌(공개). 없으면 null — 유저 웹/앱 게임 화면 헤더용."""
    s = await account_service.get_active_season(db)
    if s is None:
        return None
    return SeasonOption(
        id=s.id, season_number=s.season_number, ticker=s.ticker, stock_name=s.stock_name,
        status=s.status, start_at=s.start_at, end_at=s.end_at,
    )


@router.get("/seasons/{season_id}/leaderboard")
async def leaderboard(season_id: int, db: AsyncSession = Depends(get_db)):
    return await ranking_service.top_leaderboard(deps.get_redis(), db, season_id, limit=100)


@router.get("/seasons/{season_id}/my-rank")
async def my_rank(
    season_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ranking_service.my_rank(deps.get_redis(), season_id, user.id)


@router.get("/hall-of-fame")
async def hall_of_fame(season_id: int | None = Query(default=None), db: AsyncSession = Depends(get_db)):
    stmt = select(HallOfFame)
    if season_id is not None:
        stmt = stmt.where(HallOfFame.season_id == season_id)
    stmt = stmt.order_by(HallOfFame.season_id.desc(), HallOfFame.rank.asc()).limit(300)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {"season_id": h.season_id, "rank": h.rank, "nickname": h.user_nickname,
         "final_roi": float(h.final_roi), "final_asset": float(h.final_asset),
         "win_rate": float(h.win_rate), "trading_mbti": h.trading_mbti}
        for h in rows
    ]

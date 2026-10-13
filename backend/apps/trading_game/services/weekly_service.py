"""주간 랭킹 마감·조회 서비스 — Top 10 기록, 1~3위 보상(그 주 신규 주문 계좌만), 미확인 보상."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.game_models import GameAccount, GamePosition, GameSeason, WeeklyRankingResult
from apps.trading_game.services import account_service, reward_service, weekly_ranking as wr

log = logging.getLogger("trading_game.weekly")


def _week_window(season: GameSeason, week_id: date) -> tuple[datetime, datetime]:
    monday_open = datetime.combine(week_id, wr.WEEK_START, tzinfo=wr.KST)
    _, s, e = wr.week_bounds(monday_open, season.start_at, season.end_at)
    return s, e


async def _opened_in_week(db: AsyncSession, account_id, start: datetime, end: datetime) -> bool:
    # SQLite(테스트)는 naive 를 돌려주므로 파이썬에서 aware 로 맞춰 비교
    rows = (await db.execute(
        select(GamePosition.created_at).where(GamePosition.account_id == account_id)
    )).scalars()
    return any(start <= wr.aware(c) < end for c in rows if c is not None)


async def close_week(db: AsyncSession, redis, season: GameSeason, week_id: date, *, with_reward: bool) -> dict:
    """주간 ZSET Top 10 → weekly_ranking_results(멱등). with_reward 면 1~3위 중 그 주 주문 계좌에 지급."""
    exists = await db.scalar(
        select(func.count()).select_from(WeeklyRankingResult)
        .where(WeeklyRankingResult.season_id == season.id, WeeklyRankingResult.week_start == week_id)
    )
    if exists:
        return {"archived": 0, "rewarded": 0}
    pairs = await redis.zrevrange(wr.week_key(season.id, week_id), 0, wr.ARCHIVE_TOP - 1, withscores=True)
    if not pairs:
        return {"archived": 0, "rewarded": 0}
    uids = [int(u) for u, _ in pairs]
    nicks = dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(uids)))).all())
    start, end = _week_window(season, week_id)
    rewarded = 0
    for rank, (uid_s, score) in enumerate(pairs, start=1):
        uid = int(uid_s)
        amount = Decimal("0")
        if with_reward and rank in wr.REWARDS:
            acc = await db.scalar(
                select(GameAccount).where(GameAccount.season_id == season.id, GameAccount.user_id == uid)
            )
            if acc is not None and await _opened_in_week(db, acc.id, start, end):
                try:
                    await reward_service.grant_cash(db, acc, wr.REWARDS[rank], redis=redis)
                    amount = wr.REWARDS[rank]
                    rewarded += 1
                except reward_service.RewardUnavailable:
                    log.warning("주간 보상 보류(시세 없음) season=%s week=%s user=%s", season.id, week_id, uid)
        db.add(WeeklyRankingResult(
            season_id=season.id, week_start=week_id, rank=rank, user_id=uid, nickname=nicks.get(uid),
            weekly_roi=Decimal(str(score)).quantize(Decimal("0.0001")), reward_amount=amount,
        ))
    await db.commit()
    log.info("주간 마감 season=%s week=%s archived=%s rewarded=%s", season.id, week_id, len(pairs), rewarded)
    return {"archived": len(pairs), "rewarded": rewarded}


async def close_previous_week(db: AsyncSession, redis, *, now: datetime | None = None) -> dict | None:
    """beat(월 08:50 KST): 활성 시즌의 '지난주'(now−1일이 속한 주)를 보상 포함 마감."""
    season = await account_service.get_active_season(db)
    if season is None:
        return None
    now = now or datetime.now(timezone.utc)
    week_id, s, e = wr.week_bounds(now - timedelta(days=1), season.start_at, season.end_at)
    if s >= e:  # 지난주 창이 시즌과 겹치지 않음(시즌이 그 주 이후 시작)
        return None
    out = await close_week(db, redis, season, week_id, with_reward=True)
    return {"week_start": week_id.isoformat(), **out}


async def close_final_week(db: AsyncSession, redis, season: GameSeason) -> dict | None:
    """시즌 정산 직전: 시즌 마지막 주를 기록만(보상 없음)."""
    if season.end_at is None:
        return None
    last_moment = wr.aware(season.end_at) - timedelta(seconds=1)
    week_id, _, _ = wr.week_bounds(last_moment, season.start_at, season.end_at)
    return await close_week(db, redis, season, week_id, with_reward=False)

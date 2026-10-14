"""월간 랭킹 마감·조회(분기 시즌 전용) — Top 10 기록, 1~3위 보상(그 달 신규 주문 계좌만).

기록은 weekly_ranking_results 에 period_type='month', week_start=그 달 1일로 저장한다.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.game_models import GameAccount, GameSeason, WeeklyRankingResult
from apps.trading_game.services import (
    account_service, game_settings_service, monthly_ranking as mr, reward_service, weekly_ranking as wr,
)
from apps.trading_game.services.weekly_service import _opened_in_week

log = logging.getLogger("trading_game.monthly")
PERIOD = "month"
_SKIP_MARGIN = 20  # 탈퇴 유저 건너뛰기 대비 추가로 읽는 수


def is_quarter(season: GameSeason) -> bool:
    return getattr(season, "period", None) == "quarter"


def _month_window(season: GameSeason, month_id: date) -> tuple[datetime, datetime]:
    first_open = datetime.combine(month_id, mr.MONTH_START, tzinfo=wr.KST)
    _, s, e = mr.month_bounds(first_open, season.start_at, season.end_at)
    return s, e


async def close_month(db: AsyncSession, redis, season: GameSeason, month_id: date, *, with_reward: bool) -> dict:
    """월간 ZSET Top 10 → weekly_ranking_results(period_type=month, 멱등). with_reward 면 1~3위 중 그 달 주문 계좌에 지급."""
    sid = season.id  # 롤백 시 ORM 객체가 만료되므로 미리 잡아 둔다
    exists = await db.scalar(
        select(func.count()).select_from(WeeklyRankingResult)
        .where(WeeklyRankingResult.season_id == sid, WeeklyRankingResult.period_type == PERIOD,
               WeeklyRankingResult.week_start == month_id)
    )
    if exists:
        return {"archived": 0, "rewarded": 0}
    raw = await redis.zrevrange(
        mr.month_key(sid, month_id), 0, wr.ARCHIVE_TOP + _SKIP_MARGIN - 1, withscores=True
    )
    if not raw:
        return {"archived": 0, "rewarded": 0}
    uids = [int(u) for u, _ in raw]
    nicks = dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(uids)))).all())
    pairs = [(int(u), score) for u, score in raw if int(u) in nicks][: wr.ARCHIVE_TOP]
    if len(pairs) < min(len(raw), wr.ARCHIVE_TOP):
        log.warning("월간 마감: 탈퇴 유저 제외 season=%s month=%s", sid, month_id)
    if not pairs:
        return {"archived": 0, "rewarded": 0}
    start, end = _month_window(season, month_id)
    rewards = await game_settings_service.monthly_rewards(db) if with_reward else {}
    rewarded = 0
    try:
        for rank, (uid, score) in enumerate(pairs, start=1):
            amount = Decimal("0")
            if with_reward and rewards.get(rank, Decimal("0")) > 0:
                acc = await db.scalar(
                    select(GameAccount).where(GameAccount.season_id == sid, GameAccount.user_id == uid)
                )
                if acc is not None and await _opened_in_week(db, acc.id, start, end):
                    try:
                        await reward_service.grant_cash(db, acc, rewards[rank], redis=redis)
                        amount = rewards[rank]
                        rewarded += 1
                    except reward_service.RewardUnavailable:
                        log.warning("월간 보상 보류(시세 없음) season=%s month=%s user=%s", sid, month_id, uid)
            db.add(WeeklyRankingResult(
                season_id=sid, period_type=PERIOD, week_start=month_id, rank=rank, user_id=uid,
                nickname=nicks.get(uid), weekly_roi=Decimal(str(score)).quantize(Decimal("0.0001")),
                reward_amount=amount,
            ))
        await db.commit()
    except IntegrityError:
        # 동시 마감 — 이번 트랜잭션(보상 포함)을 통째로 되돌린다.
        await db.rollback()
        log.warning("월간 마감 경합 — 이미 기록됨, 롤백 season=%s month=%s", sid, month_id)
        return {"archived": 0, "rewarded": 0}
    log.info("월간 마감 season=%s month=%s archived=%s rewarded=%s", sid, month_id, len(pairs), rewarded)
    return {"archived": len(pairs), "rewarded": rewarded}


async def close_previous_month(db: AsyncSession, redis, *, now: datetime | None = None) -> dict | None:
    """beat(매월 1일 08:55 KST): 활성 분기 시즌의 '지난달'(now−1일이 속한 달)을 보상 포함 마감."""
    season = await account_service.get_active_season(db)
    if season is None or not is_quarter(season):
        return None
    now = now or datetime.now(timezone.utc)
    month_id, s, e = mr.month_bounds(now - timedelta(days=1), season.start_at, season.end_at)
    if s >= e:  # 지난달 창이 시즌과 겹치지 않음
        return None
    # 잘린 끝 = 시즌 종료 → 시즌 마지막 달(정산 지연으로 아직 ACTIVE). 기록만, 보상 없음.
    is_final = season.end_at is not None and e == wr.aware(season.end_at)
    out = await close_month(db, redis, season, month_id, with_reward=not is_final)
    return {"month_start": month_id.isoformat(), **out}


def final_month_id(season: GameSeason) -> date | None:
    """시즌 마지막 달의 month_id(종료 직전 시각이 속한 달). end_at 없으면 None."""
    if season.end_at is None:
        return None
    last_moment = wr.aware(season.end_at) - timedelta(seconds=1)
    return mr.month_bounds(last_moment, season.start_at, season.end_at)[0]


async def close_final_month(db: AsyncSession, redis, season: GameSeason) -> dict | None:
    """시즌 정산 직전: 분기 시즌 마지막 달을 기록만(보상 없음)."""
    month_id = final_month_id(season)
    if month_id is None or not is_quarter(season):
        return None
    return await close_month(db, redis, season, month_id, with_reward=False)


# ---------------------------------------------------------------- 조회
def _now() -> datetime:
    return datetime.now(timezone.utc)


def current_month(season: GameSeason) -> tuple[date, datetime, datetime]:
    """현재 달. 시즌 시작 전(정산 직후)이면 첫 달, 시즌이 끝났으면 마지막 달."""
    now = max(_now(), wr.aware(season.start_at))
    if season.end_at is not None and now >= wr.aware(season.end_at):
        now = wr.aware(season.end_at) - timedelta(seconds=1)
    return mr.month_bounds(now, season.start_at, season.end_at)


async def monthly_leaderboard(db: AsyncSession, redis, season: GameSeason, limit: int = 100) -> dict:
    """월간 시즌이면 빈 결과(month_start/start_at/end_at null, entries [])."""
    if not is_quarter(season):
        return {"month_start": None, "start_at": None, "end_at": None, "entries": []}
    month_id, s, e = current_month(season)
    pairs = await redis.zrevrange(mr.month_key(season.id, month_id), 0, limit - 1, withscores=True)
    uids = [int(u) for u, _ in pairs]
    nicks = dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(uids)))).all()) if uids else {}
    return {
        "month_start": month_id.isoformat(), "start_at": s.isoformat(), "end_at": e.isoformat(),
        "entries": [
            {"rank": i + 1, "user_id": int(u), "nickname": nicks.get(int(u)), "monthly_roi": float(score)}
            for i, (u, score) in enumerate(pairs)
        ],
    }


async def monthly_my_rank(redis, season: GameSeason, user_id: int) -> dict:
    if not is_quarter(season):
        return {"rank": None, "monthly_roi": None, "total": 0}
    month_id, _, _ = current_month(season)
    key = mr.month_key(season.id, month_id)
    total = await redis.zcard(key)
    rank = await redis.zrevrank(key, str(user_id))
    if rank is None:
        return {"rank": None, "monthly_roi": None, "total": total}
    score = await redis.zscore(key, str(user_id))
    return {"rank": rank + 1, "monthly_roi": float(score), "total": total}


async def monthly_results(db: AsyncSession, season_id: int | None, limit: int) -> list[dict]:
    """지난달들의 Top 3(최신 달 먼저). 월간 기록이 없으면 []."""
    R = WeeklyRankingResult
    months_q = select(R.season_id, R.week_start).where(R.period_type == PERIOD).distinct()
    if season_id is not None:
        months_q = months_q.where(R.season_id == season_id)
    months = (await db.execute(
        months_q.order_by(R.week_start.desc(), R.season_id.desc()).limit(limit)
    )).all()
    out = []
    for sid, m in months:
        rows = (await db.execute(
            select(R).where(R.season_id == sid, R.period_type == PERIOD, R.week_start == m, R.rank <= 3)
            .order_by(R.rank)
        )).scalars().all()
        out.append({"season_id": sid, "month_start": m.isoformat(), "entries": [
            {"rank": r.rank, "nickname": r.nickname, "monthly_roi": float(r.weekly_roi),
             "reward_amount": float(r.reward_amount)} for r in rows
        ]})
    return out

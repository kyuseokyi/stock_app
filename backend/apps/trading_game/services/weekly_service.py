"""주간 랭킹 마감·조회 서비스 — Top 10 기록, 1~3위 보상(그 주 신규 주문 계좌만), 미확인 보상."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.game_models import GameAccount, GamePosition, GameSeason, WeeklyRankingResult
from apps.trading_game.services import account_service, reward_service, weekly_ranking as wr

log = logging.getLogger("trading_game.weekly")
_SKIP_MARGIN = 20  # 탈퇴 유저 건너뛰기 대비 추가로 읽는 수


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
    sid = season.id  # 롤백 시 ORM 객체가 만료되므로(async 지연 로드 불가) 미리 잡아 둔다
    exists = await db.scalar(
        select(func.count()).select_from(WeeklyRankingResult)
        .where(WeeklyRankingResult.season_id == sid, WeeklyRankingResult.week_start == week_id)
    )
    if exists:
        return {"archived": 0, "rewarded": 0}
    # 탈퇴(users 에 없는) uid 는 건너뛰고 남은 유저로 순위를 이어 매긴다(FK 오류로 마감 전체 실패 방지).
    # 건너뛴 만큼 Top 10 을 채우도록 여유분까지 읽는다.
    raw = await redis.zrevrange(
        wr.week_key(sid, week_id), 0, wr.ARCHIVE_TOP + _SKIP_MARGIN - 1, withscores=True
    )
    if not raw:
        return {"archived": 0, "rewarded": 0}
    uids = [int(u) for u, _ in raw]
    nicks = dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(uids)))).all())
    pairs = [(int(u), score) for u, score in raw if int(u) in nicks][: wr.ARCHIVE_TOP]
    if len(pairs) < min(len(raw), wr.ARCHIVE_TOP):
        log.warning("주간 마감: 탈퇴 유저 제외 season=%s week=%s", sid, week_id)
    if not pairs:
        return {"archived": 0, "rewarded": 0}
    start, end = _week_window(season, week_id)
    rewarded = 0
    try:
        for rank, (uid, score) in enumerate(pairs, start=1):
            amount = Decimal("0")
            if with_reward and rank in wr.REWARDS:
                acc = await db.scalar(
                    select(GameAccount).where(GameAccount.season_id == sid, GameAccount.user_id == uid)
                )
                if acc is not None and await _opened_in_week(db, acc.id, start, end):
                    try:
                        await reward_service.grant_cash(db, acc, wr.REWARDS[rank], redis=redis)
                        amount = wr.REWARDS[rank]
                        rewarded += 1
                    except reward_service.RewardUnavailable:
                        log.warning("주간 보상 보류(시세 없음) season=%s week=%s user=%s", sid, week_id, uid)
            db.add(WeeklyRankingResult(
                season_id=sid, week_start=week_id, rank=rank, user_id=uid, nickname=nicks.get(uid),
                weekly_roi=Decimal(str(score)).quantize(Decimal("0.0001")), reward_amount=amount,
            ))
        await db.commit()
    except IntegrityError:
        # 동시 마감(다른 워커가 먼저 기록) — 이번 트랜잭션(보상 포함)을 통째로 되돌린다.
        await db.rollback()
        log.warning("주간 마감 경합 — 이미 기록됨, 롤백 season=%s week=%s", sid, week_id)
        return {"archived": 0, "rewarded": 0}
    log.info("주간 마감 season=%s week=%s archived=%s rewarded=%s", sid, week_id, len(pairs), rewarded)
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
    # 잘린 끝 = 시즌 종료 → 시즌 마지막 주(정산 지연으로 아직 ACTIVE). 스펙상 기록만, 보상 없음.
    is_final = season.end_at is not None and e == wr.aware(season.end_at)
    out = await close_week(db, redis, season, week_id, with_reward=not is_final)
    return {"week_start": week_id.isoformat(), **out}


async def close_final_week(db: AsyncSession, redis, season: GameSeason) -> dict | None:
    """시즌 정산 직전: 시즌 마지막 주를 기록만(보상 없음)."""
    week_id = final_week_id(season)
    if week_id is None:
        return None
    return await close_week(db, redis, season, week_id, with_reward=False)


def final_week_id(season: GameSeason) -> date | None:
    """시즌 마지막 주의 week_id(종료 직전 시각이 속한 주). end_at 없으면 None."""
    if season.end_at is None:
        return None
    last_moment = wr.aware(season.end_at) - timedelta(seconds=1)
    return wr.week_bounds(last_moment, season.start_at, season.end_at)[0]


# ---------------------------------------------------------------- 조회
def _now() -> datetime:
    return datetime.now(timezone.utc)


def current_week(season: GameSeason) -> tuple[date, datetime, datetime]:
    """현재 주. 시즌이 끝났으면 마지막 주."""
    now = _now()
    if season.end_at is not None and now >= wr.aware(season.end_at):
        now = wr.aware(season.end_at) - timedelta(seconds=1)
    return wr.week_bounds(now, season.start_at, season.end_at)


async def weekly_leaderboard(db: AsyncSession, redis, season: GameSeason, limit: int = 100) -> dict:
    week_id, s, e = current_week(season)
    pairs = await redis.zrevrange(wr.week_key(season.id, week_id), 0, limit - 1, withscores=True)
    uids = [int(u) for u, _ in pairs]
    nicks = dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(uids)))).all()) if uids else {}
    return {
        "week_start": week_id.isoformat(), "start_at": s.isoformat(), "end_at": e.isoformat(),
        "entries": [
            {"rank": i + 1, "user_id": int(u), "nickname": nicks.get(int(u)), "weekly_roi": float(score)}
            for i, (u, score) in enumerate(pairs)
        ],
    }


async def weekly_my_rank(redis, season: GameSeason, user_id: int) -> dict:
    week_id, _, _ = current_week(season)
    key = wr.week_key(season.id, week_id)
    total = await redis.zcard(key)
    rank = await redis.zrevrank(key, str(user_id))
    if rank is None:
        return {"rank": None, "weekly_roi": None, "total": total}
    score = await redis.zscore(key, str(user_id))
    return {"rank": rank + 1, "weekly_roi": float(score), "total": total}


async def weekly_results(db: AsyncSession, season_id: int | None, limit: int) -> list[dict]:
    """지난 주들의 Top 3(최신 주 먼저)."""
    weeks_q = select(WeeklyRankingResult.season_id, WeeklyRankingResult.week_start).distinct()
    if season_id is not None:
        weeks_q = weeks_q.where(WeeklyRankingResult.season_id == season_id)
    weeks = (await db.execute(
        weeks_q.order_by(WeeklyRankingResult.week_start.desc(), WeeklyRankingResult.season_id.desc()).limit(limit)
    )).all()
    out = []
    for sid, wk in weeks:
        rows = (await db.execute(
            select(WeeklyRankingResult)
            .where(WeeklyRankingResult.season_id == sid, WeeklyRankingResult.week_start == wk,
                   WeeklyRankingResult.rank <= 3)
            .order_by(WeeklyRankingResult.rank)
        )).scalars().all()
        out.append({"season_id": sid, "week_start": wk.isoformat(), "entries": [
            {"rank": r.rank, "nickname": r.nickname, "weekly_roi": float(r.weekly_roi),
             "reward_amount": float(r.reward_amount)} for r in rows
        ]})
    return out


async def unseen_rewards(db: AsyncSession, user_id: int) -> list[dict]:
    """내 미확인 보상(reward_amount>0 AND notified_at IS NULL) — 토스트용."""
    rows = (await db.execute(
        select(WeeklyRankingResult)
        .where(WeeklyRankingResult.user_id == user_id, WeeklyRankingResult.reward_amount > 0,
               WeeklyRankingResult.notified_at.is_(None))
        .order_by(WeeklyRankingResult.id)
    )).scalars().all()
    return [{"id": r.id, "week_start": r.week_start.isoformat(), "rank": r.rank,
             "reward_amount": float(r.reward_amount)} for r in rows]


async def ack_reward(db: AsyncSession, user_id: int, result_id: int) -> bool:
    """보상 토스트 확인 처리. 본인 것이 아니거나 없으면 False."""
    row = await db.get(WeeklyRankingResult, result_id)
    if row is None or row.user_id != user_id:
        return False
    if row.notified_at is None:
        row.notified_at = _now()
        await db.commit()
    return True

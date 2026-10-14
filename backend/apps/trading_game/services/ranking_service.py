"""실시간 랭킹(Redis ZSET) + 라이브 ROI 계산.

ZSET key: game:season:{id}:ranking, member=user_id(str), score=current_roi(%).
order_engine 은 Redis 비의존 유지 — ZADD 는 호출부(tick_listener/orders)에서 이 서비스로.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.game_models import GameAccount, GameSeason
from apps.trading_game.services import monthly_ranking, pricing, weekly_ranking

_PCT_Q = Decimal("0.0001")


def ranking_key(season_id: int) -> str:
    return f"game:season:{season_id}:ranking"


def compute_live_roi(cash_balance: Decimal, open_pos, price: Decimal, initial_cash: Decimal) -> Decimal:
    """보유 포지션 미실현 평가 반영 ROI(%). open_pos=None 이면 현금만."""
    total_asset = cash_balance
    if open_pos is not None:
        roi = pricing.compute_roi_pct(open_pos.side, open_pos.entry_price, price, open_pos.leverage)
        pnl = pricing.compute_pnl(open_pos.size_amount, roi)
        if pnl < -open_pos.size_amount:  # 원금손실 클램프(엔진과 동일)
            pnl = -open_pos.size_amount
        total_asset = cash_balance + open_pos.size_amount + pnl
    roi_pct = (total_asset - initial_cash) / initial_cash * Decimal("100")
    return roi_pct.quantize(_PCT_Q, rounding=ROUND_HALF_UP)


async def update_rank(
    redis, season_id: int, user_id: int, roi: Decimal, *,
    season_window: tuple[datetime, datetime | None] | None = None,
    period: str | None = None,
    now: datetime | None = None,
) -> None:
    """시즌 ZSET 갱신 + (season_window 가 있으면) 주간 ZSET, (period == 'quarter' 면) 월간 ZSET 갱신.

    주간·월간 기준값은 그 구간 첫 갱신 때 시즌 ZSET 의 '갱신 전' 점수(없으면 0)를 HSETNX 로 기록한다.
    HSETNX 를 시즌 ZADD 보다 먼저 해야 동시 갱신이 바꾼 점수가 기준값이 되지 않는다.
    틱마다 불리는 경로라 pipeline 으로 왕복을 줄인다: 기준값이 이미 있으면(대부분) 왕복 2회,
    구간 첫 갱신이면 HSETNX 가 더해진다. EXPIRE 는 첫 갱신 때만.
    """
    key = ranking_key(season_id)
    member = str(user_id)
    targets: list[tuple[str, str, int]] = []  # (기준 HASH, 구간 ZSET, TTL)
    if season_window is not None:
        now = weekly_ranking.aware(now) if now is not None else datetime.now(timezone.utc)
        week_id, ws, we = weekly_ranking.week_bounds(now, *season_window)
        if ws <= now < we:
            targets.append((weekly_ranking.base_key(season_id, week_id),
                            weekly_ranking.week_key(season_id, week_id), weekly_ranking.WEEK_TTL_SEC))
        if period == "quarter":
            month_id, ms, me = monthly_ranking.month_bounds(now, *season_window)
            if ms <= now < me:
                targets.append((monthly_ranking.base_key(season_id, month_id),
                                monthly_ranking.month_key(season_id, month_id), monthly_ranking.MONTH_TTL_SEC))
    if not targets:
        await redis.zadd(key, {member: float(roi)})
        return
    # 왕복 1: 갱신 전 시즌 점수 + 구간별 기준값(대부분 이미 있음 → HSETNX 불필요)
    pipe = redis.pipeline(transaction=False)
    pipe.zscore(key, member)
    for bkey, _, _ in targets:
        pipe.hget(bkey, member)
    prev, *bases = await pipe.execute()
    prev_s = str(float(prev) if prev is not None else 0.0)
    scores: list[tuple[str, str, int, float, bool]] = []
    for (bkey, zkey, ttl), base_s in zip(targets, bases):
        is_new = False
        if base_s is None:
            # 구간 첫 갱신: HSETNX 는 아래 시즌 ZADD 보다 먼저 실행된다(순서 보장).
            is_new = bool(await redis.hsetnx(bkey, member, prev_s))
            base_s = prev_s if is_new else await redis.hget(bkey, member)  # 경합 시 승자 값
        scores.append((bkey, zkey, ttl, float(weekly_ranking.weekly_roi(roi, Decimal(base_s))), is_new))
    # 왕복 2: 구간 ZADD + 시즌 ZADD (+ 첫 갱신이면 EXPIRE — 키가 생긴 뒤여야 적용)
    pipe = redis.pipeline(transaction=False)
    for _, zkey, _, score, _ in scores:
        pipe.zadd(zkey, {member: score})
    pipe.zadd(key, {member: float(roi)})
    for bkey, zkey, ttl, _, is_new in scores:
        if is_new:
            pipe.expire(bkey, ttl)
            pipe.expire(zkey, ttl)
    await pipe.execute()


async def sync_account_rank(redis, db: AsyncSession, account_id) -> None:
    """계좌의 현재 current_roi 를 랭킹(시즌+주간+분기 시즌이면 월간)에 반영(청산 후 호출)."""
    acc = await db.get(GameAccount, account_id)
    if acc is None:
        return
    season = await db.get(GameSeason, acc.season_id)
    window = (season.start_at, season.end_at) if season is not None else None
    period = season.period if season is not None else None
    await update_rank(redis, acc.season_id, acc.user_id, acc.current_roi, season_window=window, period=period)


async def my_rank(redis, season_id: int, user_id: int) -> dict:
    key = ranking_key(season_id)
    rank = await redis.zrevrank(key, str(user_id))
    total = await redis.zcard(key)
    if rank is None:
        return {"rank": None, "roi_pct": None, "percentile": None, "total": total}
    score = await redis.zscore(key, str(user_id))
    return {
        "rank": rank + 1,
        "roi_pct": float(score) if score is not None else None,
        "percentile": round((rank + 1) / total * 100, 1) if total else None,
        "total": total,
    }


async def top_leaderboard(redis, db: AsyncSession, season_id: int, limit: int = 100) -> list[dict]:
    key = ranking_key(season_id)
    pairs = await redis.zrevrange(key, 0, limit - 1, withscores=True)
    if not pairs:
        return []
    user_ids = [int(uid) for uid, _ in pairs]
    rows = await db.execute(
        select(GameAccount, User.nickname)
        .join(User, GameAccount.user_id == User.id)
        .where(GameAccount.season_id == season_id, GameAccount.user_id.in_(user_ids))
    )
    by_uid = {acc.user_id: (acc, nick) for acc, nick in rows.all()}
    out = []
    for i, (uid, score) in enumerate(pairs):
        acc_nick = by_uid.get(int(uid))
        acc = acc_nick[0] if acc_nick else None
        nick = acc_nick[1] if acc_nick else None
        win_rate = 0.0
        total_asset = None
        if acc is not None:
            total_asset = float(acc.total_asset)
            if acc.total_trades:
                win_rate = round(acc.win_trades / acc.total_trades * 100, 1)
        out.append({
            "rank": i + 1, "user_id": int(uid), "nickname": nick,
            "roi_pct": float(score), "total_asset": total_asset, "win_rate": win_rate,
        })
    return out

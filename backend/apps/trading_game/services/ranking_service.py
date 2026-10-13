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
from apps.trading_game.services import pricing, weekly_ranking

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
    now: datetime | None = None,
) -> None:
    """시즌 ZSET 갱신 + (season_window 가 있으면) 주간 ZSET 갱신.

    주간 기준값은 그 주 첫 갱신 때 시즌 ZSET 의 '갱신 전' 점수(없으면 0)를 HSETNX 로 기록한다.
    HSETNX 를 시즌 ZADD 보다 먼저 해야 동시 갱신이 바꾼 점수가 기준값이 되지 않는다.
    틱마다 불리는 경로라, 이미 기준값이 있으면(HSETNX=0) HGET 1회로 끝내고 EXPIRE 는 생략한다.
    """
    key = ranking_key(season_id)
    member = str(user_id)
    if season_window is not None:
        now = weekly_ranking.aware(now) if now is not None else datetime.now(timezone.utc)
        week_id, ws, we = weekly_ranking.week_bounds(now, *season_window)
        if ws <= now < we:
            bkey = weekly_ranking.base_key(season_id, week_id)
            wkey = weekly_ranking.week_key(season_id, week_id)
            prev = await redis.zscore(key, member)
            prev_s = str(float(prev) if prev is not None else 0.0)
            is_new = bool(await redis.hsetnx(bkey, member, prev_s))
            base = Decimal(prev_s) if is_new else Decimal(await redis.hget(bkey, member))
            await redis.zadd(wkey, {member: float(weekly_ranking.weekly_roi(roi, base))})
            if is_new:  # EXPIRE 는 키가 존재한 뒤(ZADD 후)여야 적용된다
                await redis.expire(bkey, weekly_ranking.WEEK_TTL_SEC)
                await redis.expire(wkey, weekly_ranking.WEEK_TTL_SEC)
    await redis.zadd(key, {member: float(roi)})


async def sync_account_rank(redis, db: AsyncSession, account_id) -> None:
    """계좌의 현재 current_roi 를 랭킹(시즌+주간)에 반영(청산 후 호출)."""
    acc = await db.get(GameAccount, account_id)
    if acc is None:
        return
    season = await db.get(GameSeason, acc.season_id)
    window = (season.start_at, season.end_at) if season is not None else None
    await update_rank(redis, acc.season_id, acc.user_id, acc.current_roi, season_window=window)


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

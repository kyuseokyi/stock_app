"""시즌 정산 파이프라인(멱등). 말일 판별 → 전액청산→박제→차기시즌."""
from __future__ import annotations

import calendar
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.game_models import (
    GameAccount, GamePosition, GameSeason, GameTrade, HallOfFame, INITIAL_CASH,
)
from apps.trading_game.services import account_service, mbti_analyzer, order_engine

log = logging.getLogger("trading_game.settlement")
KST = timezone(timedelta(hours=9))


def next_month_bounds(ref: datetime) -> tuple[datetime, datetime]:
    """ref 기준 '다음 달' 시작(1일 09:00 KST)·종료(말일 20:00 KST)."""
    y, m = ref.year, ref.month
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    start = datetime(ny, nm, 1, 9, 0, tzinfo=KST)
    last_day = calendar.monthrange(ny, nm)[1]
    end = datetime(ny, nm, last_day, 20, 0, tzinfo=KST)
    return start, end


async def settle_due_season(db: AsyncSession, redis, close_price_provider) -> dict | None:
    season = await account_service.get_active_season(db)
    if season is None or season.end_at is None:
        return None
    now = datetime.now(timezone.utc)
    end_at = season.end_at if season.end_at.tzinfo else season.end_at.replace(tzinfo=timezone.utc)
    if now < end_at or season.status != "ACTIVE":
        return None

    price = close_price_provider(season.ticker)
    if price is None:
        log.warning("정산 중단 — 종가 미확보(ticker=%s)", season.ticker)
        return None
    price = Decimal(str(price))

    # 1) 전액 강제청산
    open_rows = await db.execute(
        select(GamePosition)
        .join(GameAccount, GamePosition.account_id == GameAccount.id)
        .where(GamePosition.status == "OPEN", GameAccount.season_id == season.id)
    )
    closed = 0
    for pos in open_rows.scalars().all():
        trade = await order_engine.close_position(
            db, position_id=pos.id, exit_price=price, reason="SEASON_END"
        )
        if trade is not None:
            closed += 1

    # 2~3) 최종순위 → 명예의 전당(상위 100)
    acc_rows = await db.execute(
        select(GameAccount, User.nickname)
        .join(User, GameAccount.user_id == User.id)
        .where(GameAccount.season_id == season.id)
        .order_by(GameAccount.current_roi.desc())
        .limit(100)
    )
    archived = 0
    for rank, (acc, nick) in enumerate(acc_rows.all(), start=1):
        exists = await db.execute(
            select(HallOfFame).where(
                HallOfFame.season_id == season.id, HallOfFame.user_id == acc.user_id
            )
        )
        if exists.scalar_one_or_none() is not None:
            continue
        trades = (await db.execute(
            select(GameTrade).where(GameTrade.account_id == acc.id)
        )).scalars().all()
        win_rate = round(acc.win_trades / acc.total_trades * 100, 2) if acc.total_trades else 0
        db.add(HallOfFame(
            season_id=season.id, rank=rank, user_id=acc.user_id, user_nickname=nick,
            final_roi=acc.current_roi, final_asset=acc.total_asset,
            win_rate=Decimal(str(win_rate)), trading_mbti=mbti_analyzer.classify_mbti(trades),
        ))
        archived += 1
    await db.commit()

    # 4) 시즌 FINISHED
    season.status = "FINISHED"
    await db.commit()

    # 5) 차기 시즌 생성(멱등: season_number 중복이면 skip)
    next_num = season.season_number + 1
    dup = await db.execute(select(GameSeason).where(GameSeason.season_number == next_num))
    next_season_num = None
    if dup.scalar_one_or_none() is None:
        start, end = next_month_bounds(end_at.astimezone(KST))
        db.add(GameSeason(
            season_number=next_num, ticker=season.ticker, stock_name=season.stock_name,
            start_at=start, end_at=end, status="ACTIVE", initial_cash=INITIAL_CASH,
        ))
        await db.commit()
        next_season_num = next_num

    return {"settled_season": season.season_number, "closed": closed,
            "archived": archived, "next_season": next_season_num}

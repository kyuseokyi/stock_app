"""시즌 정산 파이프라인(멱등). 말일 판별 → 전액청산→박제→차기시즌."""
from __future__ import annotations

import calendar
import logging
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.game_models import (
    GameAccount, GamePosition, GameSeason, GameTrade, HallOfFame, INITIAL_CASH,
)
from apps.trading_game.services import account_service, mbti_analyzer, order_engine

log = logging.getLogger("trading_game.settlement")
KST = timezone(timedelta(hours=9))


def _bounds(y: int, m: int) -> tuple[datetime, datetime]:
    start = datetime(y, m, 1, 9, 0, tzinfo=KST)
    last_day = calendar.monthrange(y, m)[1]
    return start, datetime(y, m, last_day, 20, 0, tzinfo=KST)


def month_bounds(ref: datetime) -> tuple[datetime, datetime]:
    """ref(KST 기준) 가 속한 달의 시즌 창: 1일 09:00 ~ 말일 20:00 KST."""
    k = ref.astimezone(KST) if ref.tzinfo else ref.replace(tzinfo=KST)
    return _bounds(k.year, k.month)


def next_month_bounds(ref: datetime) -> tuple[datetime, datetime]:
    """ref 기준 '다음 달' 시작(1일 09:00 KST)·종료(말일 20:00 KST)."""
    y, m = ref.year, ref.month
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return _bounds(ny, nm)


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

    # 2~3) 최종순위 → 명예의 전당(상위 100). current_roi 동률 시 id 오름차순으로 결정적 순위.
    # 무거래 계좌(퀴즈·퀘스트 보상만, ROI 0%)는 제외 — 손실 낸 실제 플레이어보다 앞서지 않도록.
    acc_rows = await db.execute(
        select(GameAccount, User.nickname)
        .join(User, GameAccount.user_id == User.id)
        .where(GameAccount.season_id == season.id, GameAccount.total_trades > 0)
        .order_by(GameAccount.current_roi.desc(), GameAccount.id.asc())
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
        if acc.total_trades:
            win_rate = (Decimal(acc.win_trades) / acc.total_trades * Decimal("100")).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
        else:
            win_rate = Decimal("0.00")
        db.add(HallOfFame(
            season_id=season.id, rank=rank, user_id=acc.user_id, user_nickname=(nick or f"user{acc.user_id}"),
            final_roi=acc.current_roi, final_asset=acc.total_asset,
            win_rate=win_rate, trading_mbti=mbti_analyzer.classify_mbti(trades),
        ))
        archived += 1
    await db.commit()

    # 4~5) 시즌 FINISHED + 차기 시즌 생성을 한 트랜잭션으로(원자적).
    # 둘을 분리하면 사이 크래시 시 ACTIVE 시즌이 사라져 게임이 영구 정지된다.
    next_num = season.season_number + 1
    dup = await db.execute(select(GameSeason).where(GameSeason.season_number == next_num))
    next_season_num = None
    if dup.scalar_one_or_none() is None:
        # 차기 시즌 창은 이번 시즌 end_at(말일) 기준 '다음 달'. 워커가 한 달 이상
        # 멈췄다면 이미 만료된 시즌이 생성될 수 있고, 다음 실행에서 연쇄 정산된다(의도된 동작).
        start, end = next_month_bounds(end_at.astimezone(KST))
        db.add(GameSeason(
            season_number=next_num, ticker=season.ticker, stock_name=season.stock_name,
            start_at=start, end_at=end, status="ACTIVE", initial_cash=INITIAL_CASH,
        ))
        next_season_num = next_num
    season.status = "FINISHED"
    await db.commit()

    # 아래 주간 기록이 실패·롤백되면 season 이 만료되므로 필요한 값은 미리 잡아 둔다.
    season_id, season_number = season.id, season.season_number
    if redis is not None:
        from apps.trading_game.services import weekly_service
        from apps.trading_game.services.ranking_service import ranking_key
        final_week = None
        try:
            final_week = weekly_service.final_week_id(season)
            await weekly_service.close_final_week(db, redis, season)  # 시즌 마지막 주 기록(보상 없음)
        except Exception:  # noqa: BLE001 — 주간 기록 실패가 시즌 정산을 막지 않게
            # 수동 복구: weekly_service.close_week(db, redis, season, week_start, with_reward=False)
            # (주간 ZSET 은 TTL 21일 동안 남아 있다)
            log.exception(
                "시즌 마지막 주 주간 기록 실패 season=%s week_start=%s", season_id,
                final_week.isoformat() if final_week else None,
            )
            await db.rollback()
        await redis.delete(ranking_key(season_id))

    log.info(
        "시즌 %s 정산 완료 — closed=%s archived=%s next=%s",
        season_number, closed, archived, next_season_num,
    )
    return {"settled_season": season_number, "closed": closed,
            "archived": archived, "next_season": next_season_num}

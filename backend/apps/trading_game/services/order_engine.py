"""가상 주문 진입/청산. 진입가는 호출부가 주입(Redis 비의존)."""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, GamePosition, GameTrade
from apps.trading_game.services import pricing

MIN_ORDER_AMOUNT = Decimal("100000")  # 최소 주문 10만 원


class OrderError(Exception):
    """주문 거부(최소금액 미만, 잔고 부족 등). 라우터가 422 로 변환."""


async def open_position(
    db: AsyncSession,
    *,
    account: GameAccount,
    side: str,
    ratio: Decimal,
    leverage: int,
    entry_price: Decimal,
    sl_pct: Decimal | None,
    tp_pct: Decimal | None,
) -> GamePosition:
    size_amount = (account.cash_balance * ratio).quantize(Decimal("0.01"))
    if size_amount < MIN_ORDER_AMOUNT:
        raise OrderError(f"최소 주문 금액({MIN_ORDER_AMOUNT}) 미만입니다.")
    if size_amount > account.cash_balance:
        raise OrderError("잔고가 부족합니다.")

    sl_price, tp_price = pricing.tp_sl_prices(side, entry_price, sl_pct, tp_pct)
    pos = GamePosition(
        account_id=account.id,
        side=side,
        entry_price=entry_price,
        size_amount=size_amount,
        entry_ratio=ratio,
        leverage=leverage,
        stop_loss_price=sl_price,
        take_profit_price=tp_price,
        status="OPEN",
    )
    db.add(pos)
    await db.execute(
        update(GameAccount)
        .where(GameAccount.id == account.id)
        .values(cash_balance=GameAccount.cash_balance - size_amount)
    )
    await db.commit()
    await db.refresh(pos)
    return pos


async def close_position(
    db: AsyncSession, *, position_id: uuid.UUID, exit_price: Decimal, reason: str
) -> GameTrade | None:
    """조건부 청산. OPEN 인 경우에만 1건 처리(레이스/중복 방지). 아니면 None."""
    pos = await db.get(GamePosition, position_id)
    if pos is None or pos.status != "OPEN":
        return None

    res = await db.execute(
        update(GamePosition)
        .where(GamePosition.id == position_id, GamePosition.status == "OPEN")
        .values(status="CLOSED")
    )
    if res.rowcount != 1:
        await db.rollback()
        return None

    roi = pricing.compute_roi_pct(pos.side, pos.entry_price, exit_price, pos.leverage)
    pnl = pricing.compute_pnl(pos.size_amount, roi)
    return_amount = max(Decimal("0"), pos.size_amount + pnl)

    trade = GameTrade(
        account_id=pos.account_id,
        position_id=pos.id,
        side=pos.side,
        entry_price=pos.entry_price,
        exit_price=exit_price,
        pnl_amount=pnl,
        roi_pct=roi,
        closed_reason=reason,
        size_amount=pos.size_amount,
        leverage=pos.leverage,
        entry_ratio=pos.entry_ratio,
        opened_at=pos.created_at,
        had_stop_loss=pos.stop_loss_price is not None,
    )
    db.add(trade)
    win_inc = 1 if pnl > 0 else 0
    await db.execute(
        update(GameAccount)
        .where(GameAccount.id == pos.account_id)
        .values(
            cash_balance=GameAccount.cash_balance + return_amount,
            total_trades=GameAccount.total_trades + 1,
            win_trades=GameAccount.win_trades + win_inc,
        )
    )
    await db.commit()
    await db.refresh(trade)
    return trade

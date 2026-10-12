"""실시간 틱 수신 시 TP/SL/마진콜 자동청산 검사기."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, GamePosition, GameSeason, GameTrade
from apps.trading_game.services import order_engine, pricing


async def _open_positions_for_ticker(db: AsyncSession, ticker: str) -> list[GamePosition]:
    rows = await db.execute(
        select(GamePosition)
        .join(GameAccount, GamePosition.account_id == GameAccount.id)
        .join(GameSeason, GameAccount.season_id == GameSeason.id)
        .where(GamePosition.status == "OPEN", GameSeason.ticker == ticker)
    )
    return list(rows.scalars().all())


async def check_and_liquidate(db: AsyncSession, ticker: str, price: Decimal) -> list[GameTrade]:
    """해당 ticker OPEN 포지션 중 청산조건 충족분을 청산하고 체결내역 목록 반환."""
    trades: list[GameTrade] = []
    for pos in await _open_positions_for_ticker(db, ticker):
        reason = pricing.liquidation_reason(
            pos.side, pos.entry_price, price, pos.leverage,
            pos.stop_loss_price, pos.take_profit_price,
        )
        if reason is None:
            continue
        trade = await order_engine.close_position(
            db, position_id=pos.id, exit_price=price, reason=reason
        )
        if trade is not None:
            trades.append(trade)
    return trades

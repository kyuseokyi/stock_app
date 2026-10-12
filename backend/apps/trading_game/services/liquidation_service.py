"""실시간 틱 수신 시 TP/SL/마진콜 자동청산 검사기."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, GamePosition, GameSeason, GameTrade
from apps.trading_game.services import order_engine, pricing


@dataclass(frozen=True)
class LiquidationResult:
    """청산 체결 + 소유자 user_id (청산 전에 함께 조회 — 청산 후 관계 lazy-load 금지)."""
    trade: GameTrade
    user_id: int


async def _open_positions_with_user(db: AsyncSession, ticker: str) -> list[tuple[GamePosition, int]]:
    rows = await db.execute(
        select(GamePosition, GameAccount.user_id)
        .join(GameAccount, GamePosition.account_id == GameAccount.id)
        .join(GameSeason, GameAccount.season_id == GameSeason.id)
        .where(
            GamePosition.status == "OPEN",
            GameSeason.ticker == ticker,
            GameSeason.status == "ACTIVE",
        )
    )
    return [(pos, user_id) for pos, user_id in rows.all()]


async def liquidate_for_tick(db: AsyncSession, ticker: str, price: Decimal) -> list[LiquidationResult]:
    """해당 ticker OPEN 포지션 중 청산조건 충족분을 청산하고 (체결, user_id) 목록 반환."""
    results: list[LiquidationResult] = []
    for pos, user_id in await _open_positions_with_user(db, ticker):
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
            results.append(LiquidationResult(trade=trade, user_id=user_id))
    return results


async def check_and_liquidate(db: AsyncSession, ticker: str, price: Decimal) -> list[GameTrade]:
    """하위 호환 — 체결내역 목록만 반환."""
    return [r.trade for r in await liquidate_for_tick(db, ticker, price)]

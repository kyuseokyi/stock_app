"""실시간 틱 수신 시 TP/SL/마진콜 자동청산 검사기.

틱 경로(tick_listener)는 포지션 캐시로 후보만 고르고(find_candidates — DB 조회 없음)
후보가 있을 때만 DB 로 확정한다(liquidate_candidates → close_position 이 OPEN 확인).
liquidate_for_tick/check_and_liquidate 는 DB 조회식 헬퍼로 유지(하위 호환·회귀 기준).
"""
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


def find_candidates(positions, price: Decimal) -> list[tuple[object, str]]:
    """캐시 포지션(CachedPosition 등 side/entry_price/leverage/SL/TP 속성) 중 청산조건 충족분과 사유."""
    out = []
    for pos in positions:
        reason = pricing.liquidation_reason(
            pos.side, pos.entry_price, price, pos.leverage,
            pos.stop_loss_price, pos.take_profit_price,
        )
        if reason is not None:
            out.append((pos, reason))
    return out


async def liquidate_candidates(
    db: AsyncSession, candidates: list[tuple[object, str]], price: Decimal
) -> list[LiquidationResult]:
    """후보를 DB 로 확정 청산. 이미 닫힌(캐시가 오래된) 포지션은 close_position 이 None — 건너뜀."""
    results: list[LiquidationResult] = []
    for pos, reason in candidates:
        trade = await order_engine.close_position(
            db, position_id=pos.position_id, exit_price=price, reason=reason
        )
        if trade is not None:
            results.append(LiquidationResult(trade=trade, user_id=pos.user_id))
    return results


async def check_and_liquidate(db: AsyncSession, ticker: str, price: Decimal) -> list[GameTrade]:
    """하위 호환 — 체결내역 목록만 반환."""
    return [r.trade for r in await liquidate_for_tick(db, ticker, price)]

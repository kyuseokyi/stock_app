"""보상 지급 — 원금 동반 가산(펀드 입금 방식) (Phase 5b).

실현 자산 A = P(1+r) 일 때 원금을 P' = P + b/(1+r) 로 늘리면 (A+b)/P' = 1+r → ROI 불변.
같은 금액 b 를 원금에 그대로 더하면 (A-P)/(P+b) 로 ROI 가 0 쪽으로 희석되어
마이너스 계좌가 보상만으로 순위가 오르는 문제가 생긴다.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import INITIAL_CASH, GameAccount

_CENT = Decimal("0.01")
_MIN_GROWTH = Decimal("0.01")  # ROI -100%(자산 0) 방어


def principal(acc: GameAccount) -> Decimal:
    """ROI 분모 = 초기자본 + 보상 원금 조정분."""
    return INITIAL_CASH + (acc.bonus_cash or Decimal("0"))


def principal_increment(amount: Decimal, current_roi_pct: Decimal) -> Decimal:
    growth = max(Decimal("1") + current_roi_pct / Decimal("100"), _MIN_GROWTH)
    return (amount / growth).quantize(_CENT, rounding=ROUND_HALF_UP)


async def grant_cash(db: AsyncSession, account: GameAccount, amount: Decimal) -> None:
    """현금·총자산 +amount, 원금 조정분 +amount/(1+r). commit 은 호출부 책임(수령 기록과 한 트랜잭션)."""
    # 호출부가 들고 있는 ORM 객체는 다른 세션의 청산 등으로 오래된 값일 수 있어 DB 최신 ROI 를 직접 읽는다.
    roi = await db.scalar(select(GameAccount.current_roi).where(GameAccount.id == account.id))
    if roi is None:
        roi = account.current_roi
    inc = principal_increment(amount, roi)
    await db.execute(
        update(GameAccount)
        .where(GameAccount.id == account.id)
        .values(
            cash_balance=GameAccount.cash_balance + amount,
            total_asset=GameAccount.total_asset + amount,
            bonus_cash=GameAccount.bonus_cash + inc,
        )
    )

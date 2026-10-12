"""보상 지급 — 원금 동반 가산(펀드 입금 방식) (Phase 5b).

현재 자산 A = P(1+r) 일 때(r: 보유 포지션이 있으면 최신가 평가 ROI) 원금을 P' = P + b/(1+r) 로 늘리면 (A+b)/P' = 1+r → ROI 불변.
같은 금액 b 를 원금에 그대로 더하면 (A-P)/(P+b) 로 ROI 가 0 쪽으로 희석되어
마이너스 계좌가 보상만으로 순위가 오르는 문제가 생긴다.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import INITIAL_CASH, GameAccount, GamePosition, GameSeason
from apps.trading_game.services import market_clock, ranking_service

_CENT = Decimal("0.01")
_MIN_GROWTH = Decimal("0.01")  # ROI -100%(자산 0) 방어


def principal(acc: GameAccount) -> Decimal:
    """ROI 분모 = 초기자본 + 보상 원금 조정분."""
    return INITIAL_CASH + (acc.bonus_cash or Decimal("0"))


def principal_increment(amount: Decimal, current_roi_pct: Decimal) -> Decimal:
    growth = max(Decimal("1") + current_roi_pct / Decimal("100"), _MIN_GROWTH)
    return (amount / growth).quantize(_CENT, rounding=ROUND_HALF_UP)


class RewardUnavailable(Exception):
    """보유 포지션 평가에 필요한 시세가 없어 지금은 ROI 불변 보상을 계산할 수 없음."""


async def _current_roi(db: AsyncSession, acc: GameAccount, redis) -> Decimal:
    """현재 NAV 기준 ROI(%) — 보유 포지션이 있으면 최신가로 평가(랭킹과 동일), 없으면 실현 ROI."""
    pos = (
        await db.execute(
            select(GamePosition)
            .where(GamePosition.account_id == acc.id, GamePosition.status == "OPEN")
            .limit(1)
        )
    ).scalar_one_or_none()
    if pos is None:
        return acc.current_roi
    season = await db.get(GameSeason, acc.season_id)
    latest = await market_clock.read_latest(redis, season.ticker) if season is not None else None
    # 신선도는 보지 않는다 — 랭킹과 같은 '마지막으로 알려진 평가가'
    try:
        price = Decimal(str(latest["price"])) if latest else None
    except (KeyError, TypeError, ArithmeticError):
        price = None
    if price is None or not price.is_finite() or price <= 0:
        raise RewardUnavailable("보유 포지션 평가 시세 없음")
    return ranking_service.compute_live_roi(acc.cash_balance, pos, price, principal(acc))


async def grant_cash(db: AsyncSession, account: GameAccount, amount: Decimal, *, redis) -> None:
    """현금·총자산 +amount, 원금 조정분 +amount/(1+r). commit 은 호출부 책임(수령 기록과 한 트랜잭션).

    '현재 NAV 로 펀드에 입금'하는 방식: r 은 지급 시점의 ROI 이며, 포지션을 보유 중이면 저장된
    실현 ROI 가 아니라 최신가로 평가한 실시간 ROI(랭킹과 같은 마크)를 쓴다.
    실현 ROI 를 쓰면 악용된다 — 예: 실현 0%·실시간 -80% 인 계좌가 2,100,000 을 받으면 원금이
    같은 금액만 늘어 실시간 ROI 가 약 -66% 로 '개선'되고, 그 상태로 청산하면 순위가 영구히 오른다.
    실시간 ROI 로 원금을 늘리면 지급 직후 실시간 ROI 가 그대로 유지되며, 이후의 손익은 늘어난 원금
    기준으로 측정된다(입금 후 수익률은 펀드 지분처럼 희석·증폭되지 않음).
    시세가 없으면 RewardUnavailable — 호출부가 재시도 안내(퀘스트) 또는 보상 생략(퀴즈).
    계좌 행을 FOR UPDATE 로 잠그고 재적재해 동시 청산·보상과 직렬화한다(SQLite 는 무시).
    """
    # 호출부 ORM 객체는 다른 세션의 청산 등으로 오래된 값일 수 있어 잠근 뒤 DB 최신값으로 덮어쓴다.
    acc = (
        await db.execute(
            select(GameAccount)
            .where(GameAccount.id == account.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    roi = await _current_roi(db, acc, redis)
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

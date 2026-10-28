"""가상 주문 진입/청산. 진입가는 호출부가 주입(Redis 비의존)."""
from __future__ import annotations

import uuid
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, GamePosition, GameTrade
from apps.trading_game.services import pricing, ranking_service, reward_service

MIN_ORDER_AMOUNT = Decimal("100000")  # 최소 주문 10만 원
# 계좌당 동시 보유 포지션 수 — 실제 강제는 DB 부분 유니크 인덱스(위반 시 ALREADY_OPEN). 규칙 API 노출용.
MAX_OPEN_POSITIONS = 1


class OrderError(Exception):
    """주문 거부. code 로 라우터가 상태코드를 매핑한다.

    MIN_AMOUNT / INSUFFICIENT_CASH → 422, ALREADY_OPEN → 409.
    부분 청산: NOT_IN_PROFIT / NOTHING_LEFT → 409.
    """

    def __init__(self, message: str, code: str = "INVALID"):
        super().__init__(message)
        self.code = code


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
        raise OrderError(f"최소 주문 금액({MIN_ORDER_AMOUNT}) 미만입니다.", code="MIN_AMOUNT")
    if size_amount > account.cash_balance:
        raise OrderError("잔고가 부족합니다.", code="INSUFFICIENT_CASH")

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
    try:
        # autoflush 가 INSERT 를 내보내므로 유니크 위반은 execute 에서도 발생 가능
        await db.execute(
            update(GameAccount)
            .where(GameAccount.id == account.id)
            .values(cash_balance=GameAccount.cash_balance - size_amount)
        )
        await db.commit()
    except IntegrityError:
        # 1계좌 1활성포지션 부분 유니크 인덱스 위반(동시 더블클릭 등)
        await db.rollback()
        raise OrderError("이미 보유 중인 포지션이 있습니다.", code="ALREADY_OPEN")
    await db.refresh(pos)
    await db.refresh(account)
    return pos


async def close_position(
    db: AsyncSession, *, position_id: uuid.UUID, exit_price: Decimal, reason: str
) -> GameTrade | None:
    """조건부 청산. OPEN 인 경우에만 1건 처리(레이스/중복 방지). 아니면 None.

    부분 청산과의 경쟁: 읽은 size_amount 가 그대로일 때만 청산(옛 크기로 지급 방지).
    """
    # DB 최신값으로 읽는다(identity map 의 오래된 size 로 조건부 UPDATE 가 헛도는 것 방지)
    pos = await db.get(GamePosition, position_id, populate_existing=True)
    if pos is None or pos.status != "OPEN":
        return None

    # 손익을 상태 변경 '전'에 계산(계산 중 예외가 나도 미변경 상태 유지)
    roi = pricing.compute_roi_pct(pos.side, pos.entry_price, exit_price, pos.leverage)
    pnl = pricing.compute_pnl(pos.size_amount, roi)
    # 원금 초과 손실 방지: 실현 손익은 -원금 이하로 내려가지 않음(원장·현금 일치)
    if pnl < -pos.size_amount:
        pnl = -pos.size_amount
        roi = (pnl / pos.size_amount * Decimal("100")).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP
        )
    return_amount = pos.size_amount + pnl  # 위 클램프로 항상 >= 0
    read_size = pos.size_amount
    # 승패 = 이 포지션의 부분 청산 실현손익 합계 + 이번 손익 > 0 (trade 추가 '전'에 조회 — autoflush 이중계산 방지)
    prior_pnl = await _realized_pnl_of(db, pos.id)

    res = await db.execute(
        update(GamePosition)
        .where(
            GamePosition.id == position_id,
            GamePosition.status == "OPEN",
            GamePosition.size_amount == read_size,
        )
        .values(status="CLOSED")
    )
    if res.rowcount != 1:
        # 레이스(이미 CLOSED 또는 부분 청산으로 크기 변경)로 0행 변경 — 변경된 것이 없으므로 rollback 하지 않는다.
        # (rollback 은 세션의 모든 ORM 객체를 expire 시켜 호출부 루프에서 MissingGreenlet 유발.)
        return None

    trade = GameTrade(
        account_id=pos.account_id,
        position_id=pos.id,
        side=pos.side,
        entry_price=pos.entry_price,
        exit_price=exit_price,
        pnl_amount=pnl,
        roi_pct=roi,
        closed_reason=reason,
        size_amount=read_size,
        leverage=pos.leverage,
        entry_ratio=pos.entry_ratio,
        opened_at=pos.created_at,
        had_stop_loss=pos.stop_loss_price is not None,
    )
    db.add(trade)
    win_inc = 1 if prior_pnl + pnl > 0 else 0
    await db.execute(
        update(GameAccount)
        .where(GameAccount.id == pos.account_id)
        .values(
            cash_balance=GameAccount.cash_balance + return_amount,
            total_trades=GameAccount.total_trades + 1,
            win_trades=GameAccount.win_trades + win_inc,
        )
    )
    # 집계 갱신(파이썬 Decimal — sqlite 정수나눗셈 함정 회피).
    # 단일 포지션 규칙상 청산 후 보유 포지션 0 → 총자산 = 현금.
    # identity map 의 오래된 값으로 total_asset 을 덮어쓰지 않도록 DB 최신값 재적재
    acc = await db.get(GameAccount, pos.account_id, populate_existing=True)
    acc.total_asset = acc.cash_balance
    base = reward_service.principal(acc)  # Phase 5b: 보상 원금 조정분 포함
    roi_acc = ((acc.cash_balance - base) / base * Decimal("100")).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )
    acc.current_roi = roi_acc
    if roi_acc > acc.max_roi:
        acc.max_roi = roi_acc
    await db.commit()
    await db.refresh(trade)
    return trade


async def _realized_pnl_of(db: AsyncSession, position_id: uuid.UUID) -> Decimal:
    """이 포지션에서 이미 실현된(부분 청산) 손익 합계. 없으면 0."""
    total = (await db.execute(
        select(func.coalesce(func.sum(GameTrade.pnl_amount), 0)).where(GameTrade.position_id == position_id)
    )).scalar_one()
    return Decimal(str(total))  # sqlite 는 float 로 돌려줄 수 있음


PARTIAL_PORTIONS = ("half", "principal")


async def partial_close_position(
    db: AsyncSession, *, position_id: uuid.UUID, exit_price: Decimal, portion: str
) -> tuple[GameTrade, GamePosition] | None:
    """부분 청산 — 수익 상태에서만. half=원금 절반, principal=돌려받는 돈이 지금 원금과 같도록.

    포지션은 OPEN 으로 남고 size_amount 만 줄어든다(진입가·레버리지·손절·익절 그대로).
    거래 수·승수는 바꾸지 않는다(최종 전량 청산 때 1회). 경쟁(동시 부분/자동 청산)이면 None.
    """
    if portion not in PARTIAL_PORTIONS:
        raise ValueError(f"portion must be one of {PARTIAL_PORTIONS}, got {portion!r}")
    pos = await db.get(GamePosition, position_id, populate_existing=True)
    if pos is None or pos.status != "OPEN":
        return None

    roi = pricing.compute_roi_pct(pos.side, pos.entry_price, exit_price, pos.leverage)
    if roi <= 0:
        raise OrderError("수익 중일 때만 부분 익절할 수 있어요.", code="NOT_IN_PROFIT")
    size = pos.size_amount
    if portion == "half":
        fraction = Decimal("0.5")
        reason = pricing.PARTIAL_TP
    else:
        # 돌려받는 돈 = close × (1 + r) = size → close = size / (1 + r)
        fraction = Decimal("1") / (Decimal("1") + roi / Decimal("100"))
        reason = pricing.PRINCIPAL_OUT
    close_size = (size * fraction).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    remain = size - close_size  # 따로 반올림하지 않음(합이 정확히 size)
    if close_size <= 0 or remain <= 0:
        raise OrderError("남길 수 있는 금액이 너무 적어요. 전량 청산을 이용해 주세요.", code="NOTHING_LEFT")
    pnl = pricing.compute_pnl(close_size, roi)
    return_amount = close_size + pnl

    res = await db.execute(
        update(GamePosition)
        .where(
            GamePosition.id == position_id,
            GamePosition.status == "OPEN",
            GamePosition.size_amount == size,
        )
        .values(size_amount=remain)
        .execution_options(synchronize_session=False)
    )
    if res.rowcount != 1:
        return None  # 이미 청산됐거나 크기가 바뀜 — 변경 없음

    trade = GameTrade(
        account_id=pos.account_id,
        position_id=pos.id,
        side=pos.side,
        entry_price=pos.entry_price,
        exit_price=exit_price,
        pnl_amount=pnl,
        roi_pct=roi,
        closed_reason=reason,
        size_amount=close_size,
        leverage=pos.leverage,
        entry_ratio=pos.entry_ratio,
        opened_at=pos.created_at,
        had_stop_loss=pos.stop_loss_price is not None,
    )
    db.add(trade)
    await db.execute(
        update(GameAccount)
        .where(GameAccount.id == pos.account_id)
        .values(cash_balance=GameAccount.cash_balance + return_amount)
    )
    # 총자산 = 현금 + 남은 포지션 평가금. ROI 는 라이브 랭킹과 같은 식(부분 청산 직후 순위 유지).
    acc = await db.get(GameAccount, pos.account_id, populate_existing=True)
    pos = await db.get(GamePosition, position_id, populate_existing=True)
    remain_pnl = pricing.compute_pnl(pos.size_amount, roi)
    acc.total_asset = acc.cash_balance + pos.size_amount + remain_pnl
    roi_acc = ranking_service.compute_live_roi(
        acc.cash_balance, pos, exit_price, reward_service.principal(acc)
    )
    acc.current_roi = roi_acc
    if roi_acc > acc.max_roi:
        acc.max_roi = roi_acc
    await db.commit()
    await db.refresh(trade)
    await db.refresh(pos)
    return trade, pos

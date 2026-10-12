"""트레이딩 게임 REST — 주문 진입/수동청산/조회."""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from shared.game_models import GameAccount, GamePosition
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import AccountResponse, OrderRequest, PositionResponse
from apps.trading_game.services import account_service, market_clock, order_engine, pricing

router = APIRouter(prefix="/api/game", tags=["trading-game"])


def _position_dto(pos: GamePosition, cur_price: Decimal | None = None) -> PositionResponse:
    roi = pnl = None
    if cur_price is not None:
        roi = pricing.compute_roi_pct(pos.side, pos.entry_price, cur_price, pos.leverage)
        pnl = pricing.compute_pnl(pos.size_amount, roi)
    return PositionResponse(
        id=str(pos.id), side=pos.side, entry_price=pos.entry_price,
        size_amount=pos.size_amount, leverage=pos.leverage,
        stop_loss_price=pos.stop_loss_price, take_profit_price=pos.take_profit_price,
        status=pos.status, roi_pct=roi, pnl_amount=pnl,
    )


@router.post("/orders", response_model=PositionResponse, status_code=status.HTTP_201_CREATED)
async def open_order(
    body: OrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    season = await account_service.get_active_season(db)
    if season is None or season.id != body.season_id or not account_service.season_is_tradable(season):
        raise HTTPException(status.HTTP_409_CONFLICT, "거래 가능한 ACTIVE 시즌이 아닙니다.")

    # 이중 게이트: 거래 세션 창 + 최신가 신선도
    redis = deps.get_redis()
    windows = market_clock.load_windows()
    if not market_clock.in_trading_window(market_clock.now_kst(), windows):
        raise HTTPException(status.HTTP_409_CONFLICT, "지금은 거래 시간이 아닙니다.")
    latest = await market_clock.read_latest(redis, season.ticker)
    if latest is None or not market_clock.is_price_fresh(
        float(latest["ts"]), market_clock.now_epoch(), deps.STALE_SECONDS
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "시세 수신이 중단되었습니다.")

    entry_price = Decimal(str(latest["price"]))
    account = await account_service.get_or_create_account(db, user.id, season.id)
    try:
        pos = await order_engine.open_position(
            db, account=account, side=body.side, ratio=Decimal(str(body.ratio)),
            leverage=body.leverage, entry_price=entry_price,
            sl_pct=Decimal(str(body.stop_loss_pct)) if body.stop_loss_pct else None,
            tp_pct=Decimal(str(body.take_profit_pct)) if body.take_profit_pct else None,
        )
    except order_engine.OrderError as e:
        code = status.HTTP_409_CONFLICT if e.code == "ALREADY_OPEN" else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(code, str(e))
    return _position_dto(pos, entry_price)


@router.post("/positions/{position_id}/close", response_model=PositionResponse)
async def close_order(
    position_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pos = await db.get(GamePosition, uuid.UUID(position_id))
    if pos is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "포지션을 찾을 수 없습니다.")
    account = await db.get(GameAccount, pos.account_id)
    if account is None or account.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "본인 포지션이 아닙니다.")
    season = await account_service.get_active_season(db)
    redis = deps.get_redis()
    latest = await market_clock.read_latest(redis, season.ticker) if season else None
    if latest is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "시세 수신이 중단되었습니다.")
    exit_price = Decimal(str(latest["price"]))
    trade = await order_engine.close_position(
        db, position_id=pos.id, exit_price=exit_price, reason="MANUAL"
    )
    if trade is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 청산된 포지션입니다.")
    refreshed = await db.get(GamePosition, pos.id)
    return _position_dto(refreshed, exit_price)


@router.get("/positions/active", response_model=list[PositionResponse])
async def active_positions(
    season_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        select(GamePosition)
        .join(GameAccount, GamePosition.account_id == GameAccount.id)
        .where(
            GameAccount.user_id == user.id,
            GameAccount.season_id == season_id,
            GamePosition.status == "OPEN",
        )
    )
    positions = list(rows.scalars().all())
    season = await account_service.get_active_season(db)
    cur = None
    if season is not None:
        latest = await market_clock.read_latest(deps.get_redis(), season.ticker)
        if latest is not None:
            cur = Decimal(str(latest["price"]))
    return [_position_dto(p, cur) for p in positions]


@router.get("/accounts/me", response_model=AccountResponse)
async def my_account(
    season_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    acc = await account_service.get_or_create_account(db, user.id, season_id)
    return AccountResponse(
        season_id=season_id, cash_balance=acc.cash_balance, total_asset=acc.total_asset,
        current_roi=acc.current_roi, total_trades=acc.total_trades, win_trades=acc.win_trades,
    )

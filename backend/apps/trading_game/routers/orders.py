"""트레이딩 게임 REST — 주문 진입/수동청산/조회."""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from shared.game_models import INITIAL_CASH, GameAccount, GamePosition, GameSeason
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import AccountResponse, OrderRequest, PositionResponse
from apps.trading_game.services import account_service, market_clock, order_engine, pricing

router = APIRouter(prefix="/api/game", tags=["trading-game"])


def _position_dto(
    pos: GamePosition, roi: Decimal | None = None, pnl: Decimal | None = None
) -> PositionResponse:
    return PositionResponse(
        id=str(pos.id), side=pos.side, entry_price=pos.entry_price,
        size_amount=pos.size_amount, leverage=pos.leverage,
        stop_loss_price=pos.stop_loss_price, take_profit_price=pos.take_profit_price,
        status=pos.status, roi_pct=roi, pnl_amount=pnl,
    )


async def _read_latest_price(redis, ticker: str) -> Decimal | None:
    """최신가가 있고 신선하면 Decimal 가격, 아니면 None. (조회용 — 예외 없이)"""
    try:
        latest = await market_clock.read_latest(redis, ticker)
    except (RedisError, ValueError):
        return None
    if latest is None:
        return None
    try:
        ts = float(latest["ts"])
        price = latest["price"]
    except (KeyError, ValueError, TypeError):
        return None
    if not market_clock.is_price_fresh(ts, market_clock.now_epoch(), deps.STALE_SECONDS):
        return None
    return Decimal(str(price))


async def _require_fresh_price(redis, ticker: str) -> Decimal:
    """체결용 신선 가격. 없거나 오래되면 409, Redis 장애면 503."""
    try:
        latest = await market_clock.read_latest(redis, ticker)
    except RedisError:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "시세 서버에 연결할 수 없습니다.")
    except ValueError:
        raise HTTPException(status.HTTP_409_CONFLICT, "시세 데이터가 올바르지 않습니다.")
    if latest is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "시세 수신이 중단되었습니다.")
    try:
        ts = float(latest["ts"])
        price = latest["price"]
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status.HTTP_409_CONFLICT, "시세 데이터가 올바르지 않습니다.")
    if not market_clock.is_price_fresh(ts, market_clock.now_epoch(), deps.STALE_SECONDS):
        raise HTTPException(status.HTTP_409_CONFLICT, "시세 수신이 중단되었습니다.")
    return Decimal(str(price))


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
    if not market_clock.in_trading_window(market_clock.now_kst(), market_clock.load_windows()):
        raise HTTPException(status.HTTP_409_CONFLICT, "지금은 거래 시간이 아닙니다.")
    entry_price = await _require_fresh_price(redis, season.ticker)

    account = await account_service.get_or_create_account(db, user.id, season.id)
    try:
        pos = await order_engine.open_position(
            db, account=account, side=body.side, ratio=Decimal(str(body.ratio)),
            leverage=body.leverage, entry_price=entry_price,
            sl_pct=Decimal(str(body.stop_loss_pct)) if body.stop_loss_pct is not None else None,
            tp_pct=Decimal(str(body.take_profit_pct)) if body.take_profit_pct is not None else None,
        )
    except order_engine.OrderError as e:
        code = status.HTTP_409_CONFLICT if e.code == "ALREADY_OPEN" else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(code, str(e))
    roi = pricing.compute_roi_pct(pos.side, pos.entry_price, entry_price, pos.leverage)
    pnl = pricing.compute_pnl(pos.size_amount, roi)
    return _position_dto(pos, roi, pnl)


@router.post("/positions/{position_id}/close", response_model=PositionResponse)
async def close_order(
    position_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pos = await db.get(GamePosition, position_id)
    if pos is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "포지션을 찾을 수 없습니다.")
    account = await db.get(GameAccount, pos.account_id)
    if account is None or account.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "본인 포지션이 아닙니다.")
    season = await db.get(GameSeason, account.season_id)
    if season is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "시즌을 찾을 수 없습니다.")
    exit_price = await _require_fresh_price(deps.get_redis(), season.ticker)
    trade = await order_engine.close_position(
        db, position_id=pos.id, exit_price=exit_price, reason="MANUAL"
    )
    if trade is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 청산된 포지션입니다.")
    refreshed = await db.get(GamePosition, pos.id)
    return _position_dto(refreshed, trade.roi_pct, trade.pnl_amount)


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
    season = await db.get(GameSeason, season_id)
    cur = await _read_latest_price(deps.get_redis(), season.ticker) if season else None
    out = []
    for p in positions:
        roi = pnl = None
        if cur is not None:
            roi = pricing.compute_roi_pct(p.side, p.entry_price, cur, p.leverage)
            pnl = pricing.compute_pnl(p.size_amount, roi)
        out.append(_position_dto(p, roi, pnl))
    return out


@router.get("/accounts/me", response_model=AccountResponse)
async def my_account(
    season_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    season = await db.get(GameSeason, season_id)
    if season is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "시즌을 찾을 수 없습니다.")
    row = await db.execute(
        select(GameAccount).where(
            GameAccount.user_id == user.id, GameAccount.season_id == season_id
        )
    )
    acc = row.scalar_one_or_none()
    if acc is None:  # 읽기 전용 — 미보유 시 기본값(초기자본), DB 미기록
        return AccountResponse(
            season_id=season_id, cash_balance=INITIAL_CASH, total_asset=INITIAL_CASH,
            current_roi=Decimal("0"), total_trades=0, win_trades=0,
        )
    return AccountResponse(
        season_id=season_id, cash_balance=acc.cash_balance, total_asset=acc.total_asset,
        current_roi=acc.current_roi, total_trades=acc.total_trades, win_trades=acc.win_trades,
    )

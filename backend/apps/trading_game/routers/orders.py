"""트레이딩 게임 REST — 주문 진입/수동청산/조회."""
from __future__ import annotations

import asyncio
import logging
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
from apps.trading_game.schemas.game_dtos import (
    AccountResponse, NudgeDTO, OrderRequest, OrderResultResponse, PositionResponse,
)
from apps.trading_game.services import (
    account_service, academy_service, market_clock, nudge_engine, order_engine, position_cache, pricing,
    quest_service, ranking_service, rsi_service, streak_service,
)

router = APIRouter(prefix="/api/game", tags=["trading-game"])
log = logging.getLogger("trading_game.orders")


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


RSI_TIMEOUT_SECONDS = 2.0


async def _open_nudges(redis, ticker: str, body: OrderRequest, entry_price: Decimal) -> list[NudgeDTO]:
    """진입 넛지 — 실패·지연 시 빈 목록(체결 응답을 막지 않는 best-effort)."""
    rsi = None
    if body.side == "LONG":
        try:
            rsi = await asyncio.wait_for(
                rsi_service.current_rsi(redis, ticker, entry_price), timeout=RSI_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            await rsi_service.mark_closes_unavailable(redis, ticker)
            log.warning("RSI 조회 실패/지연 — 과열 넛지만 생략", exc_info=True)
            rsi = None
        except Exception:
            log.warning("RSI 조회 실패/지연 — 과열 넛지만 생략", exc_info=True)
            rsi = None
    try:
        found = nudge_engine.nudges_for_open(
            side=body.side, ratio=body.ratio, leverage=body.leverage, rsi=rsi
        )
        return [NudgeDTO(**n.to_dict()) for n in found]
    except Exception:
        log.warning("진입 넛지 생성 실패(주문은 정상 체결)", exc_info=True)
        return []


def _close_nudges(closed_reason: str, roi_pct: Decimal | None) -> list[NudgeDTO]:
    try:
        found = nudge_engine.nudges_for_close(closed_reason=closed_reason, roi_pct=roi_pct)
        return [NudgeDTO(**n.to_dict()) for n in found]
    except Exception:
        log.warning("청산 넛지 생성 실패(청산은 정상 완료)", exc_info=True)
        return []


async def _after_open_hooks(
    db: AsyncSession, redis, user_id: int, body: OrderRequest, ticker: str,
    entry_price: Decimal, stop_loss_price: Decimal | None,
) -> None:
    """퀘스트·Streak 갱신 — best-effort(실패해도 체결 응답 유지).

    응답 DTO 를 만든 '뒤'에 호출할 것: 실패 시 rollback 이 세션 객체를 expire 시킨다.
    """
    try:
        await quest_service.on_order_opened(
            db, redis, user_id, side=body.side, ratio=body.ratio,
            stop_loss_price=stop_loss_price, ticker=ticker, entry_price=entry_price,
        )
    except Exception:
        log.warning("퀘스트 갱신 실패(주문은 정상 체결) user=%s", user_id, exc_info=True)
        await _safe_rollback(db)
    try:
        await streak_service.touch(db, redis, user_id)
    except Exception:
        log.warning("Streak 갱신 실패(주문은 정상 체결) user=%s", user_id, exc_info=True)
        await _safe_rollback(db)


async def _safe_rollback(db: AsyncSession) -> None:
    try:
        await db.rollback()
    except Exception:
        log.warning("훅 실패 후 rollback 실패", exc_info=True)


@router.post("/orders", response_model=OrderResultResponse, status_code=status.HTTP_201_CREATED)
async def open_order(
    body: OrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    season = await account_service.get_active_season(db)
    if season is None or season.id != body.season_id or not account_service.season_is_tradable(season):
        raise HTTPException(status.HTTP_409_CONFLICT, "거래 가능한 ACTIVE 시즌이 아닙니다.")

    # Phase 5b: 5배 레버리지는 아카데미 통과자만(필수 게이트 — 체결 전에 거부)
    if body.leverage == academy_service.ACADEMY_LEVERAGE and not await academy_service.is_unlocked(db, user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": "LEVERAGE_LOCKED",
                    "message": "5배 레버리지는 아카데미 리스크 관리 퀴즈를 통과해야 사용할 수 있습니다."},
        )

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
    position_cache.mark_dirty()  # 실시간 청산·손익 캐시 재적재(훅 실패와 무관하게 먼저)
    roi = pricing.compute_roi_pct(pos.side, pos.entry_price, entry_price, pos.leverage)
    pnl = pricing.compute_pnl(pos.size_amount, roi)
    dto = _position_dto(pos, roi, pnl)
    nudges = await _open_nudges(redis, season.ticker, body, entry_price)
    await _after_open_hooks(
        db, redis, user.id, body, season.ticker, entry_price, dto.stop_loss_price
    )
    return OrderResultResponse(**dto.model_dump(), nudges=nudges)


@router.post("/positions/{position_id}/close", response_model=OrderResultResponse)
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
    position_cache.mark_dirty()
    try:
        await ranking_service.sync_account_rank(deps.get_redis(), db, account.id)
    except Exception:
        log.warning("랭킹 동기화 실패(청산은 정상 완료) account=%s", account.id, exc_info=True)
    refreshed = await db.get(GamePosition, pos.id)
    dto = _position_dto(refreshed, trade.roi_pct, trade.pnl_amount)
    return OrderResultResponse(**dto.model_dump(), nudges=_close_nudges("MANUAL", trade.roi_pct))


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

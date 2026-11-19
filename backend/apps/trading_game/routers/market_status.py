"""장운영 상태(VI·거래정지·서킷브레이크·사이드카) 공개 조회 — 화면을 열 때·WS 재연결 때 배너 초기값.

이후 변화는 WS type=market_status 로 온다(tick_listener 중계).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_db
from apps.trading_game import deps
from apps.trading_game.services import account_service, market_clock, market_status, real_market

# A안: REAL_MARKET OFF 면 관리자·시세 열람 권한 회원만(그 외 403 market_data_disabled)
router = APIRouter(
    prefix="/api/game", tags=["trading-game-market-status"],
    dependencies=[Depends(real_market.require_real_market)],
)


@router.get("/market-status")
async def get_market_status(db: AsyncSession = Depends(get_db)):
    """{ticker, state, message, blocking, since} — 활성 시즌 없으면 ticker=None·NORMAL."""
    now = market_clock.now_epoch()
    season = await account_service.get_active_season(db)
    if season is None:
        return {"ticker": None, **market_status.derive(None, now)}
    return {"ticker": season.ticker, **await market_status.read_status(deps.get_redis(), season.ticker, now)}

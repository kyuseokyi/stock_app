"""게임 분봉 캔들 REST(공개) — 일봉은 기존 stock_api 경로 그대로."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_db
from apps.trading_game.services import candles_service

router = APIRouter(prefix="/api/game", tags=["trading-game-candles"])


@router.get("/candles")
async def candles(
    interval: Literal["1m", "5m", "15m", "60m"] = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """활성 시즌 종목 분봉. t=버킷 시작 epoch seconds(UTC). 데이터 없으면 candles=[], CH 장애 503."""
    try:
        return await candles_service.get_candles(db, interval)
    except candles_service.CandlesUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "분봉 데이터를 불러올 수 없어요.")

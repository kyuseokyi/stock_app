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


@router.get("/candles/session")
async def session_bar(db: AsyncSession = Depends(get_db)):
    """분봉으로 만든 최근 거래일 하루 봉 {ticker, bar:{date,open,high,low,close,volume}|null}.

    일봉은 20:30 수집 후에야 오늘 행이 생긴다 — 클라이언트가 일봉 마지막 날짜보다 나중이면 이어 붙인다.
    """
    try:
        return await candles_service.get_session_bar(db)
    except candles_service.CandlesUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "오늘 봉을 불러올 수 없어요.")

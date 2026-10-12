"""클라이언트 실시간 WebSocket — 틱/개인손익/시장심리."""
from __future__ import annotations

import asyncio
import contextlib

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from shared.database import AsyncSessionLocal
from shared.security import decode_token
from shared.game_models import GameAccount, GamePosition, GameSeason
from apps.trading_game.services.connection_manager import manager, sentiment_from_counts

router = APIRouter()

SENTIMENT_INTERVAL = 5.0


async def _sentiment_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        async with AsyncSessionLocal() as db:
            season = await db.execute(select(GameSeason).where(GameSeason.status == "ACTIVE"))
            season = season.scalar_one_or_none()
            counts = {"LONG": 0, "SHORT": 0}
            if season is not None:
                rows = await db.execute(
                    select(GamePosition.side, func.count())
                    .join(GameAccount, GamePosition.account_id == GameAccount.id)
                    .where(GamePosition.status == "OPEN", GameAccount.season_id == season.id)
                    .group_by(GamePosition.side)
                )
                for side, cnt in rows.all():
                    counts[side] = cnt
        payload = {"type": "sentiment", **sentiment_from_counts(counts["LONG"], counts["SHORT"])}
        await manager.broadcast(payload)
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=SENTIMENT_INTERVAL)


@router.websocket("/ws/game/stream")
async def game_stream(ws: WebSocket, token: str = Query(...)):
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub", 0))
    except (jwt.PyJWTError, ValueError):
        await ws.close(code=4401)
        return
    await manager.connect(user_id, ws)
    try:
        while True:
            await ws.receive_text()  # 클라이언트 keep-alive(수신 무시)
    except WebSocketDisconnect:
        await manager.disconnect(user_id, ws)

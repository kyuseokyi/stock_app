"""클라이언트 실시간 WebSocket — 틱/개인손익/시장심리."""
from __future__ import annotations

import asyncio
import contextlib
import logging

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from shared.database import AsyncSessionLocal
from shared.security import decode_token
from shared.game_models import GameAccount, GamePosition
from apps.trading_game.services import account_service
from apps.trading_game.services.connection_manager import manager, sentiment_from_counts

router = APIRouter()
log = logging.getLogger("trading_game.sentiment")

SENTIMENT_INTERVAL = 5.0


async def _collect_sentiment() -> dict:
    async with AsyncSessionLocal() as db:
        season = await account_service.get_active_season(db)
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
    return {"type": "sentiment", **sentiment_from_counts(counts["LONG"], counts["SHORT"])}


async def _sentiment_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            payload = await _collect_sentiment()
            await manager.broadcast(payload)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("시장심리 집계 실패 — 다음 주기 재시도")
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=SENTIMENT_INTERVAL)


@router.websocket("/ws/game/stream")
async def game_stream(ws: WebSocket, token: str = Query(...)):
    try:
        payload = decode_token(token)
        sub = payload.get("sub")
        if not sub:
            raise ValueError("missing sub")
        user_id = int(sub)
    except (jwt.PyJWTError, ValueError, TypeError):
        await ws.accept()  # accept 후 close 해야 4401 코드가 클라이언트에 전달됨
        await ws.close(code=4401)
        return
    await manager.connect(user_id, ws)
    try:
        while True:
            await ws.receive_text()  # 클라이언트 keep-alive(수신 무시)
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(user_id, ws)

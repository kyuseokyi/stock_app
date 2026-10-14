"""클라이언트 실시간 WebSocket — 틱/개인손익/시장심리.

token 선택: 없으면 비로그인 공개 연결(틱·시장심리만), 있으면 기존 검증(잘못된 토큰 4401 — 공개로 강등하지 않음).
공개 연결 상한: IP당 GAME_WS_PUBLIC_PER_IP(3)·전체 GAME_WS_PUBLIC_MAX(2000), 초과 시 4429.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from shared.database import AsyncSessionLocal
from shared.security import decode_token
from shared.models import User
from shared.game_models import GameAccount, GamePosition
from apps.trading_game.services import account_service, ws_bus
from apps.trading_game.services.connection_manager import (  # noqa: F401 — SENTIMENT_INTERVAL 재노출
    SENTIMENT_INTERVAL, manager, sentiment_from_counts,
)

router = APIRouter()
log = logging.getLogger("trading_game.sentiment")

DEFAULT_PUBLIC_PER_IP = 3
DEFAULT_PUBLIC_MAX = 2000


def _env_int(name: str, default: int) -> int:
    try:
        v = int(os.getenv(name, default))
        return v if v >= 0 else default
    except ValueError:
        return default


def public_limits() -> tuple[int, int]:
    """(IP당, 전체) 공개 연결 상한 — 연결 시점에 env 를 읽는다."""
    return _env_int("GAME_WS_PUBLIC_PER_IP", DEFAULT_PUBLIC_PER_IP), _env_int("GAME_WS_PUBLIC_MAX", DEFAULT_PUBLIC_MAX)


def client_ip(ws: WebSocket) -> str:
    """CF-Connecting-IP(Cloudflare Tunnel) 우선, 없으면 소켓 peer host."""
    ip = (ws.headers.get("cf-connecting-ip") or "").strip()
    if ip:
        return ip
    return ws.client.host if ws.client else "unknown"


async def _keepalive(ws: WebSocket) -> None:
    try:
        while True:
            await ws.receive_text()  # 클라이언트 keep-alive(수신 무시)
    except WebSocketDisconnect:
        pass


async def _serve_public(ws: WebSocket) -> None:
    per_ip, max_total = public_limits()
    if not await manager.connect_public(ws, client_ip(ws), per_ip=per_ip, max_total=max_total):
        return
    try:
        await _keepalive(ws)
    finally:
        await manager.disconnect_public(ws)


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
            await ws_bus.publish_all(payload)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("시장심리 집계 실패 — 다음 주기 재시도")
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=SENTIMENT_INTERVAL)


@router.websocket("/ws/game/stream")
async def game_stream(ws: WebSocket, token: str | None = Query(None)):
    if token is None:  # 비로그인 공개 연결(빈 문자열 ?token= 은 잘못된 토큰 → 4401)
        await _serve_public(ws)
        return
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
    # REST 와 동일하게 유저 존재·활성 검증(비활성/삭제 유저 차단)
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
    if user is None or not user.is_active:
        await ws.accept()
        await ws.close(code=4401)
        return
    await manager.connect(user_id, ws)
    try:
        await _keepalive(ws)
    finally:
        await manager.disconnect(user_id, ws)

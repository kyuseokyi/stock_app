"""WS 연결 레지스트리 + Fan-out. 단일 워커 전제(인메모리)."""
from __future__ import annotations

import asyncio
import contextlib
import json

from fastapi import WebSocket

SEND_TIMEOUT = 2.0  # 느린 클라이언트 전송 타임아웃(초)


def sentiment_from_counts(long_count: int, short_count: int) -> dict:
    total = long_count + short_count
    if total == 0:
        return {"long_pct": 0.0, "short_pct": 0.0}
    return {
        "long_pct": round(long_count / total * 100, 1),
        "short_pct": round(short_count / total * 100, 1),
    }


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[int, set[WebSocket]] = {}  # user_id -> sockets
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._conns.setdefault(user_id, set()).add(ws)

    async def disconnect(self, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            conns = self._conns.get(user_id)
            if conns:
                conns.discard(ws)
                if not conns:
                    self._conns.pop(user_id, None)

    def user_ids(self) -> list[int]:
        return list(self._conns.keys())

    async def _safe_send(self, user_id: int, ws: WebSocket, text: str) -> None:
        try:
            await asyncio.wait_for(ws.send_text(text), timeout=SEND_TIMEOUT)
        except Exception:
            await self.disconnect(user_id, ws)
            with contextlib.suppress(Exception):
                await ws.close(code=1011)

    async def broadcast(self, payload: dict) -> None:
        text = json.dumps(payload, ensure_ascii=False)
        tasks = [
            self._safe_send(user_id, ws, text)
            for user_id, conns in list(self._conns.items())
            for ws in list(conns)
        ]
        if tasks:
            await asyncio.gather(*tasks)

    async def send_to_user(self, user_id: int, payload: dict) -> None:
        text = json.dumps(payload, ensure_ascii=False)
        tasks = [self._safe_send(user_id, ws, text) for ws in list(self._conns.get(user_id, set()))]
        if tasks:
            await asyncio.gather(*tasks)


manager = ConnectionManager()

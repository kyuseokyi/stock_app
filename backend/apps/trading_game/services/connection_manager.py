"""WS 연결 레지스트리(로그인 + 비로그인 공개) + Fan-out. 단일 워커 전제(인메모리)."""
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


CLOSE_PUBLIC_LIMIT = 4429  # 공개 연결 상한 초과(IP당/전체)


class ConnectionManager:
    """로그인 연결(user_id 별) + 비로그인 공개 연결(IP 별 집계).

    broadcast = 로그인+공개, send_to_user = 로그인만. 공개 연결은 user_ids() 에 포함되지 않는다.
    """

    def __init__(self) -> None:
        self._conns: dict[int, set[WebSocket]] = {}  # user_id -> sockets
        self._public: dict[WebSocket, str] = {}      # 공개 socket -> ip
        self._public_per_ip: dict[str, int] = {}
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

    async def connect_public(self, ws: WebSocket, ip: str, *, per_ip: int, max_total: int) -> bool:
        """상한 검사+등록을 한 번에(원자적). 초과면 accept 후 4429 close 하고 False."""
        async with self._lock:
            ok = len(self._public) < max_total and self._public_per_ip.get(ip, 0) < per_ip
            if ok:
                self._public[ws] = ip
                self._public_per_ip[ip] = self._public_per_ip.get(ip, 0) + 1
        try:
            await ws.accept()  # accept 후 close 해야 close 코드가 클라이언트에 전달됨
        except Exception:
            if ok:
                await self.disconnect_public(ws)
            raise
        if not ok:
            with contextlib.suppress(Exception):
                await ws.close(code=CLOSE_PUBLIC_LIMIT)
        return ok

    async def disconnect_public(self, ws: WebSocket) -> None:
        async with self._lock:
            ip = self._public.pop(ws, None)
            if ip is None:
                return
            left = self._public_per_ip.get(ip, 1) - 1
            if left > 0:
                self._public_per_ip[ip] = left
            else:
                self._public_per_ip.pop(ip, None)

    def user_ids(self) -> list[int]:
        return list(self._conns.keys())

    def public_count(self) -> int:
        return len(self._public)

    def public_count_for(self, ip: str) -> int:
        return self._public_per_ip.get(ip, 0)

    async def _safe_send(self, user_id: int | None, ws: WebSocket, text: str) -> None:
        """전송 실패 시 정리 — user_id=None 이면 공개 연결(IP 슬롯 반환)."""
        try:
            await asyncio.wait_for(ws.send_text(text), timeout=SEND_TIMEOUT)
        except Exception:
            if user_id is None:
                await self.disconnect_public(ws)
            else:
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
        tasks += [self._safe_send(None, ws, text) for ws in list(self._public)]
        if tasks:
            await asyncio.gather(*tasks)

    async def send_to_user(self, user_id: int, payload: dict) -> None:
        text = json.dumps(payload, ensure_ascii=False)
        tasks = [self._safe_send(user_id, ws, text) for ws in list(self._conns.get(user_id, set()))]
        if tasks:
            await asyncio.gather(*tasks)


manager = ConnectionManager()

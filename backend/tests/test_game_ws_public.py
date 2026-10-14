"""비로그인 공개 WS 채널 — 토큰 선택·IP/전체 상한(4429)·개인 메시지 미수신."""
from __future__ import annotations

import json
import time

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from shared.security import create_access_token
from apps.trading_game.routers import ws_gateway
from apps.trading_game.services.connection_manager import ConnectionManager


class FakeWS:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[dict] = []
        self.accepted = False
        self.closed: int | None = None
        self.fail = fail

    async def accept(self):
        self.accepted = True

    async def send_text(self, text):
        if self.fail:
            raise RuntimeError("broken pipe")
        self.sent.append(json.loads(text))

    async def close(self, code=1000):
        self.closed = code


# ---------------------------------------------------------------- ConnectionManager
async def test_public_receives_broadcast_but_not_personal_messages():
    m = ConnectionManager()
    user_ws, pub_ws = FakeWS(), FakeWS()
    await m.connect(7, user_ws)
    assert await m.connect_public(pub_ws, "1.1.1.1", per_ip=3, max_total=10) is True
    assert pub_ws.accepted
    await m.broadcast({"type": "tick", "price": 1})
    await m.send_to_user(7, {"type": "position_pnl"})
    assert user_ws.sent == [{"type": "tick", "price": 1}, {"type": "position_pnl"}]
    assert pub_ws.sent == [{"type": "tick", "price": 1}]
    assert m.user_ids() == [7]  # 공개 연결은 user_ids(개인손익 대상)에 없음


async def test_broadcast_users_excludes_public():
    m = ConnectionManager()
    user_ws, pub_ws = FakeWS(), FakeWS()
    await m.connect(7, user_ws)
    await m.connect_public(pub_ws, "1.1.1.1", per_ip=3, max_total=10)
    await m.broadcast_users({"type": "coach"})
    assert user_ws.sent == [{"type": "coach"}] and pub_ws.sent == []


async def test_public_per_ip_cap_closes_4429():
    m = ConnectionManager()
    for _ in range(3):
        assert await m.connect_public(FakeWS(), "1.1.1.1", per_ip=3, max_total=100)
    over = FakeWS()
    assert await m.connect_public(over, "1.1.1.1", per_ip=3, max_total=100) is False
    assert over.accepted and over.closed == 4429
    assert await m.connect_public(FakeWS(), "2.2.2.2", per_ip=3, max_total=100)  # 다른 IP 는 허용
    assert m.public_count() == 4


async def test_public_global_cap_closes_4429():
    m = ConnectionManager()
    assert await m.connect_public(FakeWS(), "1.1.1.1", per_ip=3, max_total=2)
    assert await m.connect_public(FakeWS(), "2.2.2.2", per_ip=3, max_total=2)
    over = FakeWS()
    assert await m.connect_public(over, "3.3.3.3", per_ip=3, max_total=2) is False
    assert over.closed == 4429


async def test_public_disconnect_and_failed_send_free_ip_slot():
    m = ConnectionManager()
    a, dead = FakeWS(), FakeWS(fail=True)
    await m.connect_public(a, "1.1.1.1", per_ip=2, max_total=10)
    await m.connect_public(dead, "1.1.1.1", per_ip=2, max_total=10)
    await m.broadcast({"type": "tick"})  # 실패한 공개 소켓 정리 → IP 슬롯 반환
    assert dead.closed == 1011 and m.public_count() == 1
    await m.disconnect_public(a)
    await m.disconnect_public(a)  # 중복 호출 안전
    assert m.public_count() == 0 and m.public_count_for("1.1.1.1") == 0


# ---------------------------------------------------------------- /ws/game/stream (TestClient)
class _FakeUser:
    is_active = True


class _FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, _model, _id):
        return _FakeUser()


@pytest.fixture
def ws_env(monkeypatch):
    mgr = ConnectionManager()
    monkeypatch.setattr(ws_gateway, "manager", mgr)
    monkeypatch.setattr(ws_gateway, "AsyncSessionLocal", lambda: _FakeSession())
    monkeypatch.delenv("GAME_WS_PUBLIC_PER_IP", raising=False)
    monkeypatch.delenv("GAME_WS_PUBLIC_MAX", raising=False)
    app = FastAPI()
    app.include_router(ws_gateway.router)
    with TestClient(app) as client:  # 공유 portal(한 이벤트 루프) — lifespan 없는 앱
        yield client, mgr


def _close_code(client, url, headers=None) -> int:
    with pytest.raises(WebSocketDisconnect) as ei:
        with client.websocket_connect(url, headers=headers or {}) as ws:
            ws.receive_text()
    return ei.value.code


def test_ws_without_token_is_public(ws_env):
    client, mgr = ws_env
    with client.websocket_connect("/ws/game/stream", headers={"CF-Connecting-IP": "9.9.9.9"}) as ws:
        assert mgr.public_count_for("9.9.9.9") == 1
        ws.portal.call(mgr.broadcast, {"type": "tick", "price": 100})
        assert json.loads(ws.receive_text()) == {"type": "tick", "price": 100}
    # 종료 후 슬롯 반환(수신 루프 finally)
    for _ in range(100):
        if mgr.public_count() == 0:
            break
        time.sleep(0.01)
    assert mgr.public_count() == 0


@pytest.mark.parametrize("url", ["/ws/game/stream?token=bad", "/ws/game/stream?token="])
def test_ws_invalid_or_empty_token_is_4401_not_public(ws_env, url):
    client, mgr = ws_env
    assert _close_code(client, url) == 4401
    assert mgr.public_count() == 0


def test_ws_public_per_ip_limit(ws_env, monkeypatch):
    client, mgr = ws_env
    monkeypatch.setenv("GAME_WS_PUBLIC_PER_IP", "2")
    h = {"CF-Connecting-IP": "5.5.5.5"}
    with client.websocket_connect("/ws/game/stream", headers=h), \
            client.websocket_connect("/ws/game/stream", headers=h):
        assert _close_code(client, "/ws/game/stream", h) == 4429
        with client.websocket_connect("/ws/game/stream", headers={"CF-Connecting-IP": "6.6.6.6"}):
            assert mgr.public_count() == 3


def test_ws_public_ip_falls_back_to_client_host(ws_env, monkeypatch):
    client, mgr = ws_env
    monkeypatch.setenv("GAME_WS_PUBLIC_PER_IP", "1")
    with client.websocket_connect("/ws/game/stream"):
        assert mgr.public_count_for("testclient") == 1
        assert _close_code(client, "/ws/game/stream") == 4429


def test_ws_public_global_limit(ws_env, monkeypatch):
    client, _ = ws_env
    monkeypatch.setenv("GAME_WS_PUBLIC_MAX", "1")
    with client.websocket_connect("/ws/game/stream", headers={"CF-Connecting-IP": "1.0.0.1"}):
        assert _close_code(client, "/ws/game/stream", {"CF-Connecting-IP": "1.0.0.2"}) == 4429


def test_ws_logged_in_gets_personal_public_does_not(ws_env):
    client, mgr = ws_env
    token = create_access_token(subject=42, role="FREE")
    with client.websocket_connect(f"/ws/game/stream?token={token}") as user_ws, \
            client.websocket_connect("/ws/game/stream") as pub_ws:
        assert mgr.user_ids() == [42] and mgr.public_count() == 1
        user_ws.portal.call(mgr.send_to_user, 42, {"type": "position_pnl", "position_id": "p"})
        user_ws.portal.call(mgr.broadcast, {"type": "sentiment", "long_pct": 50.0, "short_pct": 50.0})
        assert json.loads(user_ws.receive_text())["type"] == "position_pnl"
        assert json.loads(user_ws.receive_text())["type"] == "sentiment"
        assert json.loads(pub_ws.receive_text())["type"] == "sentiment"  # 개인 메시지 없이 바로 심리

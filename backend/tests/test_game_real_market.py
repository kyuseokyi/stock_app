"""A안 — trading_game REAL_MARKET 플래그(기본 OFF) 차단 검증.

설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 2-5·3-5·7절
판정 = 플래그 ON 또는 관리자 또는 시세 열람 권한 회원(stock_api 와 같은 shared.market_viewer).
conftest 가 기존 테스트를 위해 real_market.flag_on 을 ON 으로 덮어쓰므로, 여기서는 진짜 구현으로 되돌려 시험한다.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from shared.database import get_db
from shared.game_models import GameFeatureFlag, GameSeason
from shared.models import Base, User, UserRole
from shared.security import create_access_token
from apps.trading_game import deps
from apps.trading_game.main import app
from apps.trading_game.routers import ws_gateway
from apps.trading_game.services import candles_service, real_market
from apps.trading_game.services.connection_manager import ConnectionManager

# conftest 의 autouse 패치보다 먼저(수집 시점에) 잡아 둔 진짜 판정
REAL_FLAG_ON = real_market.flag_on


@pytest.fixture
def real_flag(monkeypatch):
    """플래그 판정을 진짜 구현(feature_flag_service — 행 없음 = OFF)으로."""
    monkeypatch.setattr(real_market, "flag_on", REAL_FLAG_ON)


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def users(maker):
    """역할별 회원 + Authorization 헤더(실제 JWT — 판정이 get_current_user 를 그대로 탄다)."""
    out: dict[str, dict] = {"anon": {}}
    async with maker() as db:
        for key, role, access in (("admin", UserRole.ADMIN, False), ("free", UserRole.FREE, False),
                                  ("granted", UserRole.FREE, True)):
            u = User(email=f"{key}@test.local", nickname=key, role=role, is_active=True, market_data_access=access)
            db.add(u)
            await db.commit()
            await db.refresh(u)
            out[key] = {"Authorization": f"Bearer {create_access_token(subject=u.id, role=u.role.value)}"}
    return out


@pytest.fixture
async def client(maker, real_flag, monkeypatch):
    async def _db():
        async with maker() as s:
            yield s

    async def _candles(_db, interval):
        return {"interval": interval, "ticker": "005930", "candles": [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]}

    async def _session_bar(_db):
        return {"ticker": "005930", "bar": None}

    monkeypatch.setattr(candles_service, "get_candles", _candles)
    monkeypatch.setattr(candles_service, "get_session_bar", _session_bar)
    app.dependency_overrides[get_db] = _db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _flag(maker, enabled: bool) -> None:
    async with maker() as db:
        db.add(GameFeatureFlag(key="REAL_MARKET", enabled=enabled))
        await db.commit()


async def _season(maker) -> GameSeason:
    async with maker() as db:
        s = GameSeason(season_number=1, ticker="005930", stock_name="삼성전자",
                       start_at=datetime(2026, 10, 1, tzinfo=timezone.utc), status="ACTIVE")
        db.add(s)
        await db.commit()
        await db.refresh(s)
        return s


PUBLIC_PATHS = ("/api/game/candles?interval=1m", "/api/game/candles/session", "/api/game/market-status")


# ---------------------------------------------------------------- 플래그 판정
async def test_flag_row_missing_is_off(maker, real_flag):
    async with maker() as db:
        assert await real_market.flag_on(db, deps.get_redis()) is False


async def test_flag_row_on_and_off(maker, real_flag):
    await _flag(maker, True)
    async with maker() as db:
        assert await real_market.flag_on(db, deps.get_redis()) is True


async def test_flag_db_error_is_off(real_flag):
    class _BrokenDB:
        async def get(self, *_a, **_k):
            raise RuntimeError("db down")

        async def rollback(self):
            pass

    assert await real_market.flag_on(_BrokenDB(), deps.get_redis()) is False


async def test_flag_redis_cache_off_value(maker, real_flag):
    await deps.get_redis().set("game:flag:REAL_MARKET", "0")
    async with maker() as db:
        db.add(GameFeatureFlag(key="REAL_MARKET", enabled=True))
        await db.commit()
        assert await real_market.flag_on(db, deps.get_redis()) is False  # 30초 캐시 우선(기존 규칙)


# ---------------------------------------------------------------- 공개 시세 REST
@pytest.mark.parametrize("who", ["anon", "free"])
async def test_off_public_market_rest_403(client, users, who):
    for path in PUBLIC_PATHS:
        r = await client.get(path, headers=users[who])
        assert r.status_code == 403, path
        assert r.json() == {"detail": "market_data_disabled"}


async def test_off_invalid_token_is_anonymous_not_401(client):
    r = await client.get("/api/game/market-status", headers={"Authorization": "Bearer bad"})
    assert r.status_code == 403 and r.json() == {"detail": "market_data_disabled"}


@pytest.mark.parametrize("who", ["admin", "granted"])
async def test_off_admin_and_granted_can_view(client, users, who):
    for path in PUBLIC_PATHS:
        assert (await client.get(path, headers=users[who])).status_code == 200, path


async def test_on_everyone_can_view(client, maker):
    await _flag(maker, True)
    r = await client.get("/api/game/candles?interval=5m")
    assert r.status_code == 200 and r.json()["candles"]
    assert (await client.get("/api/game/market-status")).json()["ticker"] is None


async def test_explicit_off_row_blocks(client, maker):
    await _flag(maker, False)
    assert (await client.get("/api/game/candles/session")).status_code == 403


# ---------------------------------------------------------------- 주문·청산
async def test_off_orders_403_for_free_user(client, users, maker):
    season = await _season(maker)
    body = {"season_id": season.id, "side": "LONG", "ratio": 0.5, "leverage": 1}
    r = await client.post("/api/game/orders", json=body, headers=users["free"])
    assert r.status_code == 403 and r.json() == {"detail": "market_data_disabled"}
    r = await client.post(
        "/api/game/positions/00000000-0000-0000-0000-000000000000/close", headers=users["free"],
    )
    assert r.status_code == 403 and r.json() == {"detail": "market_data_disabled"}


async def test_orders_still_require_login_first(client):
    r = await client.post("/api/game/orders", json={"season_id": 1, "side": "LONG", "ratio": 0.5, "leverage": 1})
    assert r.status_code == 401


@pytest.mark.parametrize("who", ["admin", "granted"])
async def test_off_orders_pass_gate_for_allowed(client, users, maker, who):
    """허용 사용자는 차단 게이트를 지나 기존 검사(시즌 불일치 409)까지 간다."""
    await _season(maker)
    r = await client.post("/api/game/orders", json={"season_id": 999, "side": "LONG", "ratio": 0.5, "leverage": 1},
                          headers=users[who])
    assert r.status_code == 409


async def test_on_orders_pass_gate(client, users, maker):
    await _flag(maker, True)
    await _season(maker)
    r = await client.post("/api/game/orders", json={"season_id": 999, "side": "LONG", "ratio": 0.5, "leverage": 1},
                          headers=users["free"])
    assert r.status_code == 409


# ---------------------------------------------------------------- seasons/active features
@pytest.mark.parametrize("who,expected", [("anon", False), ("free", False), ("admin", True), ("granted", True)])
async def test_off_active_season_features_per_requester(client, users, maker, who, expected):
    await _season(maker)
    f = (await client.get("/api/game/seasons/active", headers=users[who])).json()["features"]
    assert f["real_market"] is expected
    assert f["quiz"] is expected  # 퀴즈도 같은 판정(QUIZ 플래그 행 없음 = ON)
    assert f["streak"] is True    # 출석은 시세와 무관 — 그대로


async def test_on_active_season_features_open(client, maker):
    await _flag(maker, True)
    await _season(maker)
    f = (await client.get("/api/game/seasons/active")).json()["features"]
    assert f == {"quiz": True, "streak": True, "real_market": True}


# ---------------------------------------------------------------- 퀴즈
async def test_off_quiz_disabled_for_free_user(client, users):
    r = await client.get("/api/game/quiz/random", headers=users["free"])
    assert r.status_code == 503 and r.json()["detail"]["code"] == "FEATURE_DISABLED"
    r = await client.post("/api/game/quiz/1/submit", json={"choice": "UP"}, headers=users["free"])
    assert r.status_code == 503 and r.json()["detail"]["code"] == "FEATURE_DISABLED"


async def test_off_quiz_open_for_admin(client, users):
    r = await client.get("/api/game/quiz/random", headers=users["admin"])
    assert r.status_code != 503  # 게이트 통과(문제 없으면 404 등 기존 동작)


async def test_admin_quiz_management_unaffected(client, users):
    """관리자 퀴즈 관리 API 는 require_admin 만 본다 — REAL_MARKET OFF 와 무관."""
    r = await client.get("/api/game/admin/quizzes", headers=users["admin"])
    assert r.status_code == 200


async def test_admin_flag_list_shows_real_market_off_by_default(client, users):
    r = await client.get("/api/game/admin/feature-flags", headers=users["admin"])
    assert ("REAL_MARKET", False) in [(f["key"], f["enabled"]) for f in r.json()]
    r = await client.put("/api/game/admin/feature-flags/REAL_MARKET", json={"enabled": True}, headers=users["admin"])
    assert r.status_code == 200 and r.json()["enabled"] is True
    assert (await client.get("/api/game/market-status")).status_code == 200  # 캐시 삭제 → 바로 반영


# ---------------------------------------------------------------- WS /ws/game/stream
class _User:
    def __init__(self, role=UserRole.FREE, access=False):
        self.is_active = True
        self.role = role
        self.market_data_access = access


class _Session:
    def __init__(self, user):
        self.user = user

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, _model, _id):
        return self.user


@pytest.fixture
def ws_env(monkeypatch):
    """(client, manager, set_flag, set_user) — 플래그·회원을 바꿔 가며 WS 판정을 본다."""
    state = {"flag": False, "user": _User()}
    mgr = ConnectionManager()

    async def _flag_on(_db, _redis):
        return state["flag"]

    monkeypatch.setattr(real_market, "flag_on", _flag_on)
    monkeypatch.setattr(ws_gateway, "manager", mgr)
    monkeypatch.setattr(ws_gateway, "AsyncSessionLocal", lambda: _Session(state["user"]))
    monkeypatch.setenv("GAME_WS_DISABLED_HOLD_SEC", "0")  # 테스트는 안내 직후 바로 닫히게
    ws_app = FastAPI()
    ws_app.include_router(ws_gateway.router)
    with TestClient(ws_app) as c:
        yield c, mgr, (lambda v: state.__setitem__("flag", v)), (lambda u: state.__setitem__("user", u))


def _disabled_then_close(client, url) -> int:
    with pytest.raises(WebSocketDisconnect) as ei:
        with client.websocket_connect(url) as ws:
            assert json.loads(ws.receive_text())["type"] == "market_disabled"
            ws.receive_text()  # 틱·심리 없이 닫힘
    return ei.value.code


def test_ws_off_anonymous_gets_disabled_once_then_4429(ws_env):
    client, mgr, _, _ = ws_env
    assert _disabled_then_close(client, "/ws/game/stream") == 4429
    assert mgr.public_count() == 0 and mgr.user_ids() == []


def test_ws_off_free_user_gets_disabled_not_registered(ws_env):
    client, mgr, _, _ = ws_env
    token = create_access_token(subject=7, role="FREE")
    assert _disabled_then_close(client, f"/ws/game/stream?token={token}") == 4429
    assert mgr.user_ids() == []


@pytest.mark.parametrize("logged_in", [False, True])
def test_ws_off_disabled_connection_gets_no_tick_or_pnl(ws_env, monkeypatch, logged_in):
    """안내 뒤 틱(브로드캐스트)·개인손익(send_to_user)이 와도 받지 않고, 보관 시간이 지나면 4429 로 닫힌다."""
    client, mgr, _, _ = ws_env
    monkeypatch.setenv("GAME_WS_DISABLED_HOLD_SEC", "1")
    url = f"/ws/game/stream?token={create_access_token(subject=7, role='FREE')}" if logged_in else "/ws/game/stream"
    with pytest.raises(WebSocketDisconnect) as ei:
        with client.websocket_connect(url) as ws:
            assert json.loads(ws.receive_text())["type"] == "market_disabled"
            ws.portal.call(mgr.broadcast, {"type": "tick", "price": 1})
            ws.portal.call(mgr.send_to_user, 7, {"type": "position_pnl", "position_id": "p"})
            ws.receive_text()  # 틱·손익이 아니라 종료가 와야 한다
    assert ei.value.code == 4429
    assert mgr.public_count() == 0 and mgr.user_ids() == []


@pytest.mark.parametrize("user", [_User(role=UserRole.ADMIN), _User(access=True)])
def test_ws_off_admin_or_granted_streams(ws_env, user):
    client, mgr, _, set_user = ws_env
    set_user(user)
    token = create_access_token(subject=9, role=user.role.value)
    with client.websocket_connect(f"/ws/game/stream?token={token}") as ws:
        assert mgr.user_ids() == [9]
        ws.portal.call(mgr.broadcast, {"type": "tick", "price": 100})
        assert json.loads(ws.receive_text()) == {"type": "tick", "price": 100}


def test_ws_on_anonymous_is_public_stream(ws_env):
    client, mgr, set_flag, _ = ws_env
    set_flag(True)
    with client.websocket_connect("/ws/game/stream") as ws:
        assert mgr.public_count() == 1
        ws.portal.call(mgr.broadcast, {"type": "tick", "price": 100})
        assert json.loads(ws.receive_text()) == {"type": "tick", "price": 100}


def test_ws_off_invalid_token_still_4401(ws_env):
    client, _, _, _ = ws_env
    with pytest.raises(WebSocketDisconnect) as ei:
        with client.websocket_connect("/ws/game/stream?token=bad") as ws:
            ws.receive_text()
    assert ei.value.code == 4401

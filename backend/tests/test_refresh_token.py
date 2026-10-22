"""모바일 리프레시 토큰 — 스펙 docs/superpowers/specs/2026-10-22-mobile-refresh-token-design.md 5절(백엔드).

DB 는 sqlite in-memory, Redis 는 fakeredis. 시간은 refresh_tokens._utcnow 를 monkeypatch 해 조작한다.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
import sqlalchemy as sa
from fakeredis import aioredis as fake_aioredis
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.websockets import WebSocketDisconnect

from apps.auth.deps import get_redis as auth_get_redis
from apps.auth.main import app as auth_app
from apps.auth.services import refresh_tokens
from apps.auth.social.store import SocialStore, get_social_store
from apps.trading_game.routers import ws_gateway
from apps.trading_game.services.connection_manager import ConnectionManager
from shared import sessions
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, RefreshToken, User, UserRole, UserSession
from shared.security import create_access_token, decode_token, hash_password, hash_refresh_token

T0 = datetime(2026, 10, 22, 3, 0, tzinfo=timezone.utc)


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


class Clock:
    def __init__(self, now: datetime):
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kw) -> None:
        self.now = self.now + timedelta(**kw)


@pytest.fixture
def clock(monkeypatch):
    c = Clock(datetime.now(timezone.utc))  # 발급 접근 토큰이 실제 시각 기준으로도 유효하게 현재에서 시작
    monkeypatch.setattr(refresh_tokens, "_utcnow", c)
    return c


@pytest.fixture
async def ctx(maker, monkeypatch):
    """auth 앱(게스트 게이트 켬) + 공유 fakeredis."""
    monkeypatch.setenv("AUTH_GUEST_ENABLED", "true")
    redis = fake_aioredis.FakeRedis(decode_responses=True)

    async def _db():
        async with maker() as s:
            yield s

    auth_app.dependency_overrides[get_db] = _db
    auth_app.dependency_overrides[auth_get_redis] = lambda: redis
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=auth_app), base_url="http://t") as c:
        yield c, redis
    auth_app.dependency_overrides.clear()


async def _app_login(c, nickname: str = "주린이") -> dict:
    r = await c.post("/api/v1/auth/guest", json={"nickname": nickname, "platform": "app"})
    assert r.status_code == 200
    return r.json()


async def _refresh(c, token: str) -> httpx.Response:
    return await c.post("/api/v1/auth/refresh", json={"refresh_token": token})


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _rows(maker) -> list[RefreshToken]:
    async with maker() as db:
        return list((await db.execute(select(RefreshToken).order_by(RefreshToken.id))).scalars())


async def _active_rows(maker) -> list[RefreshToken]:
    return [r for r in await _rows(maker) if r.revoked_at is None and r.used_at is None]


# ── 유틸·만료 ────────────────────────────────────────────────────────────────
def test_access_token_lifetime_app_60min_web_12h():
    for plt, expected in (("app", 3600), ("web", 12 * 3600), ("admin", 12 * 3600), (None, 12 * 3600)):
        p = decode_token(create_access_token(subject=1, role="FREE", sid="s", platform=plt))
        assert p["exp"] - p["iat"] == expected, plt


def test_refresh_hash_is_sha256_hex():
    assert hash_refresh_token("abc") == hashlib.sha256(b"abc").hexdigest()
    assert len(hash_refresh_token("abc")) == 64


# ── 발급 대상 ────────────────────────────────────────────────────────────────
async def test_guest_app_login_issues_refresh(ctx, maker):
    c, _ = ctx
    body = await _app_login(c)
    assert body["refresh_token"] and body["expires_in"] == 3600
    p = decode_token(body["access_token"])
    assert p["plt"] == "app" and p["exp"] - p["iat"] == 3600
    rows = await _rows(maker)
    assert len(rows) == 1
    assert rows[0].token_hash == hash_refresh_token(body["refresh_token"]) and rows[0].sid == p["sid"]
    assert rows[0].platform == "app"


async def test_guest_web_login_has_no_refresh(ctx, maker):
    c, _ = ctx
    r = await c.post("/api/v1/auth/guest", json={"nickname": "주린이", "platform": "web"})
    body = r.json()
    assert body["refresh_token"] is None and body["expires_in"] is None
    assert body["user"]["email"] is not None  # 기존 필드 유지
    p = decode_token(body["access_token"])
    assert p["exp"] - p["iat"] == 12 * 3600
    assert await _rows(maker) == []


async def test_admin_login_has_no_refresh(ctx, maker):
    async with maker() as db:
        db.add(User(email="admin@stock.app", nickname="관리자", role=UserRole.ADMIN, is_active=True,
                    password_hash=hash_password("pw1234")))
        await db.commit()
    c, _ = ctx
    r = await c.post("/api/v1/auth/login", json={"email": "admin@stock.app", "password": "pw1234"})
    assert r.status_code == 200 and r.json()["refresh_token"] is None
    assert await _rows(maker) == []


@pytest.mark.parametrize("client, issued", [("app", True), ("web", False)])
async def test_social_exchange_refresh_only_for_app_client(maker, client, issued):
    verifier = "dBjftJeZ4CVP-mJ0z9-iFGc8Ld2ZRY0kbtiYn3sV1mA"
    cc = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    async with maker() as db:
        db.add(User(id=5, email="u5@t.local", nickname="u5", role=UserRole.FREE, is_active=True))
        await db.commit()
    store = SocialStore(fake_aioredis.FakeRedis(decode_responses=True))
    code = await store.issue_exchange_code(5, cc, client)

    async def _db():
        async with maker() as s:
            yield s

    auth_app.dependency_overrides[get_db] = _db
    auth_app.dependency_overrides[get_social_store] = lambda: store
    auth_app.dependency_overrides[auth_get_redis] = lambda: fake_aioredis.FakeRedis(decode_responses=True)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=auth_app), base_url="http://t") as c:
            r = await c.post("/api/v1/auth/social/exchange", json={"code": code, "code_verifier": verifier})
    finally:
        auth_app.dependency_overrides.clear()
    assert r.status_code == 200
    assert (r.json()["refresh_token"] is not None) is issued
    assert (len(await _rows(maker)) == 1) is issued


# ── 갱신 ────────────────────────────────────────────────────────────────────
async def test_refresh_rotates_keeps_sid_and_does_not_publish(ctx, maker, clock):
    c, redis = ctx
    login = await _app_login(c)
    sid = decode_token(login["access_token"])["sid"]
    ps = redis.pubsub()
    await ps.subscribe(sessions.SESSION_REPLACED_CHANNEL)
    await ps.get_message(timeout=1)

    clock.advance(minutes=59)
    r = await _refresh(c, login["refresh_token"])
    assert r.status_code == 200
    body = r.json()
    assert body["refresh_token"] != login["refresh_token"]
    assert body["expires_in"] == 3600 and body["token_type"] == "bearer"
    assert body["user"]["nickname"] == "주린이"
    p = decode_token(body["access_token"])
    assert p["sid"] == sid and p["plt"] == "app"
    assert await ps.get_message(ignore_subscribe_messages=True, timeout=0.2) is None  # 세션 교체 알림 없음

    old, new = await _rows(maker)
    assert old.used_at is not None and old.replaced_by_id == new.id and old.revoked_at is None
    assert new.used_at is None and new.sid == sid
    # 슬라이딩 30일
    assert refresh_tokens._aware(new.expires_at) == clock.now + timedelta(days=30)
    # 새 접근 토큰으로 인증 통과
    assert (await c.get("/api/v1/auth/me", headers=_bearer(body["access_token"]))).status_code == 200
    # 원래 접근 토큰도 sid 가 같아 아직 유효(만료 전)
    assert (await c.get("/api/v1/auth/me", headers=_bearer(login["access_token"]))).status_code == 200


async def test_refresh_unknown_or_empty_token_is_invalid(ctx):
    c, _ = ctx
    for payload in ({"refresh_token": "nope"}, {"refresh_token": ""}, {}):
        r = await c.post("/api/v1/auth/refresh", json=payload)
        assert r.status_code == 401
        assert r.json()["detail"]["code"] == "REFRESH_INVALID"
        assert r.json()["detail"]["message"]


async def test_refresh_expired(ctx, clock):
    c, _ = ctx
    login = await _app_login(c)
    clock.advance(days=30, seconds=1)
    r = await _refresh(c, login["refresh_token"])
    assert r.status_code == 401 and r.json()["detail"]["code"] == "REFRESH_EXPIRED"


async def test_refresh_revoked_after_logout_is_invalid(ctx, clock):
    c, _ = ctx
    login = await _app_login(c)
    assert (await c.post("/api/v1/auth/logout", json={"refresh_token": login["refresh_token"]})).status_code == 204
    r = await _refresh(c, login["refresh_token"])
    assert r.status_code == 401 and r.json()["detail"]["code"] == "REFRESH_INVALID"


async def test_reuse_within_grace_rerotates_and_revokes_previous_successor(ctx, maker, clock):
    c, _ = ctx
    login = await _app_login(c)
    first = (await _refresh(c, login["refresh_token"])).json()  # 응답 유실 가정
    clock.advance(seconds=10)
    retry = await _refresh(c, login["refresh_token"])
    assert retry.status_code == 200
    second = retry.json()
    assert second["refresh_token"] not in (first["refresh_token"], login["refresh_token"])
    # 앞서 만든 후속(first)은 폐기 → 쓰면 INVALID, second 는 정상
    r = await _refresh(c, first["refresh_token"])
    assert r.status_code == 401 and r.json()["detail"]["code"] == "REFRESH_INVALID"
    active = await _active_rows(maker)
    assert len(active) == 1 and active[0].token_hash == hash_refresh_token(second["refresh_token"])
    assert (await _refresh(c, second["refresh_token"])).status_code == 200


async def test_reuse_grace_does_not_extend_from_first_use(ctx, clock):
    c, _ = ctx
    login = await _app_login(c)
    await _refresh(c, login["refresh_token"])
    clock.advance(seconds=20)
    assert (await _refresh(c, login["refresh_token"])).status_code == 200  # 유예 내
    clock.advance(seconds=20)  # 첫 사용 후 40초
    r = await _refresh(c, login["refresh_token"])
    assert r.status_code == 401 and r.json()["detail"]["code"] == "REFRESH_REUSED"


async def test_reuse_after_grace_revokes_all_and_kills_session(ctx, maker, clock):
    c, _ = ctx
    login = await _app_login(c)
    uid = login["user"]["id"]
    rotated = (await _refresh(c, login["refresh_token"])).json()
    clock.advance(seconds=31)
    r = await _refresh(c, login["refresh_token"])
    assert r.status_code == 401 and r.json()["detail"]["code"] == "REFRESH_REUSED"
    # 별도 세션으로 다시 읽어 commit 확인
    assert all(row.revoked_at is not None for row in await _rows(maker))
    async with maker() as db:
        assert await db.get(UserSession, (uid, "app")) is None
    # 정상 후속 토큰도 무효, 기존 접근 토큰도 401
    r2 = await _refresh(c, rotated["refresh_token"])
    assert r2.status_code == 401 and r2.json()["detail"]["code"] == "REFRESH_INVALID"
    me = await c.get("/api/v1/auth/me", headers=_bearer(rotated["access_token"]))
    assert me.status_code == 401


async def test_relogin_invalidates_previous_refresh(ctx, maker):
    c, _ = ctx
    old = await _app_login(c)
    new = await _app_login(c)  # 같은 계정, 다른 기기에서 앱 로그인
    r = await _refresh(c, old["refresh_token"])
    assert r.status_code == 401 and r.json()["detail"]["code"] == "SESSION_REPLACED"
    assert (await _refresh(c, new["refresh_token"])).status_code == 200


async def test_web_login_does_not_affect_app_refresh(ctx):
    c, _ = ctx
    app_login = await _app_login(c)
    await c.post("/api/v1/auth/guest", json={"nickname": "주린이", "platform": "web"})
    assert (await _refresh(c, app_login["refresh_token"])).status_code == 200


async def test_refresh_inactive_user_is_invalid(ctx, maker):
    c, _ = ctx
    login = await _app_login(c)
    async with maker() as db:
        u = await db.get(User, login["user"]["id"])
        u.is_active = False
        await db.commit()
    r = await _refresh(c, login["refresh_token"])
    assert r.status_code == 401 and r.json()["detail"]["code"] == "REFRESH_INVALID"


async def test_delete_account_removes_refresh_tokens(maker):
    from apps.auth.services.account_deletion import CONFIRM_PHRASE, delete_account

    async with maker() as db:
        db.add(User(id=9, email="u9@t.local", nickname="u9", role=UserRole.FREE, is_active=True))
        await db.commit()
    async with maker() as db:
        sid = await sessions.start_session(db, 9, "app")
        raw = await refresh_tokens.issue(db, 9, sid)
    async with maker() as db:
        user = await db.get(User, 9)
        await delete_account(db, user, confirm=CONFIRM_PHRASE, redis=fake_aioredis.FakeRedis(decode_responses=True))
    assert await _rows(maker) == []
    async with maker() as db:
        with pytest.raises(refresh_tokens.RefreshError) as ei:
            await refresh_tokens.rotate(db, raw)
    assert ei.value.code == "REFRESH_INVALID"


async def test_cleanup_removes_rows_7_days_after_expiry_or_revoke(maker):
    async with maker() as db:
        db.add(User(id=3, email="u3@t.local", nickname="u3", role=UserRole.FREE, is_active=True))
        await db.commit()
    async with maker() as db:
        sid = await sessions.start_session(db, 3, "app")
        raw = await refresh_tokens.issue(db, 3, sid, now=T0)
        await refresh_tokens.logout(db, raw, now=T0)  # 폐기
        await refresh_tokens.issue(db, 3, sid, now=T0 - timedelta(days=40))  # 이미 만료 7일+ 지남
    assert len(await _rows(maker)) == 2
    async with maker() as db:
        await refresh_tokens.issue(db, 3, sid, now=T0 + timedelta(days=6))
    assert len(await _rows(maker)) == 2  # 만료 행만 정리(폐기는 아직 6일)
    async with maker() as db:
        await refresh_tokens.issue(db, 3, sid, now=T0 + timedelta(days=8))
    assert len(await _rows(maker)) == 2  # 폐기 행도 정리 → 최근 두 건만


# ── 로그아웃 ────────────────────────────────────────────────────────────────
async def test_logout_revokes_and_ends_app_session(ctx, maker):
    c, _ = ctx
    login = await _app_login(c)
    uid = login["user"]["id"]
    web = (await c.post("/api/v1/auth/guest", json={"nickname": "주린이", "platform": "web"})).json()
    r = await c.post("/api/v1/auth/logout", json={"refresh_token": login["refresh_token"]})
    assert r.status_code == 204
    assert all(row.revoked_at is not None for row in await _rows(maker))
    async with maker() as db:
        assert await db.get(UserSession, (uid, "app")) is None
        assert await db.get(UserSession, (uid, "web")) is not None  # 다른 플랫폼 영향 없음
    assert (await c.get("/api/v1/auth/me", headers=_bearer(login["access_token"]))).status_code == 401
    assert (await c.get("/api/v1/auth/me", headers=_bearer(web["access_token"]))).status_code == 200


async def test_logout_with_stale_refresh_keeps_new_device_session(ctx, maker):
    c, _ = ctx
    old = await _app_login(c)
    new = await _app_login(c)
    assert (await c.post("/api/v1/auth/logout", json={"refresh_token": old["refresh_token"]})).status_code == 204
    assert (await c.get("/api/v1/auth/me", headers=_bearer(new["access_token"]))).status_code == 200
    assert (await _refresh(c, new["refresh_token"])).status_code == 200


@pytest.mark.parametrize("kwargs", [{"json": {"refresh_token": "nope"}}, {"json": {}}, {}])
async def test_logout_always_204(ctx, kwargs):
    c, _ = ctx
    assert (await c.post("/api/v1/auth/logout", **kwargs)).status_code == 204


# ── 401 사유 코드(REST) ───────────────────────────────────────────────────────
@pytest.fixture
async def me_client(maker):
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(user: User = Depends(get_current_user)):
        return {"id": user.id}

    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def _seed_user(maker, uid=1, active=True):
    async with maker() as db:
        db.add(User(id=uid, email=f"u{uid}@t.local", nickname=f"u{uid}", role=UserRole.FREE, is_active=active))
        await db.commit()


async def test_401_expired_token_code(maker, me_client):
    await _seed_user(maker)
    async with maker() as db:
        sid = await sessions.start_session(db, 1, "app")
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    expired = create_access_token(subject=1, role="FREE", sid=sid, platform="app", now=past)
    r = await me_client.get("/whoami", headers=_bearer(expired))
    assert r.status_code == 401
    assert r.json()["detail"] == {"code": "TOKEN_EXPIRED", "message": "로그인이 만료됐어요. 다시 로그인해 주세요."}


@pytest.mark.parametrize("token", ["garbage", create_access_token(subject=1, role="FREE").replace(".", "x.", 1)])
async def test_401_invalid_token_code(maker, me_client, token):
    await _seed_user(maker)
    r = await me_client.get("/whoami", headers=_bearer(token))
    assert r.status_code == 401 and r.json()["detail"]["code"] == "TOKEN_INVALID"


async def test_401_missing_or_inactive_user_is_token_invalid(maker, me_client):
    await _seed_user(maker, uid=2, active=False)
    for uid in (2, 99):
        r = await me_client.get("/whoami", headers=_bearer(create_access_token(subject=uid, role="FREE")))
        assert r.status_code == 401 and r.json()["detail"]["code"] == "TOKEN_INVALID"


async def test_401_replaced_code_kept(maker, me_client):
    await _seed_user(maker)
    async with maker() as db:
        old = create_access_token(subject=1, role="FREE", sid=await sessions.start_session(db, 1, "app"), platform="app")
        await sessions.start_session(db, 1, "app")
    r = await me_client.get("/whoami", headers=_bearer(old))
    assert r.status_code == 401 and r.json()["detail"]["code"] == "SESSION_REPLACED"


# ── 게임 WS 만료 사유 ─────────────────────────────────────────────────────────
def test_ws_handshake_expired_token_reason(monkeypatch):
    monkeypatch.setattr(ws_gateway, "manager", ConnectionManager())
    app = FastAPI()
    app.include_router(ws_gateway.router)
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    expired = create_access_token(subject=1, role="FREE", sid="s", platform="app", now=past)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as ei:
            with client.websocket_connect(f"/ws/game/stream?token={expired}") as ws:
                ws.receive_text()
    assert ei.value.code == 4401 and ei.value.reason == "TOKEN_EXPIRED"


def test_ws_handshake_invalid_token_has_no_expired_reason(monkeypatch):
    monkeypatch.setattr(ws_gateway, "manager", ConnectionManager())
    app = FastAPI()
    app.include_router(ws_gateway.router)
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as ei:
            with client.websocket_connect("/ws/game/stream?token=garbage") as ws:
                ws.receive_text()
    assert ei.value.code == 4401 and ei.value.reason != "TOKEN_EXPIRED"


# ── 마이그레이션 ─────────────────────────────────────────────────────────────
def _load_migration():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "d2e3f4a5b6c7_refresh_tokens.py"
    spec = importlib.util.spec_from_file_location("mig_refresh_tokens", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_chain_and_single_head():
    mod = _load_migration()
    assert mod.revision == "d2e3f4a5b6c7" and mod.down_revision == "c1d2e3f4a5b6"
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    children = [p.name for p in versions.glob("*.py") if '"c1d2e3f4a5b6"' in p.read_text() and "down_revision" in p.read_text()
                and p.name != "c1d2e3f4a5b6_push_devices_post_notice.py"]
    assert children == ["d2e3f4a5b6c7_refresh_tokens.py"]


def test_migration_upgrade_downgrade_on_sqlite():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    mod = _load_migration()
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("refresh_tokens")}
        assert cols == {"id", "user_id", "platform", "sid", "token_hash", "created_at", "expires_at",
                        "used_at", "replaced_by_id", "revoked_at"}
        idx = {i["name"] for i in insp.get_indexes("refresh_tokens")}
        assert {"ix_refresh_tokens_user_id", "ix_refresh_tokens_sid"} <= idx
        uniques = insp.get_unique_constraints("refresh_tokens")
        assert any(u["column_names"] == ["token_hash"] for u in uniques)
        fks = {fk["referred_table"]: fk for fk in insp.get_foreign_keys("refresh_tokens")}
        assert fks["users"]["options"].get("ondelete") == "CASCADE"
        assert fks["refresh_tokens"]["options"].get("ondelete") == "SET NULL"
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
        assert "refresh_tokens" not in sa.inspect(conn).get_table_names()


def test_model_matches_migration_columns():
    t = RefreshToken.__table__
    assert {c.name for c in t.columns} == {"id", "user_id", "platform", "sid", "token_hash", "created_at",
                                           "expires_at", "used_at", "replaced_by_id", "revoked_at"}
    assert any(isinstance(c, sa.UniqueConstraint) and [col.name for col in c.columns] == ["token_hash"]
               for c in t.constraints)
    assert json.dumps(sorted(i.name for i in t.indexes)) == json.dumps(["ix_refresh_tokens_sid", "ix_refresh_tokens_user_id"])

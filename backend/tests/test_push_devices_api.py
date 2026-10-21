"""push_devices API — 토큰 upsert·소유자 교체·본인만 삭제·형식 검증."""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog.main import app
from apps.blog.repositories import push_repo
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, PushDevice, User, UserRole

TOKEN = "ExponentPushToken[abc123]"


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def api(maker):
    state: dict = {}

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return state["user"]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, state
    app.dependency_overrides.clear()


async def _users(maker) -> tuple[User, User]:
    async with maker() as s:
        a = User(nickname="가", role=UserRole.FREE, is_active=True)
        b = User(nickname="나", role=UserRole.FREE, is_active=True)
        s.add_all([a, b])
        await s.commit()
        return a, b


async def _devices(maker) -> list[PushDevice]:
    async with maker() as s:
        return list((await s.execute(select(PushDevice))).scalars())


async def test_put_creates_then_updates(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    r = await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android", "fund_notice": True})
    assert r.status_code == 204
    r = await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android", "fund_notice": False})
    assert r.status_code == 204
    devs = await _devices(maker)
    assert len(devs) == 1 and devs[0].user_id == a.id and devs[0].fund_notice is False


async def test_put_same_token_other_user_moves_owner(api, maker):
    client, state = api
    a, b = await _users(maker)
    state["user"] = a
    await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android"})
    state["user"] = b
    await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android"})
    devs = await _devices(maker)
    assert [d.user_id for d in devs] == [b.id]


async def test_put_rejects_non_expo_token(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    r = await client.put("/api/v1/push-devices", json={"token": "hello", "platform": "android"})
    assert r.status_code == 422


async def test_delete_only_own_token(api, maker):
    client, state = api
    a, b = await _users(maker)
    state["user"] = a
    await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android"})
    state["user"] = b
    r = await client.delete(f"/api/v1/push-devices/{TOKEN}")
    assert r.status_code == 204
    assert len(await _devices(maker)) == 1  # 남의 토큰은 그대로
    state["user"] = a
    r = await client.delete(f"/api/v1/push-devices/{TOKEN}")
    assert r.status_code == 204
    assert await _devices(maker) == []


async def test_delete_missing_is_204(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    assert (await client.delete("/api/v1/push-devices/ExponentPushToken[none]")).status_code == 204


async def test_put_invalid_platform_422(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    r = await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "web"})
    assert r.status_code == 422


async def test_put_default_fund_notice_true(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "ios"})
    devs = await _devices(maker)
    assert len(devs) == 1 and devs[0].fund_notice is True


async def test_put_token_with_slash_422(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    r = await client.put("/api/v1/push-devices", json={"token": "ExponentPushToken[a/b]", "platform": "android"})
    assert r.status_code == 422


async def test_upsert_race_retries_on_integrity_error(maker, monkeypatch):
    a, b = await _users(maker)
    async with maker() as s:  # 다른 요청이 먼저 같은 token 을 넣은 상태
        s.add(PushDevice(token=TOKEN, user_id=a.id, platform="android", fund_notice=True))
        await s.commit()

    real = push_repo._find_by_token
    calls = {"n": 0}

    async def fake_find(db, token):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(db, token)  # 첫 select 는 경합으로 못 본 상황

    monkeypatch.setattr(push_repo, "_find_by_token", fake_find)
    async with maker() as s:
        await push_repo.upsert_device(s, token=TOKEN, user_id=b.id, platform="ios", fund_notice=False)
    devs = await _devices(maker)
    assert len(devs) == 1 and devs[0].user_id == b.id and devs[0].platform == "ios"
    assert devs[0].fund_notice is False


async def test_put_token_with_trailing_newline_422(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    r = await client.put("/api/v1/push-devices", json={"token": TOKEN + "\n", "platform": "android"})
    assert r.status_code == 422

"""관리자 계정 — 슈퍼 관리자 전용 생성·비활성화·비밀번호 초기화, 내 비밀번호 변경, 시드 멱등.

DB 는 sqlite in-memory, Redis 는 conftest 의 fakeredis.
"""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth import seed_admin
from apps.auth.main import app as auth_app
from shared.database import get_db
from shared.models import Base, User, UserRole, UserSession
from shared.security import hash_password, verify_password

ACCOUNTS = "/api/v1/auth/admin/accounts"
LOGIN = "/api/v1/auth/login"
PW = "super-pass-1"


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def client(maker):
    async def _db():
        async with maker() as s:
            yield s

    auth_app.dependency_overrides[get_db] = _db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=auth_app), base_url="http://test") as c:
        yield c
    auth_app.dependency_overrides.clear()


async def _admin(maker, login_id: str, *, super_: bool = False, password: str = PW) -> User:
    async with maker() as db:
        u = User(email=login_id, nickname=login_id, role=UserRole.ADMIN, is_active=True,
                 is_super_admin=super_, password_hash=hash_password(password))
        db.add(u)
        await db.commit()
        await db.refresh(u)
        return u


async def _login(client, login_id: str, password: str = PW) -> httpx.Response:
    return await client.post(LOGIN, json={"email": login_id, "password": password})


async def _auth(client, login_id: str, password: str = PW) -> dict[str, str]:
    r = await _login(client, login_id, password)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
async def sup(maker, client):
    await _admin(maker, "admin@stock.app", super_=True)
    return await _auth(client, "admin@stock.app")


async def test_super_creates_admin_who_can_log_in(client, sup):
    r = await client.post(ACCOUNTS, json={"login_id": "manager1", "nickname": "운영자", "password": "first-pass"},
                          headers=sup)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["login_id"] == "manager1" and body["is_super_admin"] is False and body["is_active"] is True
    me = await client.get("/api/v1/auth/me", headers=await _auth(client, "manager1", "first-pass"))
    assert me.json()["role"] == "ADMIN" and me.json()["is_super_admin"] is False

    listed = (await client.get(ACCOUNTS, headers=sup)).json()
    assert [a["login_id"] for a in listed] == ["admin@stock.app", "manager1"]  # 슈퍼 관리자 먼저


async def test_login_response_marks_super_admin(client, sup):
    me = await client.get("/api/v1/auth/me", headers=sup)
    assert me.json()["is_super_admin"] is True


async def test_duplicate_login_id_conflict(client, sup, maker):
    await _admin(maker, "manager1")
    r = await client.post(ACCOUNTS, json={"login_id": "manager1", "nickname": "x", "password": "12345678"},
                          headers=sup)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "LOGIN_ID_TAKEN"


@pytest.mark.parametrize("login_id", ["ab", "Manager", "a@b.com", "한글아이디", "x" * 31])
async def test_invalid_login_id_rejected(client, sup, login_id):
    r = await client.post(ACCOUNTS, json={"login_id": login_id, "nickname": "x", "password": "12345678"},
                          headers=sup)
    assert r.status_code == 422


async def test_short_password_rejected(client, sup):
    r = await client.post(ACCOUNTS, json={"login_id": "manager1", "nickname": "x", "password": "1234567"},
                          headers=sup)
    assert r.status_code == 422


async def test_normal_admin_cannot_manage_accounts(client, sup, maker):
    target = await _admin(maker, "manager1")
    h = await _auth(client, "manager1")
    assert (await client.get(ACCOUNTS, headers=h)).status_code == 403
    r = await client.post(ACCOUNTS, json={"login_id": "manager2", "nickname": "x", "password": "12345678"}, headers=h)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "SUPER_ADMIN_REQUIRED"
    assert (await client.patch(f"{ACCOUNTS}/{target.id}/active", json={"is_active": False}, headers=h)).status_code == 403


async def test_member_cannot_manage_accounts(client, maker):
    from shared.security import create_access_token

    async with maker() as db:
        u = User(email="m@t.local", nickname="m", role=UserRole.FREE, is_active=True)
        db.add(u)
        await db.commit()
        await db.refresh(u)
    h = {"Authorization": f"Bearer {create_access_token(subject=u.id, role='FREE')}"}
    assert (await client.get(ACCOUNTS, headers=h)).status_code == 403


async def test_deactivated_admin_cannot_log_in_and_is_cut_off(client, sup, maker):
    target = await _admin(maker, "manager1")
    h = await _auth(client, "manager1")
    r = await client.patch(f"{ACCOUNTS}/{target.id}/active", json={"is_active": False}, headers=sup)
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert (await client.get("/api/v1/auth/me", headers=h)).status_code == 401  # 열린 로그인도 즉시 끊김
    assert (await _login(client, "manager1")).status_code == 403
    async with maker() as db:
        assert await db.get(UserSession, (target.id, "admin")) is None

    r = await client.patch(f"{ACCOUNTS}/{target.id}/active", json={"is_active": True}, headers=sup)
    assert r.status_code == 200 and (await _login(client, "manager1")).status_code == 200


async def test_reset_password_ends_sessions(client, sup, maker):
    target = await _admin(maker, "manager1")
    h = await _auth(client, "manager1")
    r = await client.post(f"{ACCOUNTS}/{target.id}/password", json={"new_password": "reset-pass-9"}, headers=sup)
    assert r.status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=h)).status_code == 401
    assert (await _login(client, "manager1")).status_code == 401
    assert (await _login(client, "manager1", "reset-pass-9")).status_code == 200


async def test_super_admin_account_is_locked(client, sup, maker):
    async with maker() as db:
        me_id = (await db.get(User, 1)).id
    r = await client.patch(f"{ACCOUNTS}/{me_id}/active", json={"is_active": False}, headers=sup)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "SUPER_ADMIN_LOCKED"
    r = await client.post(f"{ACCOUNTS}/{me_id}/password", json={"new_password": "12345678"}, headers=sup)
    assert r.status_code == 409


async def test_cannot_touch_non_admin_user(client, sup, maker):
    async with maker() as db:
        u = User(email="m@t.local", nickname="m", role=UserRole.FREE, is_active=True)
        db.add(u)
        await db.commit()
        await db.refresh(u)
    r = await client.patch(f"{ACCOUNTS}/{u.id}/active", json={"is_active": False}, headers=sup)
    assert r.status_code == 404 and r.json()["detail"]["code"] == "ADMIN_NOT_FOUND"


async def test_change_own_password(client, maker):
    await _admin(maker, "manager1")
    h = await _auth(client, "manager1")
    bad = await client.post("/api/v1/auth/me/password",
                            json={"current_password": "wrong-pass", "new_password": "new-pass-12"}, headers=h)
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "WRONG_PASSWORD"
    same = await client.post("/api/v1/auth/me/password",
                             json={"current_password": PW, "new_password": PW}, headers=h)
    assert same.json()["detail"]["code"] == "SAME_PASSWORD"

    ok = await client.post("/api/v1/auth/me/password",
                           json={"current_password": PW, "new_password": "new-pass-12"}, headers=h)
    assert ok.status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=h)).status_code == 200  # 지금 로그인은 유지
    assert (await _login(client, "manager1")).status_code == 401
    assert (await _login(client, "manager1", "new-pass-12")).status_code == 200


async def test_super_admin_can_change_own_password(client, sup):
    r = await client.post("/api/v1/auth/me/password",
                          json={"current_password": PW, "new_password": "changed-99"}, headers=sup)
    assert r.status_code == 204
    assert (await _login(client, "admin@stock.app", "changed-99")).status_code == 200


async def test_seed_keeps_changed_password(maker, monkeypatch):
    monkeypatch.setattr(seed_admin, "ADMIN_EMAIL", "admin@stock.app")
    monkeypatch.setattr(seed_admin, "ADMIN_PASSWORD", "admin1234")
    assert await seed_admin.seed(session_factory=maker, reset_password=False) == "생성"
    async with maker() as db:
        u = await db.get(User, 1)
        assert u.is_super_admin and u.role == UserRole.ADMIN
        u.password_hash = hash_password("my-own-pass")
        await db.commit()

    assert await seed_admin.seed(session_factory=maker, reset_password=False) == "갱신(비밀번호 유지)"
    async with maker() as db:
        assert verify_password("my-own-pass", (await db.get(User, 1)).password_hash)

    await seed_admin.seed(session_factory=maker, reset_password=True)
    async with maker() as db:
        assert verify_password("admin1234", (await db.get(User, 1)).password_hash)


async def test_member_cannot_change_password(client, maker):
    """심사 계정처럼 비밀번호가 있는 일반 회원도 이 API 로는 못 바꾼다(관리자 전용)."""
    from shared.security import create_access_token

    async with maker() as db:
        u = User(email="review@t.local", nickname="r", role=UserRole.FREE, is_active=True,
                 password_hash=hash_password(PW))
        db.add(u)
        await db.commit()
        await db.refresh(u)
    h = {"Authorization": f"Bearer {create_access_token(subject=u.id, role='FREE')}"}
    r = await client.post("/api/v1/auth/me/password",
                          json={"current_password": PW, "new_password": "new-pass-12"}, headers=h)
    assert r.status_code == 403

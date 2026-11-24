"""관리자 등급별 권한(RBAC) — 유효 권한 계산, 서비스별 가드, 시세 우회, 등급 표·등급 변경 API.

명세: docs/admin_rbac_permissions_spec_and_plan.md. DB 는 sqlite in-memory.
"""
from __future__ import annotations

import httpx
import pytest
from fastapi import Depends, FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth.main import app as auth_app
from apps.blog.main import app as blog_app
from apps.trading_game.main import app as game_app
from shared import admin_permissions as P
from shared import market_viewer
from shared.auth import get_current_user, require_permission
from shared.database import get_db
from shared.models import AdminTierPolicy, Base, User, UserRole
from shared.security import hash_password

PW = "rbac-pass-1"


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def _admin(maker, login_id: str, *, tier: str | None = None, super_: bool = False,
                 custom: str | None = None, role=UserRole.ADMIN) -> User:
    async with maker() as db:
        u = User(email=login_id, nickname=login_id, role=role, is_active=True, is_super_admin=super_,
                 admin_tier=tier, custom_permissions=custom, password_hash=hash_password(PW))
        db.add(u)
        await db.commit()
        await db.refresh(u)
        return u


def _client(app, maker, user: User | None = None) -> httpx.AsyncClient:
    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    for app in (auth_app, blog_app, game_app):
        app.dependency_overrides.clear()


# ---------------------------------------------------------------- 유효 권한 계산
async def test_permissions_by_tier_and_defaults(maker):
    sup = await _admin(maker, "super", super_=True)
    legacy = await _admin(maker, "legacy")  # 등급 없음 = OPERATOR
    analyst = await _admin(maker, "analyst", tier="ANALYST")
    editor = await _admin(maker, "editor", tier="EDITOR", custom='["DATA_PIPELINE", "ADMIN_ROLE_MANAGE", "?"]')
    member = await _admin(maker, "member", role=UserRole.FREE)
    async with maker() as db:
        assert await P.permissions_for(db, sup) == P.ALL_PERMISSIONS
        assert await P.permissions_for(db, legacy) == P.GRANTABLE  # 계정 관리만 빼고 전부(등급 도입 전과 같음)
        assert await P.permissions_for(db, analyst) == {P.SCREENER_VIEW, P.CONTENT_MANAGE, P.GAME_MANAGE}
        # 개별 권한은 더하기만, 슈퍼 고정 권한·모르는 키는 버린다
        assert await P.permissions_for(db, editor) == {P.CONTENT_MANAGE, P.GAME_MANAGE, P.DATA_PIPELINE}
        assert await P.permissions_for(db, member) == frozenset()


async def test_policy_row_overrides_default(maker):
    analyst = await _admin(maker, "analyst", tier="ANALYST")
    async with maker() as db:
        db.add(AdminTierPolicy(tier="ANALYST", permissions_json='["AD_MANAGE"]'))
        await db.commit()
        assert await P.permissions_for(db, analyst) == {P.AD_MANAGE}


# ---------------------------------------------------------------- 가드
async def test_require_permission_any_of(maker):
    app = FastAPI()

    @app.get("/x")
    async def _x(_u: User = Depends(require_permission(P.SCREENER_VIEW, P.DATA_PIPELINE))):
        return {"ok": True}

    editor = await _admin(maker, "editor", tier="EDITOR")
    analyst = await _admin(maker, "analyst", tier="ANALYST")
    async with _client(app, maker, editor) as c:
        r = await c.get("/x")
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "INSUFFICIENT_ADMIN_PERMISSION"
        assert r.json()["detail"]["required"] == [P.SCREENER_VIEW, P.DATA_PIPELINE]
    app.dependency_overrides[get_current_user] = lambda: analyst
    async with _client(app, maker) as c:
        assert (await c.get("/x")).status_code == 200


def test_unknown_permission_key_is_programming_error():
    with pytest.raises(ValueError):
        require_permission("NOPE")


async def test_analyst_cannot_update_app_version(maker):
    analyst = await _admin(maker, "analyst", tier="ANALYST")
    async with _client(blog_app, maker, analyst) as c:
        r = await c.put("/api/v1/admin/app-versions/android", json={})
        assert r.status_code == 403 and r.json()["detail"]["required"] == [P.APP_UPDATE_MANAGE]
        # 게시판 관리는 된다(CONTENT_MANAGE) — 403 이 아니면 통과(본문 검증 422 등은 무관)
        assert (await c.post("/api/v1/boards", json={})).status_code != 403


async def test_real_market_flag_needs_switch_permission(maker):
    editor = await _admin(maker, "editor", tier="EDITOR")  # GAME_MANAGE 만
    async with _client(game_app, maker, editor) as c:
        r = await c.put("/api/game/admin/feature-flags/REAL_MARKET", json={"enabled": True})
        assert r.status_code == 403 and r.json()["detail"]["required"] == [P.SCREENER_SETTINGS]
        assert (await c.put("/api/game/admin/feature-flags/QUIZ", json={"enabled": False})).status_code == 200


async def test_super_admin_passes_everything(maker):
    sup = await _admin(maker, "super", super_=True)
    async with _client(game_app, maker, sup) as c:
        assert (await c.put("/api/game/admin/feature-flags/REAL_MARKET", json={"enabled": False})).status_code == 200


# ---------------------------------------------------------------- 시세 스위치 우회
async def test_market_view_bypass_requires_screener_view(maker):
    sup = await _admin(maker, "super", super_=True)
    legacy = await _admin(maker, "legacy")
    analyst = await _admin(maker, "analyst", tier="ANALYST")
    editor = await _admin(maker, "editor", tier="EDITOR")
    async with maker() as db:
        assert await market_viewer.can_view(sup, db) is True
        assert await market_viewer.can_view(legacy, db) is True
        assert await market_viewer.can_view(analyst, db) is True
        assert await market_viewer.can_view(editor, db) is False  # 일반 회원과 같게 막힌다
        editor.market_data_access = True
        assert await market_viewer.can_view(editor, db) is True  # 개별 시세 열람 권한이 있으면 허용
        assert await market_viewer.can_view(None, db) is False


# ---------------------------------------------------------------- 인증 서버 — 응답·등급 표·등급 변경
async def _login(c, login_id: str) -> dict:
    r = await c.post("/api/v1/auth/login", json={"email": login_id, "password": PW})
    assert r.status_code == 200, r.text
    return r.json()


async def test_login_and_me_include_tier_and_permissions(maker):
    await _admin(maker, "admin@stock.app", super_=True)
    await _admin(maker, "editor", tier="EDITOR")
    async with _client(auth_app, maker) as c:
        sup = await _login(c, "admin@stock.app")
        assert sup["user"]["admin_tier"] == "SUPER_ADMIN"
        assert sup["user"]["permissions"] == [k for k, _, _ in P.PERMISSIONS]
        ed = await _login(c, "editor")
        assert ed["user"]["admin_tier"] == "EDITOR"
        assert ed["user"]["permissions"] == [P.CONTENT_MANAGE, P.GAME_MANAGE]
        me = await c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {ed['access_token']}"})
        assert me.json()["permissions"] == [P.CONTENT_MANAGE, P.GAME_MANAGE]


async def test_role_policies_update_applies_immediately(maker):
    await _admin(maker, "admin@stock.app", super_=True)
    await _admin(maker, "editor", tier="EDITOR")
    async with _client(auth_app, maker) as c:
        sup = {"Authorization": f"Bearer {(await _login(c, 'admin@stock.app'))['access_token']}"}
        ed = {"Authorization": f"Bearer {(await _login(c, 'editor'))['access_token']}"}

        got = (await c.get("/api/v1/auth/admin/role-policies", headers=ed)).json()  # 조회는 모든 관리자
        assert [t["tier"] for t in got["tiers"]] == ["OPERATOR", "ANALYST", "EDITOR"]
        assert {p["key"]: p["grantable"] for p in got["permissions"]}[P.ADMIN_ROLE_MANAGE] is False

        r = await c.put("/api/v1/auth/admin/role-policies/EDITOR", json={"permissions": ["AD_MANAGE"]}, headers=ed)
        assert r.status_code == 403  # 수정은 슈퍼 관리자만
        r = await c.put("/api/v1/auth/admin/role-policies/EDITOR", json={"permissions": ["AD_MANAGE"]}, headers=sup)
        assert r.status_code == 200
        assert (await c.get("/api/v1/auth/me", headers=ed)).json()["permissions"] == [P.AD_MANAGE]

        bad = await c.put("/api/v1/auth/admin/role-policies/EDITOR", json={"permissions": ["ADMIN_ROLE_MANAGE"]},
                          headers=sup)
        assert bad.status_code == 422 and bad.json()["detail"]["code"] == "INVALID_PERMISSION"
        assert (await c.put("/api/v1/auth/admin/role-policies/SUPER_ADMIN", json={"permissions": []},
                            headers=sup)).status_code == 404


async def test_create_admin_with_tier_and_change_tier(maker):
    await _admin(maker, "admin@stock.app", super_=True)
    async with _client(auth_app, maker) as c:
        sup = {"Authorization": f"Bearer {(await _login(c, 'admin@stock.app'))['access_token']}"}
        r = await c.post("/api/v1/auth/admin/accounts", headers=sup, json={
            "login_id": "analyst1", "nickname": "분석", "password": PW,
            "admin_tier": "ANALYST", "custom_permissions": ["DATA_PIPELINE"]})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["admin_tier"] == "ANALYST" and body["custom_permissions"] == ["DATA_PIPELINE"]
        assert (await _login(c, "analyst1"))["user"]["permissions"] == [
            P.SCREENER_VIEW, P.DATA_PIPELINE, P.CONTENT_MANAGE, P.GAME_MANAGE]

        r = await c.patch(f"/api/v1/auth/admin/accounts/{body['id']}/tier", headers=sup,
                          json={"admin_tier": "EDITOR", "custom_permissions": []})
        assert r.status_code == 200 and r.json()["admin_tier"] == "EDITOR"
        assert (await _login(c, "analyst1"))["user"]["permissions"] == [P.CONTENT_MANAGE, P.GAME_MANAGE]

        # 슈퍼 관리자는 만들 수 없다(등급 값 검증) · 줄 수 없는 개별 권한은 거부
        r = await c.post("/api/v1/auth/admin/accounts", headers=sup, json={
            "login_id": "super2", "nickname": "x", "password": PW, "admin_tier": "SUPER_ADMIN"})
        assert r.status_code == 422
        r = await c.patch(f"/api/v1/auth/admin/accounts/{body['id']}/tier", headers=sup,
                          json={"admin_tier": "EDITOR", "custom_permissions": ["ADMIN_ROLE_MANAGE"]})
        assert r.status_code == 422
        listed = (await c.get("/api/v1/auth/admin/accounts", headers=sup)).json()
        assert listed[0]["admin_tier"] == "SUPER_ADMIN"


async def test_editor_can_read_market_switch_but_not_change(maker):
    """블로그 편집기는 전체 시세 스위치 값을 읽어야 한다(차트 삽입 막기) — 조회는 모든 관리자, 변경은 SCREENER_SETTINGS."""
    from apps.stock_api.main import app as stock_app

    editor = await _admin(maker, "editor", tier="EDITOR")
    try:
        async with _client(stock_app, maker, editor) as c:
            assert (await c.get("/api/v1/admin/screener/features")).status_code == 200
            r = await c.put("/api/v1/admin/screener/features/MARKET_DATA", json={"enabled": True})
            assert r.status_code == 403 and r.json()["detail"]["required"] == [P.SCREENER_SETTINGS]
    finally:
        stock_app.dependency_overrides.clear()

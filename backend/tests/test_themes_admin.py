"""테마 관리자 보정 API — 목록·생성·수정(숨김)·종목 추가·제외, 관리자만 (sqlite)."""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.auth import get_current_user
from shared.database import get_db
from shared.market_models import Theme, ThemeStock
from shared.models import Base, User, UserRole
from apps.stock_api.main import app


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


async def _seed(maker):
    async with maker() as s:
        admin = User(nickname="관리자", role=UserRole.ADMIN, is_active=True)
        user = User(nickname="일반", role=UserRole.FREE, is_active=True)
        theme = Theme(kis_code="004", name="반도체", source="kis")
        s.add_all([admin, user, theme])
        await s.commit()
        s.add(ThemeStock(theme_id=theme.id, ticker="005930", source="kis"))
        await s.commit()
        return admin, user, theme.id


async def test_non_admin_forbidden(api, maker):
    client, state = api
    _, user, _ = await _seed(maker)
    state["user"] = user
    assert (await client.get("/api/v1/admin/themes")).status_code == 403


async def test_admin_flow(api, maker):
    client, state = api
    admin, _, tid = await _seed(maker)
    state["user"] = admin

    listed = (await client.get("/api/v1/admin/themes")).json()
    assert listed == [{"id": tid, "kis_code": "004", "name": "반도체", "source": "kis", "is_hidden": False,
                       "description": None, "stock_count": 1}]

    r = await client.post("/api/v1/admin/themes", json={"name": " HBM ", "description": "고대역폭 메모리"})
    assert r.status_code == 201
    created = r.json()
    assert created["source"] == "admin" and created["name"] == "HBM" and created["stock_count"] == 0

    patched = (await client.patch(f"/api/v1/admin/themes/{tid}", json={"is_hidden": True})).json()
    assert patched["is_hidden"] is True and patched["name"] == "반도체"

    r = await client.post(f"/api/v1/admin/themes/{tid}/stocks", json={"ticker": "042700", "reason": "HBM 장비"})
    assert r.status_code == 201
    assert (await client.delete(f"/api/v1/admin/themes/{tid}/stocks/005930")).status_code == 204
    stocks = (await client.get(f"/api/v1/admin/themes/{tid}/stocks")).json()
    assert {(s["ticker"], s["source"], s["is_excluded"]) for s in stocks} == {
        ("005930", "kis", True), ("042700", "admin", False)}
    assert (await client.get("/api/v1/admin/themes")).json()[-1]["stock_count"] == 1  # 숨김 테마는 뒤로, 제외 종목 빼고 셈

    # 제외했던 종목을 다시 추가하면 제외만 풀린다(출처 유지)
    await client.post(f"/api/v1/admin/themes/{tid}/stocks", json={"ticker": "005930"})
    stocks = (await client.get(f"/api/v1/admin/themes/{tid}/stocks")).json()
    assert ("005930", "kis", False) in {(s["ticker"], s["source"], s["is_excluded"]) for s in stocks}


async def test_missing_theme_404(api, maker):
    client, state = api
    admin, _, _ = await _seed(maker)
    state["user"] = admin
    assert (await client.patch("/api/v1/admin/themes/999", json={"name": "x"})).status_code == 404
    assert (await client.get("/api/v1/admin/themes/999/stocks")).status_code == 404
    assert (await client.post("/api/v1/admin/themes/999/stocks", json={"ticker": "005930"})).status_code == 404

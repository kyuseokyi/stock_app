"""광고 원격 설정 — 공개 조회(기본 꺼짐·시드 누락)·관리자 API(권한·검증)·마이그레이션."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog.main import app
from apps.blog.services.ad_config import GLOBAL_KEYS, SLOT_DEFAULTS
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import AdConfig, Base, User, UserRole

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION = VERSIONS_DIR / "a7d1c3e5f902_ad_configs.py"
PUBLIC = "/api/v1/ads/config"
ADMIN = "/api/v1/admin/ads/config"


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
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


@pytest.fixture
async def admin(maker):
    async with maker() as s:
        row = User(email="admin@stock.app", nickname="관리자", role=UserRole.ADMIN, is_active=True)
        s.add(row)
        await s.commit()
        return row


def _body(**kw) -> dict:
    return {"enabled": True, "provider": "HOUSE", "infeed_interval": 5, "house_title": "제목",
            "house_description": "설명", "house_target_path": "/game", **kw}


# ── 공개 조회 ───────────────────────────────────────────────────────────────
async def test_public_defaults_all_off_without_rows_and_without_auth(api):
    client, _state = api
    res = await client.get(PUBLIC)
    assert res.status_code == 200 and res.headers["cache-control"] == "no-store"
    body = res.json()
    assert body["web_enabled"] is False and body["mobile_enabled"] is False
    assert set(body["slots"]) == set(SLOT_DEFAULTS) - set(GLOBAL_KEYS)     # 전체 스위치는 slots 에 안 나간다
    assert all(s["enabled"] is False and s["provider"] == "HOUSE" for s in body["slots"].values())
    assert body["slots"]["WEB_POST_LIST_INFEED"]["infeed_interval"] == 5
    assert body["slots"]["WEB_HOME_SIDEBAR"]["house"]["target_path"] == "/game"


async def test_public_reflects_admin_change(api, admin):
    client, state = api
    state["user"] = admin
    assert (await client.put(f"{ADMIN}/GLOBAL_WEB", json={"enabled": True})).status_code == 200
    assert (await client.put(f"{ADMIN}/WEB_HOME_SIDEBAR", json=_body(house_title="새 배너"))).status_code == 200
    body = (await client.get(PUBLIC)).json()
    assert body["web_enabled"] is True and body["mobile_enabled"] is False
    slot = body["slots"]["WEB_HOME_SIDEBAR"]
    assert slot["enabled"] is True and slot["house"]["title"] == "새 배너"
    assert body["slots"]["WEB_SCREENER_FOOTER"]["enabled"] is False


async def test_public_ignores_unknown_rows(api, maker):
    client, _state = api
    async with maker() as s:
        s.add(AdConfig(slot_key="OLD_SLOT", enabled=True))
        await s.commit()
    assert "OLD_SLOT" not in (await client.get(PUBLIC)).json()["slots"]


# ── 관리자 ──────────────────────────────────────────────────────────────────
async def test_admin_requires_admin_role(api, maker):
    client, state = api
    state["user"] = User(nickname="일반", role=UserRole.FREE, is_active=True)
    assert (await client.get(ADMIN)).status_code == 403
    assert (await client.put(f"{ADMIN}/GLOBAL_WEB", json={"enabled": True})).status_code == 403
    async with maker() as s:
        assert (await s.execute(select(AdConfig))).first() is None


async def test_admin_list_keeps_order_and_marks_defaults(api, admin):
    client, state = api
    state["user"] = admin
    rows = (await client.get(ADMIN)).json()
    assert [r["slot_key"] for r in rows] == list(SLOT_DEFAULTS)
    assert all(r["updated_at"] is None and r["enabled"] is False for r in rows)


async def test_admin_update_cleans_values_and_records_editor(api, admin):
    client, state = api
    state["user"] = admin
    res = await client.put(f"{ADMIN}/MOB_COMMUNITY_INFEED",
                           json=_body(provider="GOOGLE", house_title="  제목  ", house_description="  "))
    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "GOOGLE" and body["house_title"] == "제목" and body["house_description"] is None
    assert body["updated_by"] == "admin@stock.app" and body["updated_at"] is not None
    # 다시 저장해도 행은 하나(수정)
    assert (await client.put(f"{ADMIN}/MOB_COMMUNITY_INFEED", json=_body(enabled=False))).json()["enabled"] is False
    assert sum(r["slot_key"] == "MOB_COMMUNITY_INFEED" for r in (await client.get(ADMIN)).json()) == 1


async def test_admin_unknown_slot_404(api, admin):
    client, state = api
    state["user"] = admin
    res = await client.put(f"{ADMIN}/NOPE", json=_body())
    assert res.status_code == 404 and res.json()["detail"]["code"] == "unknown_slot"


@pytest.mark.parametrize("kw, code", [
    ({"provider": "ADSENSE"}, "invalid_provider"),
    ({"infeed_interval": 3}, "invalid_interval"),
    ({"infeed_interval": 51}, "invalid_interval"),
    ({"house_title": "가" * 121}, "invalid_house"),
    ({"house_description": "가" * 256}, "invalid_house"),
    ({"house_title": None}, "invalid_house"),          # 켠 하우스 배너에 제목 없음
    ({"house_target_path": ""}, "invalid_house"),      # 켠 하우스 배너에 링크 없음
])
async def test_admin_validation(api, admin, kw, code):
    client, state = api
    state["user"] = admin
    res = await client.put(f"{ADMIN}/WEB_HOME_SIDEBAR", json=_body(**kw))
    assert res.status_code == 422 and res.json()["detail"]["code"] == code


@pytest.mark.parametrize("path", ["https://evil.example", "//evil.example", "/\\evil.example", "game",
                                  "javascript:alert(1)", "/a b", "/" + "a" * 255])
async def test_admin_rejects_non_internal_path(api, admin, path):
    client, state = api
    state["user"] = admin
    res = await client.put(f"{ADMIN}/WEB_HOME_SIDEBAR", json=_body(house_target_path=path, enabled=False))
    assert res.status_code == 422 and res.json()["detail"]["code"] == "invalid_house"


@pytest.mark.parametrize("path", ["/", "/game", "/stock/005930?tab=chart"])
async def test_admin_accepts_internal_path(api, admin, path):
    client, state = api
    state["user"] = admin
    assert (await client.put(f"{ADMIN}/WEB_HOME_SIDEBAR", json=_body(house_target_path=path))).status_code == 200


async def test_admin_can_turn_off_house_slot_without_copy(api, admin):
    client, state = api
    state["user"] = admin
    res = await client.put(f"{ADMIN}/WEB_HOME_SIDEBAR", json={"enabled": False})
    assert res.status_code == 200 and res.json()["enabled"] is False


async def test_google_slot_needs_no_house_copy(api, admin):
    client, state = api
    state["user"] = admin
    res = await client.put(f"{ADMIN}/WEB_HOME_SIDEBAR", json={"enabled": True, "provider": "GOOGLE"})
    assert res.status_code == 200


# ── 마이그레이션 ────────────────────────────────────────────────────────────
def _load_migration():
    spec = importlib.util.spec_from_file_location("mig_ad_configs", MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_seeds_match_service_defaults_all_off():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    mod = _load_migration()
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
        insp = sa.inspect(conn)
        assert {c["name"] for c in insp.get_columns("ad_configs")} == {c.name for c in AdConfig.__table__.columns}
        rows = conn.execute(sa.text(
            "SELECT slot_key, enabled, provider, infeed_interval, house_title, house_description, house_target_path "
            "FROM ad_configs")).all()
        seeded = {r[0]: dict(infeed_interval=r[3], house_title=r[4], house_description=r[5], house_target_path=r[6])
                  for r in rows}
        assert seeded == SLOT_DEFAULTS
        assert all(not r[1] and r[2] == "HOUSE" for r in rows)
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
        assert "ad_configs" not in sa.inspect(conn).get_table_names()

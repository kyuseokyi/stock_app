"""앱 업데이트 관리 — SemVer·판별·버전 체크 API·관리자 API(권한·검증)·시드 누락 기본값·마이그레이션."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog.main import app
from apps.blog.services.app_version import (
    DEFAULTS,
    compare_semver,
    decide_update_type,
    parse_semver,
)
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import AppVersionConfig, Base, User, UserRole

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION = VERSIONS_DIR / "f4a5b6c7d8e9_app_version_configs.py"


# ── SemVer ──────────────────────────────────────────────────────────────────
def test_semver_numeric_compare():
    assert compare_semver("1.10.0", "1.9.0") == 1
    assert compare_semver("1.9.0", "1.10.0") == -1
    assert compare_semver("2.0.0", "1.99.99") == 1
    assert compare_semver("1.0.10", "1.0.9") == 1


def test_semver_equal():
    assert compare_semver("1.2.3", "1.2.3") == 0
    assert compare_semver("0.0.0", "0.0.0") == 0


@pytest.mark.parametrize(
    "bad", ["", "1", "1.0", "1.0.0.0", "v1.0.0", "1.0.0-beta", "01.0.0", "1.a.0", " 1.0.0", "1.0.0\n",
            "١.٠.٠", "1." + "0" * 30 + "1.0", None],
)
def test_semver_invalid(bad):
    assert parse_semver(bad) is None


def test_compare_invalid_raises():
    with pytest.raises(ValueError):
        compare_semver("1.0", "1.0.0")


# ── 판별 ────────────────────────────────────────────────────────────────────
def test_decide_force_flag_overrides_versions():
    assert decide_update_type(current="9.9.9", latest="1.0.0", minimum="1.0.0", force=True) == "FORCE"


def test_decide_below_min_is_force():
    assert decide_update_type(current="1.0.0", latest="1.2.0", minimum="1.1.0", force=False) == "FORCE"


def test_decide_below_latest_is_recommended():
    assert decide_update_type(current="1.1.0", latest="1.10.0", minimum="1.1.0", force=False) == "RECOMMENDED"


def test_decide_latest_is_none():
    assert decide_update_type(current="1.10.0", latest="1.10.0", minimum="1.0.0", force=False) == "NONE"
    assert decide_update_type(current="2.0.0", latest="1.10.0", minimum="1.0.0", force=False) == "NONE"


def test_decide_malformed_current_is_none_even_with_force():
    assert decide_update_type(current="abc", latest="2.0.0", minimum="2.0.0", force=True) == "NONE"
    assert decide_update_type(current="", latest="2.0.0", minimum="2.0.0", force=False) == "NONE"


# ── API 픽스처 ──────────────────────────────────────────────────────────────
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
        admin = User(email="admin@stock.app", nickname="관리자", role=UserRole.ADMIN, is_active=True)
        user = User(nickname="일반", role=UserRole.FREE, is_active=True)
        s.add_all([admin, user])
        await s.commit()
        return admin, user


async def _seed_row(maker, platform: str = "android", **kw) -> None:
    values = {**DEFAULTS[platform], **kw}
    async with maker() as s:
        s.add(AppVersionConfig(platform=platform, **values))
        await s.commit()


async def _check(client, platform="android", current="1.0.0"):
    return await client.get("/api/v1/app/version-check", params={"platform": platform, "current_version": current})


def _body(**kw) -> dict:
    return {
        "latest_version": "1.0.1",
        "min_supported_version": "1.0.0",
        "force_update_enabled": False,
        "store_url": "https://play.google.com/store/apps/details?id=com.stockapp",
        "store_title": "최신 버전 출시 안내",
        "store_message": "더 좋아진 StockApp을 만나보세요.",
        "ota_policy": "OPTIONAL",
        "ota_title": "빠른 패치 적용",
        "ota_message": "최신 수정 사항이 다운로드되었습니다. 지금 재시작할까요?",
        "is_maintenance": False,
        "maintenance_message": "",
        **kw,
    }


# ── 공개 버전 체크 ──────────────────────────────────────────────────────────
async def test_version_check_no_auth_needed_and_shape(maker):
    """get_current_user 를 덮지 않고 토큰 없이 호출해도 200."""
    await _seed_row(maker, latest_version="1.1.0", ota_policy="OPTIONAL")

    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            r = await _check(client)
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"maintenance", "store", "ota"}
    assert body["maintenance"] == {"is_active": False, "message": None}
    assert body["store"]["update_type"] == "RECOMMENDED"
    assert set(body["store"]) == {"update_type", "latest_version", "min_supported_version", "title", "message", "store_url"}
    assert body["ota"]["policy"] == "OPTIONAL"
    assert set(body["ota"]) == {"policy", "title", "message"}


async def test_version_check_maintenance_first_still_200(api, maker):
    client, _ = api
    await _seed_row(maker, is_maintenance=True, maintenance_message="10시까지 점검", force_update_enabled=True)
    r = await _check(client)
    assert r.status_code == 200
    body = r.json()
    assert body["maintenance"] == {"is_active": True, "message": "10시까지 점검"}
    assert body["store"]["update_type"] == "FORCE"  # 점검이 우선이지만 스토어·OTA 정보도 함께 준다
    assert body["ota"]["policy"] == "SILENT"


@pytest.mark.parametrize(
    ("current", "expected"),
    [("1.0.0", "FORCE"), ("1.1.0", "RECOMMENDED"), ("1.2.0", "NONE"), ("1.10.0", "NONE")],
)
async def test_version_check_store_types(api, maker, current, expected):
    client, _ = api
    await _seed_row(maker, latest_version="1.2.0", min_supported_version="1.1.0")
    assert (await _check(client, current=current)).json()["store"]["update_type"] == expected


async def test_version_check_force_flag(api, maker):
    client, _ = api
    await _seed_row(maker, force_update_enabled=True)
    assert (await _check(client, current="1.0.0")).json()["store"]["update_type"] == "FORCE"


async def test_version_check_malformed_current_is_none(api, maker):
    client, _ = api
    await _seed_row(maker, latest_version="2.0.0", min_supported_version="2.0.0", is_maintenance=True,
                    ota_policy="MANDATORY")
    for bad in ("garbage", "1.0", ""):
        r = await _check(client, current=bad)
        assert r.status_code == 200
        body = r.json()
        assert body["store"]["update_type"] == "NONE"
        assert body["maintenance"]["is_active"] is True
        assert body["ota"]["policy"] == "MANDATORY"
    # current_version 누락도 NONE
    r = await client.get("/api/v1/app/version-check", params={"platform": "android"})
    assert r.status_code == 200 and r.json()["store"]["update_type"] == "NONE"


async def test_version_check_invalid_platform_422(api):
    client, _ = api
    r = await _check(client, platform="windows")
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "invalid_platform"
    assert (await client.get("/api/v1/app/version-check", params={"current_version": "1.0.0"})).status_code == 422


async def test_version_check_defaults_when_row_missing(api, maker):
    client, _ = api
    r = await _check(client, platform="ios", current="1.0.0")
    assert r.status_code == 200
    body = r.json()
    assert body["store"]["update_type"] == "NONE"
    assert body["store"]["latest_version"] == "1.0.0"
    assert body["store"]["store_url"] == DEFAULTS["ios"]["store_url"]
    assert body["ota"]["policy"] == "SILENT"
    assert body["maintenance"]["is_active"] is False
    async with maker() as s:  # 조회만 — 행을 만들지 않는다
        assert (await s.execute(select(AppVersionConfig))).first() is None


# ── 관리자 ──────────────────────────────────────────────────────────────────
async def test_admin_non_admin_forbidden(api, maker):
    client, state = api
    _, user = await _users(maker)
    state["user"] = user
    assert (await client.get("/api/v1/admin/app-versions")).status_code == 403
    assert (await client.put("/api/v1/admin/app-versions/android", json=_body())).status_code == 403


async def test_admin_no_auth_401(maker):
    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/api/v1/admin/app-versions")).status_code == 401
            assert (await client.put("/api/v1/admin/app-versions/android", json=_body())).status_code == 401
    finally:
        app.dependency_overrides.clear()


async def test_admin_list_returns_both_with_defaults(api, maker):
    client, state = api
    admin, _ = await _users(maker)
    state["user"] = admin
    await _seed_row(maker, "android", latest_version="1.3.0")
    r = await client.get("/api/v1/admin/app-versions")
    assert r.status_code == 200
    items = r.json()
    assert [i["platform"] for i in items] == ["android", "ios"]
    assert items[0]["latest_version"] == "1.3.0" and items[0]["updated_at"] is not None
    assert items[1]["latest_version"] == "1.0.0" and items[1]["updated_at"] is None  # 시드 누락 → 기본값


async def test_admin_put_updates_and_check_reflects(api, maker):
    client, state = api
    admin, _ = await _users(maker)
    state["user"] = admin
    await _seed_row(maker, "android")
    r = await client.put("/api/v1/admin/app-versions/android", json=_body(maintenance_message="  "))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["latest_version"] == "1.0.1" and out["ota_policy"] == "OPTIONAL"
    assert out["updated_by"] == "admin@stock.app" and out["updated_at"]
    assert out["maintenance_message"] is None  # 공백만 → null
    check = (await _check(client, current="1.0.0")).json()
    assert check["store"]["update_type"] == "RECOMMENDED"
    assert check["ota"] == {"policy": "OPTIONAL", "title": "빠른 패치 적용",
                            "message": "최신 수정 사항이 다운로드되었습니다. 지금 재시작할까요?"}


async def test_admin_put_creates_row_when_missing(api, maker):
    client, state = api
    admin, _ = await _users(maker)
    state["user"] = admin
    r = await client.put("/api/v1/admin/app-versions/ios",
                         json=_body(store_url="https://apps.apple.com/app/id123", ota_policy="MANDATORY"))
    assert r.status_code == 200, r.text
    async with maker() as s:
        row = (await s.execute(select(AppVersionConfig))).scalar_one()
    assert row.platform == "ios" and row.ota_policy == "MANDATORY" and row.updated_by == "admin@stock.app"


async def test_admin_put_uses_nickname_when_no_email(api, maker):
    client, state = api
    async with maker() as s:
        admin = User(nickname="운영자", role=UserRole.ADMIN, is_active=True)
        s.add(admin)
        await s.commit()
    state["user"] = admin
    r = await client.put("/api/v1/admin/app-versions/android", json=_body())
    assert r.json()["updated_by"] == "운영자"


@pytest.mark.parametrize(
    ("override", "code"),
    [
        ({"latest_version": "1.0"}, "invalid_latest_version"),
        ({"latest_version": "v1.0.0"}, "invalid_latest_version"),
        ({"min_supported_version": "abc"}, "invalid_min_version"),
        ({"min_supported_version": "1.10.0", "latest_version": "1.9.0"}, "min_greater_than_latest"),
        ({"ota_policy": "FORCE"}, "invalid_ota_policy"),
        ({"ota_policy": "silent"}, "invalid_ota_policy"),
        ({"store_url": "ftp://x"}, "invalid_store_url"),
        ({"store_url": "  "}, "store_url_required"),
        ({"store_title": ""}, "store_title_required"),
        ({"store_message": " "}, "store_message_required"),
        ({"store_title": "가" * 101}, "store_title_too_long"),
    ],
)
async def test_admin_put_validation_422_korean(api, maker, override, code):
    client, state = api
    admin, _ = await _users(maker)
    state["user"] = admin
    r = await client.put("/api/v1/admin/app-versions/android", json=_body(**override))
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["code"] == code
    assert any("가" <= ch <= "힣" for ch in detail["message"])  # 한국어 메시지


async def test_admin_put_min_equal_latest_ok(api, maker):
    client, state = api
    admin, _ = await _users(maker)
    state["user"] = admin
    r = await client.put("/api/v1/admin/app-versions/android",
                         json=_body(latest_version="1.10.0", min_supported_version="1.10.0"))
    assert r.status_code == 200


async def test_admin_put_invalid_platform_422(api, maker):
    client, state = api
    admin, _ = await _users(maker)
    state["user"] = admin
    r = await client.put("/api/v1/admin/app-versions/windows", json=_body())
    assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_platform"


# ── 마이그레이션 ─────────────────────────────────────────────────────────────
def _load_migration():
    spec = importlib.util.spec_from_file_location("mig_app_version_configs", MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _rev_values(text: str, key: str) -> set[str]:
    import re

    m = re.search(rf"^{key}\s*(?::[^=]*)?=\s*(.+)$", text, flags=re.MULTILINE)
    return set(re.findall(r"['\"]([0-9a-f]+)['\"]", m.group(1))) if m else set()


def test_migration_parent_and_no_branch():
    mod = _load_migration()
    assert mod.revision == "f4a5b6c7d8e9" and mod.down_revision == "d2e3f4a5b6c7"
    revisions: set[str] = set()
    parents: set[str] = set()
    for p in VERSIONS_DIR.glob("*.py"):
        text = p.read_text()
        revisions |= _rev_values(text, "revision")
        parents |= _rev_values(text, "down_revision")
    # 이 리비전의 부모를 다른 리비전이 공유하지 않는다(분기 없음)
    siblings = [p.name for p in VERSIONS_DIR.glob("*.py")
                if "d2e3f4a5b6c7" in _rev_values(p.read_text(), "down_revision")]
    assert siblings == [MIGRATION.name]
    # 전체 head 는 하나
    assert len(revisions - parents) == 1


def test_migration_upgrade_seeds_and_downgrade_on_sqlite():
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    mod = _load_migration()
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("app_version_configs")}
        assert cols == {c.name for c in AppVersionConfig.__table__.columns}
        idx = {i["name"]: i for i in insp.get_indexes("app_version_configs")}
        assert idx["ix_app_version_configs_platform"]["unique"]
        rows = conn.execute(sa.text(
            "SELECT platform, latest_version, min_supported_version, force_update_enabled, store_url, "
            "ota_policy, is_maintenance, updated_at FROM app_version_configs ORDER BY platform"
        )).all()
        assert [r[0] for r in rows] == ["android", "ios"]
        for r in rows:
            assert r[1] == "1.0.0" and r[2] == "1.0.0" and not r[3] and r[5] == "SILENT" and not r[6]
            assert r[7] is not None
        assert rows[0][4] == DEFAULTS["android"]["store_url"]
        assert rows[1][4] == DEFAULTS["ios"]["store_url"]
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()
        assert "app_version_configs" not in sa.inspect(conn).get_table_names()


def test_migration_seed_matches_service_defaults():
    mod = _load_migration()
    assert mod._STORE_TITLE == DEFAULTS["android"]["store_title"]
    assert mod._STORE_MESSAGE == DEFAULTS["android"]["store_message"]
    assert mod._OTA_TITLE == DEFAULTS["android"]["ota_title"]
    assert mod._OTA_MESSAGE == DEFAULTS["android"]["ota_message"]
    assert mod._ANDROID_URL == DEFAULTS["android"]["store_url"]
    assert mod._IOS_URL == DEFAULTS["ios"]["store_url"]

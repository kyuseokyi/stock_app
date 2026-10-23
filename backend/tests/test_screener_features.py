"""스크리너 탭 보이기 스위치 — 기본 꺼짐·조회 실패 시 꺼짐·캐시, 관리자 REST(403·404), GraphQL screenerFeatures,
웹·모바일 쿼리 계약(파일의 SCREENER_FEATURES_QUERY 를 그대로 실행)."""
from __future__ import annotations

import asyncio
import pathlib
import re
from datetime import datetime, timezone

import httpx
import pytest

from apps.stock_api.graphql.schema import schema
from apps.stock_api.main import app
from apps.stock_api.services import screener_features as sf
from shared.auth import get_current_user
from shared.market_models import ScreenerFeature
from shared.models import User, UserRole

ROOT = pathlib.Path(__file__).resolve().parents[2]
ADMIN = User(id=1, nickname="관리자", role=UserRole.ADMIN, is_active=True)
FREE = User(id=2, nickname="일반", role=UserRole.FREE, is_active=True)


@pytest.fixture(autouse=True)
def _fresh_cache():
    sf.clear_cache()
    yield
    sf.clear_cache()


def test_missing_rows_are_off():
    assert sf._fill([ScreenerFeature(key="PATTERNS", enabled=True)]) == {"FINDER": False, "PATTERNS": True}


def test_db_failure_hides_everything(monkeypatch):
    def boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(sf, "SyncSessionLocal", boom)
    assert sf.enabled_map() == {"FINDER": False, "PATTERNS": False}


def test_enabled_map_caches(monkeypatch):
    calls = []

    class _Rows:
        def scalars(self):
            return [ScreenerFeature(key="FINDER", enabled=True)]

    class _Session:
        def __enter__(self):
            calls.append(1)
            return self

        def __exit__(self, *a):
            return False

        def execute(self, _stmt):
            return _Rows()

    monkeypatch.setattr(sf, "SyncSessionLocal", _Session)
    assert sf.enabled_map() == {"FINDER": True, "PATTERNS": False}
    assert sf.enabled_map()["FINDER"] is True
    assert len(calls) == 1  # 30초 안 두 번째는 캐시
    sf.clear_cache()
    sf.enabled_map()
    assert len(calls) == 2


@pytest.fixture
async def api():
    state: dict = {}

    async def _user():
        return state["user"]

    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, state
    app.dependency_overrides.clear()


async def test_admin_only(api):
    client, state = api
    state["user"] = FREE
    assert (await client.get("/api/v1/admin/screener/features")).status_code == 403
    assert (await client.put("/api/v1/admin/screener/features/FINDER", json={"enabled": True})).status_code == 403


async def test_list_and_update(api, monkeypatch):
    client, state = api
    state["user"] = ADMIN
    now = datetime(2026, 10, 23, tzinfo=timezone.utc)

    async def fake_list(_db):
        return [ScreenerFeature(key="FINDER", enabled=False, updated_at=None),
                ScreenerFeature(key="PATTERNS", enabled=True, updated_at=now)]

    seen = []

    async def fake_set(_db, key, enabled):
        if key not in sf.KNOWN:
            raise sf.UnknownFeature(key)
        seen.append((key, enabled))
        return ScreenerFeature(key=key, enabled=enabled, updated_at=now)

    monkeypatch.setattr(sf, "list_features", fake_list)
    monkeypatch.setattr(sf, "set_feature", fake_set)
    body = (await client.get("/api/v1/admin/screener/features")).json()
    assert [(f["key"], f["enabled"]) for f in body] == [("FINDER", False), ("PATTERNS", True)]
    r = await client.put("/api/v1/admin/screener/features/FINDER", json={"enabled": True})
    assert r.status_code == 200 and r.json()["enabled"] is True and seen == [("FINDER", True)]
    r = await client.put("/api/v1/admin/screener/features/NOPE", json={"enabled": True})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "FEATURE_NOT_FOUND"


@pytest.mark.parametrize("rel_path", ["web_client/src/api/screenerFeatures.ts", "mobile/src/features/screener/api.ts"])
def test_client_query_contract(monkeypatch, rel_path):
    ts = (ROOT / rel_path).read_text(encoding="utf-8")
    queries = dict(re.findall(r"export const (\w+_QUERY) = `([^`]+)`", ts))
    assert set(queries) == {"SCREENER_FEATURES_QUERY"}, rel_path
    monkeypatch.setattr(sf, "enabled_map", lambda: {"FINDER": True, "PATTERNS": False})
    res = asyncio.run(schema.execute(queries["SCREENER_FEATURES_QUERY"]))
    assert res.errors is None, res.errors
    assert res.data == {"screenerFeatures": {"finder": True, "patterns": False}}

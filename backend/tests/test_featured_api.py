"""GET /api/v1/market/featured — 오늘 특징주(신고저가 + VI). Redis 는 fakeredis(외부 호출 없음)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import fakeredis
import httpx
import pytest

from apps.stock_api.main import app
from apps.stock_api.services import featured_query
from shared import featured_store

KST = timezone(timedelta(hours=9))
TODAY = date(2026, 11, 17)


@pytest.fixture
def fake(monkeypatch):
    r = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(featured_query, "get_sync_redis", lambda: r)
    monkeypatch.setattr(featured_query, "now_kst", lambda: datetime(2026, 11, 17, 10, 0, tzinfo=KST))
    return r


@pytest.fixture
async def client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _high(t, chg):
    return {"ticker": t, "name": f"종목{t}", "market": "KOSPI", "close": 100.0, "change_rate": chg, "high": 101.0,
            "low": 95.0, "prev_high_52w": 100.0, "prev_low_52w": 80.0}


async def test_empty_shape_without_data(client, fake):
    r = await client.get("/api/v1/market/featured")
    assert r.status_code == 200
    assert r.json() == {"date": None, "highs": {"count": 0, "items": []}, "lows": {"count": 0, "items": []},
                        "vi": None}
    assert r.headers["cache-control"] == "public, max-age=30"


async def test_highs_and_vi(client, fake):
    featured_store.save_highs(fake, {"date": "2026-11-16", "eligible": 2000, "computed_at": "x",
                                     "highs": {"count": 25, "items": [_high(f"{i:06d}", 30 - i) for i in range(25)]},
                                     "lows": {"count": 0, "items": []}})
    featured_store.save_vi(fake, TODAY, {"date": "2026-11-17", "updated_at": "2026-11-17T10:00:00+09:00", "count": 1,
                                         "items": [{"ticker": "005930", "name": "삼성전자", "time": "09:15:03",
                                                    "released_at": "09:17:03", "kind": "동적", "direction": "up",
                                                    "price": 67000, "rate": 3.3, "dynamic_rate": 3.3,
                                                    "static_rate": 0.0, "open_rate": 1.0, "count": 2,
                                                    "exchange": "KRX"}]})
    body = (await client.get("/api/v1/market/featured")).json()
    assert body["date"] == "2026-11-16"
    assert body["highs"]["count"] == 25 and len(body["highs"]["items"]) == 20  # 상위 20
    assert body["highs"]["items"][0] == _high("000000", 30)
    assert body["lows"] == {"count": 0, "items": []}
    assert body["vi"]["count"] == 1 and body["vi"]["updated_at"] == "2026-11-17T10:00:00+09:00"
    assert body["vi"]["items"][0]["ticker"] == "005930" and "dynamic_rate" not in body["vi"]["items"][0]


async def test_vi_null_when_only_yesterday_key(client, fake):
    featured_store.save_vi(fake, TODAY - timedelta(days=1), {"date": "2026-11-16", "count": 0, "items": []})
    body = (await client.get("/api/v1/market/featured")).json()
    assert body["vi"] is None


async def test_vi_empty_object_when_polled_but_nothing(client, fake):
    featured_store.save_vi(fake, TODAY, {"date": "2026-11-17", "updated_at": "u", "count": 0, "items": []})
    body = (await client.get("/api/v1/market/featured")).json()
    assert body["vi"] == {"date": "2026-11-17", "updated_at": "u", "count": 0, "items": []}


async def test_broken_snapshot_returns_empty_shape(client, fake):
    fake.set(featured_store.HIGHS_KEY, '{"date": "2026-11-16", "highs": "oops", "lows": {"items": [1, {"x": 1}]}}')
    body = (await client.get("/api/v1/market/featured")).json()
    assert body["highs"] == {"count": 0, "items": []} and body["lows"] == {"count": 0, "items": []}


async def test_redis_down_returns_200_empty(client, monkeypatch):
    class Down:
        def get(self, *a, **k):
            raise ConnectionError("redis down")

    monkeypatch.setattr(featured_query, "get_sync_redis", lambda: Down())
    r = await client.get("/api/v1/market/featured")
    assert r.status_code == 200 and r.json() == featured_query.empty()

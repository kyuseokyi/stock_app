"""공개 랭킹 목록 단기 캐시(board_cache) — TTL 안 재요청은 PG 를 다시 조회하지 않는다."""
from __future__ import annotations

from fakeredis import aioredis as fake_aioredis

from apps.trading_game.services import board_cache, ranking_service
from tests.test_quest_quiz_streak import (  # noqa: F401 — 픽스처 재사용
    _seed_season, api, fake_redis, maker,
)


def _r():
    return fake_aioredis.FakeRedis(decode_responses=True)


async def test_cached_hits_within_ttl_and_rebuilds_after_expiry():
    r = _r()
    calls = []

    async def build():
        calls.append(1)
        return [{"rank": len(calls)}]

    key = board_cache.cache_key("season", 1)
    assert await board_cache.cached(r, key, build) == [{"rank": 1}]
    assert await board_cache.cached(r, key, build) == [{"rank": 1}]  # 캐시
    assert len(calls) == 1
    assert 0 < await r.ttl(key) <= board_cache.BOARD_CACHE_TTL_SEC
    await r.delete(key)  # 만료와 같음
    assert await board_cache.cached(r, key, build) == [{"rank": 2}]


async def test_cached_ttl_zero_disables():
    r = _r()
    calls = []

    async def build():
        calls.append(1)
        return {"n": len(calls)}

    for _ in range(2):
        await board_cache.cached(r, "k", build, ttl=0)
    assert len(calls) == 2 and await r.get("k") is None


async def test_cached_redis_failure_falls_back_to_build():
    class Broken:
        async def get(self, k):
            raise ConnectionError("redis down")

        async def set(self, *a, **kw):
            raise ConnectionError("redis down")

    async def build():
        return {"ok": True}

    assert await board_cache.cached(Broken(), "k", build) == {"ok": True}


async def test_cached_does_not_store_exceptions():
    r = _r()

    async def boom():
        raise LookupError("404")

    try:
        await board_cache.cached(r, "k", boom)
    except LookupError:
        pass
    assert await r.get("k") is None


async def test_leaderboard_route_uses_cache(api, fake_redis, maker, monkeypatch):
    client, _ = api
    async with maker() as db:
        s = await _seed_season(db)
    calls = []

    async def fake_top(redis, db, season_id, limit=100):
        calls.append(season_id)
        return [{"rank": 1, "user_id": 1, "nickname": "가", "roi_pct": 1.0, "total_asset": None, "win_rate": 0.0}]

    monkeypatch.setattr(ranking_service, "top_leaderboard", fake_top)
    first = (await client.get(f"/api/game/seasons/{s.id}/leaderboard")).json()
    second = (await client.get(f"/api/game/seasons/{s.id}/leaderboard")).json()
    assert first == second and calls == [s.id]


async def test_weekly_monthly_404_not_cached(api, fake_redis):
    client, _ = api
    for path in ("weekly-leaderboard", "monthly-leaderboard"):
        assert (await client.get(f"/api/game/seasons/999/{path}")).status_code == 404
    assert await fake_redis.keys("game:cache:board:*") == []

"""GET /api/game/candles — 분봉 조회(CH 조회 함수는 대역)."""
from __future__ import annotations

import httpx
import pytest

from shared.database import get_db
from apps.trading_game.main import app
from apps.trading_game.services import minute_candles_query as q
from tests.test_quest_quiz_streak import _seed_season, maker  # noqa: F401 — 픽스처 재사용


@pytest.fixture
async def anon(maker):
    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


def test_build_sql_bucket_and_range():
    for iv, (mins, days) in {"1m": (1, 2), "5m": (5, 5), "15m": (15, 10), "60m": (60, 30)}.items():
        sql = q.build_sql(iv, "db")
        assert f"toStartOfInterval(ts, INTERVAL {mins} MINUTE)" in sql
        assert f"LIMIT {days}" in sql
        assert "db.game_minute_bars FINAL" in sql
        assert "argMin(open, ts)" in sql and "argMax(close, ts)" in sql
        assert "toUnixTimestamp(b)" in sql and "ORDER BY b" in sql
    with pytest.raises(KeyError):
        q.build_sql("3m")


def test_rows_to_candles_types():
    assert q.rows_to_candles([(1791936000, 1, 2.5, 0.5, 2, 30)]) == [
        {"t": 1791936000, "open": 1.0, "high": 2.5, "low": 0.5, "close": 2.0, "volume": 30}
    ]


def test_fetch_candles_passes_ticker_param():
    seen = {}

    class C:
        def query(self, sql, parameters):
            seen.update(sql=sql, p=parameters)
            return type("R", (), {"result_rows": [(1, 1, 1, 1, 1, 1)]})()

    out = q.fetch_candles("005930", "5m", client=C(), db="x")
    assert seen["p"] == {"t": "005930"} and "INTERVAL 5 MINUTE" in seen["sql"]
    assert out[0]["t"] == 1


async def test_candles_public_returns_active_season_bars(anon, maker, monkeypatch):
    async with maker() as db:
        await _seed_season(db)
    calls = []

    def fake(ticker, interval):
        calls.append((ticker, interval))
        return [{"t": 1791936000, "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 10}]

    monkeypatch.setattr(q, "fetch_candles", fake)
    res = await anon.get("/api/game/candles", params={"interval": "5m"})
    assert res.status_code == 200
    assert res.json() == {"interval": "5m", "ticker": "005930", "candles": [
        {"t": 1791936000, "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 10}]}
    assert calls == [("005930", "5m")]


async def test_candles_empty(anon, maker, monkeypatch):
    async with maker() as db:
        await _seed_season(db)
    monkeypatch.setattr(q, "fetch_candles", lambda t, i: [])
    res = await anon.get("/api/game/candles", params={"interval": "1m"})
    assert res.json() == {"interval": "1m", "ticker": "005930", "candles": []}


async def test_candles_no_active_season(anon, monkeypatch):
    monkeypatch.setattr(q, "fetch_candles", lambda t, i: pytest.fail("조회하면 안 됨"))
    res = await anon.get("/api/game/candles", params={"interval": "60m"})
    assert res.json() == {"interval": "60m", "ticker": None, "candles": []}


@pytest.mark.parametrize("params", [{"interval": "3m"}, {"interval": "day"}, {}])
async def test_candles_bad_interval_422(anon, params):
    res = await anon.get("/api/game/candles", params=params)
    assert res.status_code == 422


async def test_candles_clickhouse_failure_503(anon, maker, monkeypatch):
    async with maker() as db:
        await _seed_season(db)

    def boom(t, i):
        raise ConnectionError("CH down")

    monkeypatch.setattr(q, "fetch_candles", boom)
    res = await anon.get("/api/game/candles", params={"interval": "15m"})
    assert res.status_code == 503


async def test_candles_table_missing_returns_empty(anon, maker, monkeypatch):
    """game_ws 가 테이블을 만들기 전(UNKNOWN_TABLE)은 503 이 아니라 빈 목록."""
    async with maker() as db:
        await _seed_season(db)

    def missing(t, i):
        raise RuntimeError("Code: 60. DB::Exception: Table stock_data.game_minute_bars does not exist. (UNKNOWN_TABLE)")

    monkeypatch.setattr(q, "fetch_candles", missing)
    res = await anon.get("/api/game/candles", params={"interval": "1m"})
    assert res.status_code == 200
    assert res.json()["candles"] == []


async def test_candles_clickhouse_timeout_503(anon, maker, monkeypatch):
    import time

    from apps.trading_game.services import candles_service

    async with maker() as db:
        await _seed_season(db)
    monkeypatch.setattr(candles_service, "QUERY_TIMEOUT_SEC", 0.05)
    monkeypatch.setattr(q, "fetch_candles", lambda t, i: time.sleep(0.3) or [])
    res = await anon.get("/api/game/candles", params={"interval": "5m"})
    assert res.status_code == 503

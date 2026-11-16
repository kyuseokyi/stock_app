"""종목 대차잔고 공개 REST — 응답 모양(오래된 순)·빈 값·장애 시 200·입력 검증. CH 는 가짜(실제 접속 없음)."""
from __future__ import annotations

from datetime import date

import httpx
import pytest

from apps.stock_api.main import app
from apps.stock_api.services import lending_query as lq


class _FakeCH:
    def __init__(self, rows):
        self.rows = rows
        self.queries: list = []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters))
        return type("R", (), {"result_rows": self.rows})()


def _get(path: str) -> httpx.Response:
    import asyncio

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            return await c.get(path)
    return asyncio.run(go())


def test_service_oldest_first_and_query():
    ch = _FakeCH([(date(2026, 11, 13), 98242435, -1482754, 5452455000000),
                  (date(2026, 11, 12), 99725189, -520696, 5564666000000)])
    out = lq.lending_trend("005930", 120, client=ch)
    assert out == [{"date": "2026-11-12", "balance_qty": 99725189, "net_qty": -520696, "balance_amt": 5564666000000},
                   {"date": "2026-11-13", "balance_qty": 98242435, "net_qty": -1482754, "balance_amt": 5452455000000}]
    sql, params = ch.queries[0]
    assert "stock_lending_daily FINAL" in sql and "ORDER BY date DESC LIMIT" in sql
    assert params == {"t": "005930", "n": 120}


def test_service_empty_and_clamp():
    assert lq.lending_trend("005930", 120, client=_FakeCH([])) == []
    assert lq.clamp_days(None) == 120 and lq.clamp_days(0) == 1 and lq.clamp_days(10_000) == lq.MAX_DAYS


def test_api_returns_rows(monkeypatch):
    seen = {}

    def fake(t, days):
        seen.update(t=t, days=days)
        return [{"date": "2026-11-13", "balance_qty": 1, "net_qty": -1, "balance_amt": 1000}]

    monkeypatch.setattr(lq, "lending_trend", fake)
    r = _get("/api/v1/stocks/005930/lending?days=30")
    assert r.status_code == 200 and r.json() == [{"date": "2026-11-13", "balance_qty": 1, "net_qty": -1,
                                                  "balance_amt": 1000}]
    assert seen == {"t": "005930", "days": 30}
    assert "max-age" in r.headers["cache-control"]


def test_api_default_days_and_lowercase_ticker(monkeypatch):
    seen = {}
    monkeypatch.setattr(lq, "lending_trend", lambda t, days: seen.update(t=t, days=days) or [])
    r = _get("/api/v1/stocks/00593a/lending")
    assert r.status_code == 200 and r.json() == [] and seen == {"t": "00593A", "days": 120}


def test_api_ch_failure_is_empty_200(monkeypatch):
    def boom(t, days):
        raise RuntimeError("Table stock_lending_daily doesn't exist")

    monkeypatch.setattr(lq, "lending_trend", boom)
    r = _get("/api/v1/stocks/005930/lending")
    assert r.status_code == 200 and r.json() == []


@pytest.mark.parametrize("path", ["/api/v1/stocks/12345/lending", "/api/v1/stocks/ABC-12/lending"])
def test_api_invalid_ticker_422(monkeypatch, path):
    monkeypatch.setattr(lq, "lending_trend", lambda *a: pytest.fail("검증 실패면 조회하지 않음"))
    r = _get(path)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "INVALID_TICKER"


@pytest.mark.parametrize("days", ["0", "501", "abc"])
def test_api_invalid_days_422(monkeypatch, days):
    monkeypatch.setattr(lq, "lending_trend", lambda *a: pytest.fail("검증 실패면 조회하지 않음"))
    assert _get(f"/api/v1/stocks/005930/lending?days={days}").status_code == 422

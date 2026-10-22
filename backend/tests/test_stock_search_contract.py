"""종목 검색 계약 — 웹 종목 상세(web_client/src/api/stockSearch.ts)의 searchStocks 쿼리를 그대로 꺼내 스키마로 실행해
필드·인자 전달을 확인한다. DB·시드 카탈로그는 monkeypatch(파일이 없으면 skip)."""
import asyncio
import contextlib
import pathlib
import re
from types import SimpleNamespace

import pytest

from apps.stock_api.graphql import schema as schema_mod
from apps.stock_api.graphql.schema import schema

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _client_queries(rel_path: str) -> dict:
    path = ROOT / rel_path
    if not path.exists():
        pytest.skip(f"{rel_path} 아직 없음")
    return dict(re.findall(r"export const (\w+_QUERY) = `([^`]+)`", path.read_text(encoding="utf-8")))


def _stub(monkeypatch) -> dict:
    seen: dict = {}

    def search_active(_db, query):
        seen["query"] = query
        return [SimpleNamespace(ticker="005930", name="삼성전자", market=SimpleNamespace(value="KOSPI"))]

    monkeypatch.setattr(schema_mod.stock_meta_repo, "search_active", search_active)
    monkeypatch.setattr(schema_mod, "SyncSessionLocal", lambda: contextlib.nullcontext(None))
    monkeypatch.setattr(schema_mod, "catalog_search", lambda q: [
        SimpleNamespace(symbol="AAPL", name="Apple", market="NASDAQ", country="US", currency="USD"),
    ])
    return seen


def test_web_stock_search_query_matches_schema(monkeypatch):
    queries = _client_queries("web_client/src/api/stockSearch.ts")
    assert "STOCK_SEARCH_QUERY" in queries
    q = queries["STOCK_SEARCH_QUERY"]
    assert "${" not in q
    seen = _stub(monkeypatch)
    res = asyncio.run(schema.execute(q, variable_values={"query": "삼성"}))
    assert res.errors is None, res.errors
    assert seen == {"query": "삼성"}
    assert res.data["searchStocks"] == [
        {"symbol": "005930", "name": "삼성전자", "market": "KOSPI", "country": "KR"},
        {"symbol": "AAPL", "name": "Apple", "market": "NASDAQ", "country": "US"},
    ]

"""차트 패턴 계약 — 스키마를 서비스 monkeypatch 후 실행해 필드·인자 전달 확인. 웹(web_client/src/api/patterns.ts)·
모바일(mobile/src/features/patterns/api.ts) 쿼리 파일이 있으면 그 쿼리를 그대로 꺼내 실행한다(없으면 skip)."""
import asyncio
import pathlib
import re

import pytest

from apps.stock_api.graphql.schema import schema
from apps.stock_api.services import pattern_query as pq

ROOT = pathlib.Path(__file__).resolve().parents[2]
ITEM = {"ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": "전기·전자", "close": 98.0,
        "pattern_type": "cup_with_handle", "label": "2a", "stage": 2, "pivot": 100.0, "pivot_dist_pct": -2.0,
        "depth": 20.0, "length": 40, "is_active": True, "breakout_date": None, "breakout_price_pct": None,
        "breakout_vol_pct": None, "days_since_breakout": None}
ITEM_FIELDS = {"ticker", "name", "market", "sectorName", "close", "patternType", "label", "stage", "pivot",
               "pivotDistPct", "depth", "length", "isActive", "breakoutDate", "breakoutPricePct", "breakoutVolPct",
               "daysSinceBreakout"}
BASE = {"pattern_type": "cup", "label": "1", "stage": 1, "subcount": 0, "totalcount": 1, "rim_date": "2026-08-03",
        "low_date": "2026-09-01", "low_price": 80.0, "pivot": 100.0, "depth": 20.0, "length": 40, "is_active": False,
        "is_current": True, "breakout_date": "2026-10-13", "breakout_price_pct": 4.0, "breakout_vol_pct": 120.0,
        "days_since_breakout": 3, "prior_uptrend_pct": 55.0, "confidence": 0.8,
        "points": [{"role": "rim", "date": "2026-08-03", "price": 101.0}]}
BASE_FIELDS = {"patternType", "label", "stage", "subcount", "totalcount", "rimDate", "lowDate", "lowPrice", "pivot",
               "depth", "length", "isActive", "isCurrent", "breakoutDate", "breakoutPricePct", "breakoutVolPct",
               "daysSinceBreakout", "priorUptrendPct", "confidence", "points"}
BASES = {"date": "2026-10-16", "ticker": "AAA", "name": "에이", "close": 104.0, "bases": [BASE],
         "zones": {"buy_low": 100.0, "buy_high": 105.0, "stop_low": 92.0, "stop_high": 95.0}}

SCREEN_Q = """query($report: String, $patternType: String, $market: String, $sort: String, $limit: Int, $offset: Int) {
  patternScreen(report: $report, patternType: $patternType, market: $market, sort: $sort, limit: $limit,
                offset: $offset) {
    date total items { ticker name market sectorName close patternType label stage pivot pivotDistPct depth length
      isActive breakoutDate breakoutPricePct breakoutVolPct daysSinceBreakout }
  }
}"""
BASES_Q = """query($ticker: String!) {
  patternBases(ticker: $ticker) {
    date ticker name close
    bases { patternType label stage subcount totalcount rimDate lowDate lowPrice pivot depth length isActive isCurrent
      breakoutDate breakoutPricePct breakoutVolPct daysSinceBreakout priorUptrendPct confidence
      points { role date price } }
    zones { buyLow buyHigh stopLow stopHigh }
  }
}"""
SCREEN_VARS = {"report": "recent_breakouts", "patternType": "htf", "market": "KOSDAQ", "sort": "breakout_vol",
               "limit": 30, "offset": 60}


def _screen_stub(monkeypatch):
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return {"date": "2026-10-16", "total": 1, "items": [ITEM]}

    monkeypatch.setattr(pq, "screen", fake)
    return seen


def _bases_stub(monkeypatch, out=BASES):
    seen = {}

    def fake(ticker):
        seen["ticker"] = ticker
        return out

    monkeypatch.setattr(pq, "bases", fake)
    return seen


def _check_screen(res, seen):
    assert res.errors is None, res.errors
    data = res.data["patternScreen"]
    assert data["date"] == "2026-10-16" and data["total"] == 1
    assert data["items"][0]["pivotDistPct"] == -2.0 and data["items"][0]["breakoutDate"] is None
    assert seen == {"report": "recent_breakouts", "pattern_type": "htf", "market": "KOSDAQ", "sort": "breakout_vol",
                    "limit": 30, "offset": 60}


def test_schema_pattern_screen(monkeypatch):
    seen = _screen_stub(monkeypatch)
    res = asyncio.run(schema.execute(SCREEN_Q, variable_values=SCREEN_VARS))
    _check_screen(res, seen)
    assert set(res.data["patternScreen"]["items"][0]) == ITEM_FIELDS


def test_schema_pattern_screen_defaults(monkeypatch):
    seen = _screen_stub(monkeypatch)
    res = asyncio.run(schema.execute("{ patternScreen { date total items { ticker } } }"))
    assert res.errors is None
    assert seen == {"report": "forming", "pattern_type": None, "market": None, "sort": "pivot_dist", "limit": 50,
                    "offset": 0}


def test_schema_pattern_bases(monkeypatch):
    seen = _bases_stub(monkeypatch)
    res = asyncio.run(schema.execute(BASES_Q, variable_values={"ticker": "AAA"}))
    assert res.errors is None, res.errors
    data = res.data["patternBases"]
    assert seen == {"ticker": "AAA"} and data["close"] == 104.0 and data["name"] == "에이"
    b = data["bases"][0]
    assert set(b) == BASE_FIELDS and b["points"] == [{"role": "rim", "date": "2026-08-03", "price": 101.0}]
    assert b["stage"] == 1 and b["daysSinceBreakout"] == 3 and b["isCurrent"] is True
    assert data["zones"] == {"buyLow": 100.0, "buyHigh": 105.0, "stopLow": 92.0, "stopHigh": 95.0}


def test_schema_pattern_bases_empty(monkeypatch):
    _bases_stub(monkeypatch, {"date": None, "ticker": "ZZZ", "name": "ZZZ", "close": None, "bases": [], "zones": None})
    res = asyncio.run(schema.execute(BASES_Q, variable_values={"ticker": "ZZZ"}))
    assert res.errors is None
    assert res.data["patternBases"] == {"date": None, "ticker": "ZZZ", "name": "ZZZ", "close": None, "bases": [],
                                        "zones": None}


def _client_queries(rel_path: str) -> dict:
    path = ROOT / rel_path
    if not path.exists():
        pytest.skip(f"{rel_path} 아직 없음")
    return dict(re.findall(r"export const (\w+_QUERY) = `([^`]+)`", path.read_text(encoding="utf-8")))


# 클라이언트 쿼리 이름 → (실행 변수, 서비스 stub, 최상위 필드). 있는 것만 실행한다.
def _run_client(monkeypatch, rel_path: str) -> None:
    queries = _client_queries(rel_path)
    assert queries, rel_path
    ran = 0
    for name, q in queries.items():
        assert "${" not in q, (rel_path, name)
        if "patternScreen" in q:
            seen = _screen_stub(monkeypatch)
            res = asyncio.run(schema.execute(q, variable_values=SCREEN_VARS))
            assert res.errors is None, (rel_path, name, res.errors)
            assert seen["pattern_type"] == "htf" and seen["report"] == "recent_breakouts" and seen["offset"] == 60
            ran += 1
        elif "patternBases" in q:
            seen = _bases_stub(monkeypatch)
            res = asyncio.run(schema.execute(q, variable_values={"ticker": "AAA"}))
            assert res.errors is None, (rel_path, name, res.errors)
            assert seen == {"ticker": "AAA"}
            ran += 1
    assert ran, f"{rel_path}: patternScreen·patternBases 쿼리가 없음"


def test_web_pattern_queries_match_schema(monkeypatch):
    _run_client(monkeypatch, "web_client/src/api/patterns.ts")


def test_mobile_pattern_queries_match_schema(monkeypatch):
    _run_client(monkeypatch, "mobile/src/features/patterns/api.ts")

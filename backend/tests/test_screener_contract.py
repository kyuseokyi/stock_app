"""조건검색 계약 — 웹(web_client/src/api/finder.ts)·모바일(mobile/src/features/finder/api.ts) 쿼리를 그대로 꺼내
실제 스키마로 실행한다(프론트↔API). 변수는 toFilterInput 이 만드는 모양(camelCase, 빈 조건 없음)."""
import asyncio
import pathlib
import re

from apps.stock_api.graphql.schema import schema
from apps.stock_api.services import screener_query as sq

ROOT = pathlib.Path(__file__).resolve().parents[2]
ITEM = {"ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": "전기·전자", "close": 1.0, "chg_1d": -2.5,
        "value": 1e9, "mcap": None, "vol_ratio20": 2.1, "rsi14": 28.0, "ma_order": -1, "is_new_high": False,
        "gc_days": 1, "vp_above_pct": 40.0, "per": None, "pbr": 0.8, "roe": -3.0, "bb_position": "BELOW",
        "bb_width_pct": 12.0}
ITEM_FIELDS = {"ticker", "name", "market", "sectorName", "close", "chg1d", "value", "mcap", "volRatio20", "rsi14",
               "maOrder", "isNewHigh", "gcDays", "vpAbovePct", "per", "pbr", "roe", "bbPosition", "bbWidthPct"}
VARIABLES = {
    "preset": "golden_cross",
    "filters": {"market": "KOSDAQ", "liquidOnly": False, "priceMin": 1000, "mcapMin": 500, "rsiMax": 30,
                "maOrder": "PERFECT", "bbPosition": "BELOW", "bbSigma": 2.5, "roeMin": -5},
    "sort": "vol_ratio",
    "limit": 50,
    "offset": 50,
}


def _run(monkeypatch, rel_path: str) -> None:
    ts = (ROOT / rel_path).read_text(encoding="utf-8")
    queries = dict(re.findall(r"export const (\w+_QUERY) = `([^`]+)`", ts))
    assert set(queries) == {"FINDER_QUERY"}, rel_path
    assert "${" not in queries["FINDER_QUERY"]

    seen = {}

    def fake_screen(**kw):
        seen.update(kw)
        return {"date": "2026-10-16", "total": 1, "bb_sigma": 2.5, "items": [ITEM]}

    monkeypatch.setattr(sq, "screen", fake_screen)
    res = asyncio.run(schema.execute(queries["FINDER_QUERY"], variable_values=VARIABLES))
    assert res.errors is None, (rel_path, res.errors)
    data = res.data["screenerScreen"]
    assert data["date"] == "2026-10-16" and data["total"] == 1 and data["bbSigma"] == 2.5
    item = data["items"][0]
    assert set(item) == ITEM_FIELDS
    assert item["chg1d"] == -2.5 and item["gcDays"] == 1 and item["bbPosition"] == "BELOW" and item["mcap"] is None
    assert seen["preset"] == "golden_cross" and seen["sort"] == "vol_ratio"
    assert seen["limit"] == 50 and seen["offset"] == 50
    f = seen["filters"]
    assert f["market"] == "KOSDAQ" and f["liquid_only"] is False and f["price_min"] == 1000 and f["mcap_min"] == 500
    assert f["rsi_max"] == 30 and f["ma_order"] == "PERFECT" and f["bb_position"] == "BELOW" and f["bb_sigma"] == 2.5
    assert f["roe_min"] == -5 and f["per_max"] is None


def test_web_finder_query_matches_schema(monkeypatch):
    _run(monkeypatch, "web_client/src/api/finder.ts")


def test_mobile_finder_query_matches_schema(monkeypatch):
    _run(monkeypatch, "mobile/src/features/finder/api.ts")

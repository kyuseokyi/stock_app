"""getChartData realOnly — 차트 과거 이어 불러오기. 실데이터가 없으면 가짜 캔들 대신 빈 candles(= 더 없음)."""
from __future__ import annotations

import asyncio

import pytest

from apps.stock_api.graphql.schema import schema
from apps.stock_api.services import chart as chart_service
from apps.stock_api.services import clickhouse_source as ch_source
from apps.stock_api.seed_catalog import SeedStock

Q = """query($real: Boolean!) {
  getChartData(symbol: "005930", startDate: "2020-01-01", endDate: "2020-03-31", realOnly: $real) {
    candles { date } ma5 maOrder volumeProfile { volume }
  }
}"""


@pytest.fixture(autouse=True)
def _no_db(monkeypatch):
    # 종목 확인은 stock_meta(PG) 조회 — 테스트는 DB 없이 고정 종목으로
    stock = SeedStock(symbol="005930", name="삼성전자", market="KOSPI", country="KR", currency="KRW")
    monkeypatch.setattr(chart_service, "resolve_stock", lambda _s: stock)


def _run(real: bool):
    res = asyncio.run(schema.execute(Q, variable_values={"real": real}))
    assert res.errors is None, res.errors
    return res.data["getChartData"]


def _candle(d: str) -> chart_service.Candle:
    return chart_service.Candle(date=d, open=100, high=110, low=90, close=105, volume=1000)


def test_no_data_real_only_is_empty(monkeypatch):
    monkeypatch.setattr(ch_source, "get_candles", lambda *a: None)
    data = _run(True)
    assert data == {"candles": [], "ma5": [], "maOrder": "MIXED", "volumeProfile": []}


def test_no_data_default_keeps_fake_fallback(monkeypatch):
    monkeypatch.setattr(ch_source, "get_candles", lambda *a: None)
    assert len(_run(False)["candles"]) > 0  # 기존 화면 동작 그대로(온더플라이 시드)


def test_only_lookback_buffer_real_only_is_empty(monkeypatch):
    # 요청 구간(2020-01~03)엔 없고 앞쪽 지표 버퍼(2019-07~)에만 있음 → 이 구간은 비어 있다
    monkeypatch.setattr(ch_source, "get_candles", lambda *a: [_candle("2019-08-01"), _candle("2019-08-02")])
    assert _run(True)["candles"] == []


def test_real_data_returned_for_display_range(monkeypatch):
    rows = [_candle("2019-12-30"), _candle("2020-01-02"), _candle("2020-01-03")]
    monkeypatch.setattr(ch_source, "get_candles", lambda *a: rows)
    assert [c["date"] for c in _run(True)["candles"]] == ["2020-01-02", "2020-01-03"]


@pytest.mark.parametrize("rel_path", ["web_client/src/api/stock.ts", "mobile/src/features/game/api.ts"])
def test_client_history_query_contract(monkeypatch, rel_path):
    # 웹·모바일 파일의 DAILY_HISTORY_QUERY 를 그대로 실행 — realOnly 인자·필드 이름이 서버와 맞는지
    import pathlib
    import re

    ts = (pathlib.Path(__file__).resolve().parents[2] / rel_path).read_text(encoding="utf-8")
    m = re.search(r"export const DAILY_HISTORY_QUERY = `([^`]+)`", ts)
    assert m, rel_path
    monkeypatch.setattr(ch_source, "get_candles", lambda *a: None)
    res = asyncio.run(schema.execute(
        m.group(1), variable_values={"symbol": "005930", "startDate": "2020-01-01", "endDate": "2020-12-31"},
    ))
    assert res.errors is None, res.errors
    assert res.data == {"getChartData": {"candles": []}}

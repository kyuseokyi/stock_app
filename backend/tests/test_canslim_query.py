"""CANSLIM 조회 — 목록 필터·정렬·표시 문구·점수표·시장 상태·GraphQL 연결(가짜 CH·PG)."""
from datetime import date

import pytest

from apps.stock_api.graphql.schema import schema
from apps.stock_api.services import canslim_query as cq

D = date(2026, 10, 16)
SCREEN_COLS = ["ticker", "market", "sector_m", "close", "score", "pass_count", "liquid",
               "c", "a", "n", "s", "l", "i", "m", "l_rs", "n_pct_from_high"]


class _FakeCH:
    def __init__(self, results):
        self.results, self.queries = list(results), []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters or {}))
        return type("R", (), {"result_rows": self.results.pop(0) if self.results else []})()


@pytest.fixture
def pg(monkeypatch):
    monkeypatch.setattr(cq, "_names", lambda tickers: {"AAA": "에이", "BBB": "비"})
    monkeypatch.setattr(cq, "_sector_names", lambda codes: {"0013": "전기·전자"})


def _screen_row(ticker, score, rs):
    return (ticker, "KOSPI", "0013", 1000.0, score, 5, 1, 1, 1, 1, 1, 1 if rs >= 80 else 0, 1, 1, rs, -3.5)


def test_screen_filters_and_mapping(monkeypatch, pg):
    ch = _FakeCH([[(D,)], [(2,)], [_screen_row("AAA", 95, 91), _screen_row("BBB", 80, 70)]])
    monkeypatch.setattr(cq, "_ch", lambda: ch)
    out = cq.screen(market="KOSPI", min_pass=5, required=["l", "N", "x;drop"], sort="rs", liquid_only=True,
                    limit=500, offset=0)
    assert out["date"] == "2026-10-16" and out["total"] == 2
    a = out["items"][0]
    assert a == {"ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": "전기·전자", "close": 1000.0,
                 "score": 95, "pass_count": 5, "liquid": True,
                 "letters": {"c": 1, "a": 1, "n": 1, "s": 1, "l": 1, "i": 1, "m": 1}, "rs": 91, "pct_from_high": -3.5}
    sql, params = ch.queries[2]
    assert "market = %(market)s" in sql and "pass_count >= %(min_pass)s" in sql and "liquid = 1" in sql
    assert "l = 1" in sql and "n = 1" in sql and "drop" not in sql            # 허용된 항목만
    assert "ORDER BY l_rs DESC" in sql and params["limit"] == 200            # 상한
    assert params["market"] == "KOSPI" and params["d"] == D


def test_screen_all_market_default_sort(monkeypatch, pg):
    ch = _FakeCH([[(D,)], [(0,)], []])
    monkeypatch.setattr(cq, "_ch", lambda: ch)
    out = cq.screen()
    sql = ch.queries[2][0]
    assert "market =" not in sql and "ORDER BY score DESC" in sql and out["items"] == []


def test_screen_no_data_yet(monkeypatch, pg):
    monkeypatch.setattr(cq, "_ch", lambda: _FakeCH([[(date(1970, 1, 1),)]]))
    assert cq.screen() == {"date": None, "total": 0, "items": []}


def _score_row(**kw):
    base = {"date": D, "ticker": "AAA", "market": "KOSPI", "sector_m": "0013", "close": 1000.0, "score": 80,
            "pass_count": 6, "liquid": 1, "c": 1, "a": 1, "n": 1, "s": 1, "l": 0, "i": 1, "m": 1,
            "c_growth": 32.46, "c_quarter": "202606", "c_turnaround": 0, "a_cagr": 30.12, "a_roe": 21.0,
            "n_pct_from_high": -4.21, "n_high_52w": 1050.0, "s_ud_ratio": 1.354, "l_rs": 75, "l_rs_raw": 0.3,
            "sector_rs_rank": 3, "sector_rs_count": 40, "i_net_qty": 12345.0, "i_buy_days": 14,
            "m_dist_days": 2.0, "avg_value_20d": 2e9}
    base.update(kw)
    return base


def test_letter_display_texts():
    row = _score_row()
    shown = {k: cq.letter_display(k, row, "상승 추세") for k in "canslim"}
    assert shown["c"] == "+32.5% (2026년 6월 분기)"
    assert shown["a"] == "연평균 +30.1% · ROE 21.0%"
    assert shown["n"] == "고점 대비 -4.2%"
    assert shown["s"] == "1.35배"
    assert shown["l"] == "RS 75 · 업종 3/40위"
    assert shown["i"] == "+12,345주 · 14/20일 순매수"
    assert shown["m"] == "상승 추세 · 분산일 2일"
    assert cq.letter_display("c", _score_row(c=-2), None) == "실적 형식 확인 중"
    assert cq.letter_display("c", _score_row(c=1, c_growth=None, c_turnaround=1), None) == "흑자 전환 (2026년 6월 분기)"
    assert cq.letter_display("l", _score_row(l=-1, l_rs=None), None) == "데이터 부족"


def test_score_with_history(monkeypatch, pg):
    row = _score_row()
    cols = list(row)
    ch = _FakeCH([[(D,)], [tuple(row[c] for c in cols)], [(D, 80, 6), (date(2026, 10, 15), 70, 5)],
                  [("KOSPI", D, 2600.0, 2500.0, 2400.0, 2, "상승 추세")]])
    monkeypatch.setattr(cq, "_ch", lambda: ch)
    monkeypatch.setattr(cq, "SCORE_COLUMNS", cols)
    out = cq.score("AAA")
    assert out["name"] == "에이" and out["sector_name"] == "전기·전자" and out["score"] == 80
    assert [l["key"] for l in out["letters"]] == list("canslim")
    l_letter = out["letters"][4]
    assert l_letter["status"] == 0 and l_letter["label"] == "주도주" and "RS 80" in l_letter["threshold"]
    assert out["history"] == [{"date": "2026-10-15", "score": 70, "pass_count": 5},
                              {"date": "2026-10-16", "score": 80, "pass_count": 6}]
    assert out["market_status"] == "상승 추세"


def test_score_unknown_ticker(monkeypatch, pg):
    ch = _FakeCH([[(D,)], []])  # 기준일은 있으나 그 종목 행 없음(ETF 등)
    monkeypatch.setattr(cq, "_ch", lambda: ch)
    assert cq.score("069500") is None


def test_markets(monkeypatch):
    ch = _FakeCH([[("KOSDAQ", D, 800.0, 820.0, 850.0, 6, "하락"), ("KOSPI", D, 2600.0, 2500.0, 2400.0, 2, "상승 추세")]])
    monkeypatch.setattr(cq, "_ch", lambda: ch)
    out = cq.markets()
    assert [m["market"] for m in out] == ["KOSPI", "KOSDAQ"]  # KOSPI 먼저
    assert out[0] == {"market": "KOSPI", "date": "2026-10-16", "status": "상승 추세", "close": 2600.0,
                      "ma50": 2500.0, "ma200": 2400.0, "distribution_days": 2}


def test_graphql_wiring(monkeypatch):
    monkeypatch.setattr(cq, "markets", lambda: [{"market": "KOSPI", "date": "2026-10-16", "status": "조정",
                                                 "close": 1.0, "ma50": 1.0, "ma200": 1.0, "distribution_days": 3}])
    monkeypatch.setattr(cq, "screen", lambda **kw: {"date": "2026-10-16", "total": 1, "items": [
        {"ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": None, "close": 1.0, "score": 50,
         "pass_count": 3, "liquid": True, "letters": {k: 1 for k in "canslim"}, "rs": 81, "pct_from_high": -1.0}]})
    monkeypatch.setattr(cq, "score", lambda ticker: None)
    res = schema.execute_sync("""{ canslimMarket { market status distributionDays }
      canslimScreen(market: "KOSPI", minPass: 3, required: ["L"]) { date total items { ticker passCount rs letters { l } } }
      canslimScore(ticker: "X") { ticker } }""")
    assert res.errors is None
    assert res.data["canslimMarket"][0] == {"market": "KOSPI", "status": "조정", "distributionDays": 3}
    assert res.data["canslimScreen"]["items"][0] == {"ticker": "AAA", "passCount": 3, "rs": 81, "letters": {"l": 1}}
    assert res.data["canslimScore"] is None

"""세부 투자자(연기금 등) 수집 — 요청 파라미터·파서·UN→J 폴백·날짜 연속조회·CH 적재·태스크(실제 KIS 호출 없음)."""
from __future__ import annotations

from datetime import date

import pytest
import requests

from apps.collector import investor_detail as idt
from apps.collector.kis.client import TR_INVESTOR_TRADE_DAILY, KISClient, KISConnectionError
from apps.collector.kis.master import MasterStock
from apps.collector.market_parsers import parse_investor_detail
from apps.collector.repositories import clickhouse_market as chm
from apps.collector.tasks import market_data as md


def _row(ymd: str, fund="10", **kw) -> dict:
    base = {"stck_bsop_date": ymd, "fund_ntby_qty": fund, "fund_ntby_tr_pbmn": "3",
            "pe_fund_ntby_vol": "-4", "pe_fund_ntby_tr_pbmn": "-1", "ivtr_ntby_qty": "5", "ivtr_ntby_tr_pbmn": "2",
            "bank_ntby_qty": "6", "bank_ntby_tr_pbmn": "1", "insu_ntby_qty": "-7", "insu_ntby_tr_pbmn": "-2",
            "mrbn_ntby_qty": "8", "mrbn_ntby_tr_pbmn": "1"}
    return {**base, **kw}


# ---------------------------------------------------------------- 클라이언트
def test_request_params_follow_official_example():
    c = KISClient.__new__(KISClient)  # __init__(redis/config) 우회
    c.cfg = type("Cfg", (), {"base_url": "https://kis.test"})()
    calls = []

    def fake(method, url, tr_id, params):
        calls.append((method, url, tr_id, params))
        return {"rt_cd": "0", "output1": {"stck_prpr": "1"}, "output2": [_row("20261113")]}

    c._request_with_retry = fake
    assert c.get_investor_trade_daily("005930", "20261113", market_code="UN") == [_row("20261113")]
    method, url, tr_id, params = calls[0]
    assert method == "get"
    assert url == "https://kis.test/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily"
    assert tr_id == TR_INVESTOR_TRADE_DAILY == "FHPTJ04160001"
    assert params == {"FID_COND_MRKT_DIV_CODE": "UN", "FID_INPUT_ISCD": "005930", "FID_INPUT_DATE_1": "20261113",
                      "FID_ORG_ADJ_PRC": "", "FID_ETC_CLS_CODE": ""}


def test_request_missing_output2_is_empty():
    c = KISClient.__new__(KISClient)
    c.cfg = type("Cfg", (), {"base_url": "https://kis.test"})()
    c._request_with_retry = lambda *a: {"rt_cd": "0", "output1": {}}
    assert c.get_investor_trade_daily("293490", "20261113", market_code="UN") == []


# ---------------------------------------------------------------- 파서
def test_parse_field_mapping_and_sign():
    out = parse_investor_detail([_row("20261113")])
    assert out == [{"date": date(2026, 11, 13), "pension_qty": 10, "pension_amt": 3,
                    "private_eq_qty": -4, "private_eq_amt": -1,  # 사모 수량은 pe_fund_ntby_vol(접미사 _vol)
                    "invtrust_qty": 5, "invtrust_amt": 2, "bank_qty": 6, "bank_amt": 1,
                    "insurance_qty": -7, "insurance_amt": -2, "other_fin_qty": 8, "other_fin_amt": 1}]


def test_parse_blank_values_and_rows():
    rows = [{"stck_bsop_date": "", "fund_ntby_qty": "5"},  # 빈 응답 자리표시 → 버림
            {"stck_bsop_date": "20261112", "fund_ntby_qty": "", "pe_fund_ntby_vol": None, "bank_ntby_qty": "1,234"},
            _row("20261111")]
    out = parse_investor_detail(rows)
    assert [r["date"] for r in out] == [date(2026, 11, 11), date(2026, 11, 12)]  # 날짜 오름차순
    assert out[1]["pension_qty"] == 0 and out[1]["private_eq_qty"] == 0 and out[1]["bank_qty"] == 1234
    assert parse_investor_detail(None) == [] and parse_investor_detail([]) == []


# ---------------------------------------------------------------- UN→J 폴백·연속조회
class _Fake:
    """by_market: {"UN": rows | Exception, "J": ...}. rows 는 KIS 원시 행 — 요청 날짜 이하만 최신→과거로 page 건씩."""

    def __init__(self, by_market, page=100):
        self.by_market, self.page, self.calls = by_market, page, []

    def get_investor_trade_daily(self, ticker, date_yyyymmdd, market_code="UN"):
        self.calls.append((market_code, date_yyyymmdd))
        r = self.by_market.get(market_code, [])
        if isinstance(r, Exception):
            raise r
        rows = sorted((x for x in r if x["stck_bsop_date"] <= date_yyyymmdd), key=lambda x: x["stck_bsop_date"],
                      reverse=True)
        return rows[: self.page]


_DAYS = [f"202611{d:02d}" for d in (2, 3, 4, 5, 6, 9, 10, 11, 12, 13)]


def test_un_present_no_fallback():
    f = _Fake({"UN": [_row("20261113")], "J": [_row("20261113", fund="99")]})
    out = idt.fetch_investor_detail(f, "005930", date(2026, 11, 13))
    assert out[0]["pension_qty"] == 10 and f.calls == [("UN", "20261113")]


def test_un_empty_falls_back_to_j_and_keeps_j_for_paging():
    f = _Fake({"UN": [], "J": [_row(d) for d in _DAYS]}, page=4)
    out = idt.fetch_investor_detail(f, "293490", date(2026, 11, 13), days=10)
    assert [r["date"].strftime("%Y%m%d") for r in out] == _DAYS
    assert f.calls[:2] == [("UN", "20261113"), ("J", "20261113")]
    assert all(m == "J" for m, _ in f.calls[1:])
    assert f.calls[2] == ("J", "20261109")  # 첫 페이지 가장 이른 날(11-10) − 1일


def test_un_http_error_falls_back_to_j():
    f = _Fake({"UN": requests.HTTPError("KIS rt_cd=1"), "J": [_row("20261113")]})
    assert len(idt.fetch_investor_detail(f, "293490", date(2026, 11, 13))) == 1
    assert [m for m, _ in f.calls] == ["UN", "J"]


def test_connection_error_propagates_for_retry():
    f = _Fake({"UN": KISConnectionError("재시도 소진"), "J": [_row("20261113")]})
    with pytest.raises(KISConnectionError):
        idt.fetch_investor_detail(f, "005930", date(2026, 11, 13))


def test_paging_stops_when_no_older_rows_and_at_page_cap(monkeypatch):
    f = _Fake({"UN": [_row(d) for d in _DAYS[-3:]]}, page=2)
    out = idt.fetch_investor_detail(f, "005930", date(2026, 11, 13), days=30)
    assert len(out) == 3 and len(f.calls) == 3  # 2건 → 1건 → 0건에서 멈춤
    monkeypatch.setattr(idt, "MAX_PAGES", 2)
    g = _Fake({"UN": [_row(d) for d in _DAYS]}, page=1)
    assert len(idt.fetch_investor_detail(g, "005930", date(2026, 11, 13), days=30)) == 2 and len(g.calls) == 2


def test_rows_after_end_are_dropped():
    class Leaky(_Fake):
        def get_investor_trade_daily(self, ticker, date_yyyymmdd, market_code="UN"):
            self.calls.append((market_code, date_yyyymmdd))
            return [_row("20261116"), _row("20261113")]

    out = idt.fetch_investor_detail(Leaky({}), "005930", date(2026, 11, 13))
    assert [r["date"] for r in out] == [date(2026, 11, 13)]


def test_to_date():
    assert idt.to_date("20261113", date(2000, 1, 1)) == date(2026, 11, 13)
    assert idt.to_date("2026-11-13", date(2000, 1, 1)) == date(2026, 11, 13)
    assert idt.to_date(None, date(2000, 1, 1)) == date(2000, 1, 1)
    with pytest.raises(ValueError):
        idt.to_date("bad", date(2000, 1, 1))


# ---------------------------------------------------------------- CH
class _FakeCH:
    def __init__(self, rows=None):
        self.commands, self.inserts, self.queries = [], [], []
        self._rows = rows if rows is not None else [[None]]

    def command(self, sql):
        self.commands.append(sql)

    def insert(self, table, rows, column_names):
        self.inserts.append((table, rows, column_names))

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters))
        return type("R", (), {"result_rows": self._rows})()


def test_detail_ddl_replacing_partition_order():
    ch = _FakeCH()
    chm.ensure_market_tables(ch)
    ddl = next(c for c in ch.commands if ".investor_detail_daily" in c)
    assert "CREATE TABLE IF NOT EXISTS" in ddl and "ENGINE = ReplacingMergeTree(ingested_at)" in ddl
    assert "PARTITION BY toYYYYMM(date)" in ddl and "ORDER BY (ticker, date)" in ddl
    assert "ingested_at    DateTime64(3) DEFAULT now64(3)" in ddl
    for col in chm.INVESTOR_DETAIL_COLUMNS:
        assert f"{col}" in ddl
    assert ddl.count("Int64") == 12
    assert any(".investor_daily\n" in c for c in ch.commands)  # 기존 테이블은 그대로


def test_upsert_detail_rows_and_latest_final():
    ch = _FakeCH(rows=[[date(2026, 11, 13)]])
    rec = parse_investor_detail([_row("20261113")])
    assert chm.upsert_investor_detail_daily("005930", rec, client=ch) == 1
    table, rows, cols = ch.inserts[0]
    assert table.endswith(".investor_detail_daily")
    assert cols == ["ticker", "date", *chm.INVESTOR_DETAIL_COLUMNS]
    assert rows == [["005930", date(2026, 11, 13), 10, 3, -4, -1, 5, 2, 6, 1, -7, -2, 8, 1]]
    assert chm.upsert_investor_detail_daily("005930", [], client=ch) == 0 and len(ch.inserts) == 1
    assert chm.latest_investor_detail_date(client=ch) == date(2026, 11, 13)
    assert "investor_detail_daily FINAL" in ch.queries[0][0]
    assert chm.latest_investor_detail_date(client=_FakeCH(rows=[[date(1970, 1, 1)]])) is None


# ---------------------------------------------------------------- 태스크
@pytest.fixture
def task_env(monkeypatch):
    seen: dict = {}
    monkeypatch.setattr(md.chm, "ensure_market_tables", lambda: None)
    monkeypatch.setattr(md, "_analysis_tickers", lambda: [MasterStock("005930", "삼성전자", "KOSPI")])

    def fake_run(collect_one, limit, source, rate, workers=None, tickers=None):
        seen["tickers"] = [t.ticker for t in tickers]
        seen["collect_one"] = collect_one
        return {"ok": 1, "total": 1}

    monkeypatch.setattr(md, "_run_universe", fake_run)
    return seen


@pytest.mark.parametrize("latest, days", [(None, md.DETAIL_BACKFILL_DAYS), (date(2026, 11, 12), md.DETAIL_DAILY_DAYS)])
def test_collect_first_run_backfills(task_env, monkeypatch, latest, days):
    monkeypatch.setattr(md.chm, "latest_investor_detail_date", lambda: latest)
    out = md.collect_investor_detail_daily(end="20261113")
    assert out == {"ok": 1, "total": 1, "days": days, "end": "2026-11-13"}
    assert task_env["tickers"] == ["005930"]  # investor 단계와 같은 분석 대상(보통주)


def test_collect_one_saves_fetched_rows(task_env, monkeypatch):
    monkeypatch.setattr(md.chm, "latest_investor_detail_date", lambda: pytest.fail("days 를 주면 조회하지 않음"))
    saved = {}
    monkeypatch.setattr(md.chm, "upsert_investor_detail_daily", lambda t, rows: saved.setdefault(t, rows) and len(rows))
    md.backfill_investor_detail(days=10, end="2026-11-13")
    f = _Fake({"UN": [], "J": [_row(d) for d in _DAYS]}, page=5)
    assert task_env["collect_one"]("293490", f) == 10
    assert len(saved["293490"]) == 10 and f.calls[1] == ("J", "20261113")

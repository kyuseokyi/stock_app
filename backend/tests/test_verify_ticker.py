"""관리자 데이터 검증 — 입력 검증·404, 날짜 결정, 응답 형태, 섹션 실패 격리, 테이블 없음, PG 실패, 링크(가짜 CH·PG)."""
from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from apps.stock_api.services import verify_ticker as vt
from shared.clickhouse_schema import CLICKHOUSE_DB as DB

D = date(2026, 10, 16)
T = "005930"
MISSING = RuntimeError("Code: 60. DB::Exception: Unknown table expression identifier "
                       "'stock_data.canslim_daily' in scope SELECT ... (UNKNOWN_TABLE)")
INFO = {"name": "삼성전자", "market": "KOSPI", "is_active": True, "sector_code": "0013",
        "sector_name": "전기·전자", "listed_shares_k": 5969783, "is_halted": False}
CANSLIM_ROW = [65, 4, 1, 1, 0, 1, -1, 1, 1, -2, 32.5, "202606", 0, 12.0, 9.1, -3.2, 72800.0, 1.3, 88, 1.21,
               3, 40, 1500000.0, 6, 3.0, 9e11]
FUND = ([["Q", ym, 1000.0, 50000.0, None, 9.0, None, None, None, 26.0]
         for ym in ("202606", "202603", "202512", "202509", "202506", "202503", "202412", "202409", "202406")]
        + [["Y", f"{y}12", 4000.0, 50000.0, None, 9.0, None, None, None, 26.0] for y in range(2025, 2019, -1)])


class _CH:
    """SQL 에 들어 있는 문자열로 결과를 고른다(먼저 맞는 것). 값이 예외면 던진다. 보낸 쿼리를 기록한다."""

    def __init__(self, routes):
        self.routes, self.queries = routes, []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters or {}))
        for key, rows in self.routes:
            if key in sql:
                if isinstance(rows, Exception):
                    raise rows
                return SimpleNamespace(result_rows=rows)
        return SimpleNamespace(result_rows=[])


def _routes(**over):
    base = {
        "latest": (f"max(date) FROM {DB}.daily_prices WHERE ticker", [[D]]),
        "bars": (f"FROM {DB}.daily_prices FINAL",
                 [[D - timedelta(days=i), 70000.0, 71000.0, 69500.0, 70500.0, 1000 + i] for i in range(5)]),
        "computed": (f"FROM {DB}.market_stock_daily", [[70500.0, 0.71, 2.1, None, 8.7e11, 4.2e14, "0013"]]),
        "investor": (f"FROM {DB}.investor_daily", [[-1000, 800, 200, -70, 56, 14]]),
        "fund": (f"FROM {DB}.fundamentals_periodic", FUND),
        "canslim": (f"FROM {DB}.canslim_daily", [CANSLIM_ROW]),
        "groups": (f"FROM {DB}.market_group_daily",
                   [["sector", "0013", "전기·전자", 4, 0.9, 120], ["theme", "9", "다른 이름", 1, 3.0, 10]]),
    }
    base.update(over)
    return list(base.values())


@pytest.fixture
def env(monkeypatch):
    holder = {"ch": _CH(_routes())}
    monkeypatch.setattr(vt, "_ch", lambda: holder["ch"])
    monkeypatch.setattr(vt, "_stock_info", lambda t: dict(INFO))
    monkeypatch.setattr(vt, "_theme_memberships", lambda t: [("7", "반도체"), ("9", "HBM")])

    def use(**over):
        holder["ch"] = _CH(_routes(**over))
        return holder["ch"]

    return SimpleNamespace(use=use, holder=holder)


@pytest.mark.parametrize("raw", ["", "12345", "1234567", "00593!", " 0059 30"])
def test_invalid_ticker(raw):
    with pytest.raises(vt.InvalidTicker):
        vt.normalize_ticker(raw)


def test_ticker_is_trimmed_and_uppercased():
    assert vt.normalize_ticker(" 0001a0 ") == "0001A0"


@pytest.mark.parametrize("raw", ["2026-13-01", "20261016", "어제"])
def test_invalid_date(env, raw):
    with pytest.raises(vt.InvalidDate):
        vt.build(T, raw)


def test_full_report_shape(env):
    out = vt.build(T, None)
    assert list(out) == ["ticker", "date", "requested_date", "profile", "bars", "computed", "investor",
                         "fundamentals", "canslim", "memberships", "links", "notes"]
    assert out["ticker"] == T and out["date"] == "2026-10-16" and out["requested_date"] is None
    assert out["profile"] == INFO
    assert [b["date"] for b in out["bars"]] == ["2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"]
    assert out["bars"][0] == {"date": "2026-10-16", "open": 70000.0, "high": 71000.0, "low": 69500.0,
                              "close": 70500.0, "volume": 1000}
    assert out["computed"] == {"close": 70500.0, "chg_1d": 0.71, "chg_5d": 2.1, "chg_20d": None, "value": 8.7e11,
                               "mcap": 4.2e14, "sector_m": "0013"}
    assert out["investor"] == {"prsn_qty": -1000, "frgn_qty": 800, "orgn_qty": 200,
                               "prsn_amt": -70, "frgn_amt": 56, "orgn_amt": 14}
    f = out["fundamentals"]
    assert len(f["quarterly"]) == vt.QUARTERS and len(f["annual"]) == vt.YEARS
    assert f["quarterly"][0] == {"stac_yymm": "202606", "eps": 1000.0, "bps": 50000.0, "sps": None, "roe": 9.0,
                                 "sales_growth": None, "op_growth": None, "ni_growth": None, "debt_ratio": 26.0}
    assert f["annual"][0]["stac_yymm"] == "202512" and f["annual"][-1]["stac_yymm"] == "202112"
    assert list(out["canslim"]) == list(vt.CANSLIM_COLS)
    assert out["canslim"]["score"] == 65 and out["canslim"]["m"] == -2 and out["canslim"]["c_quarter"] == "202606"
    assert out["memberships"] == [
        {"kind": "sector", "group_id": "0013", "name": "전기·전자", "rank": 4, "chg_1d": 0.9, "members": 120},
        {"kind": "theme", "group_id": "7", "name": "반도체", "rank": None, "chg_1d": None, "members": None},
        {"kind": "theme", "group_id": "9", "name": "HBM", "rank": 1, "chg_1d": 3.0, "members": 10}]
    assert len(out["links"]) == 5 and out["notes"] == {}


def test_explicit_date_and_queries_filter_ticker_with_final(env):
    out = vt.build(T, "2026-10-15")
    assert out["date"] == out["requested_date"] == "2026-10-15"
    queries = env.holder["ch"].queries
    assert not any("max(date)" in s for s, _ in queries)  # 날짜를 주면 최신일을 조회하지 않는다
    for sql, params in queries:
        assert "FINAL" in sql
        if "market_group_daily" in sql:
            assert "members > 0" in sql and params["ids"] == ["0013", "7", "9"]
        else:
            assert params["t"] == T
        if "d" in params:
            assert params["d"] == date(2026, 10, 15)


def test_not_found_when_no_meta_and_no_bars(env, monkeypatch):
    monkeypatch.setattr(vt, "_stock_info", lambda t: None)
    env.use(latest=(f"max(date) FROM {DB}.daily_prices WHERE ticker", [[date(1970, 1, 1)]]))
    with pytest.raises(vt.StockNotFound):
        vt.build("999999", None)


def test_section_failure_is_isolated(env):
    env.use(investor=(f"FROM {DB}.investor_daily", RuntimeError("timeout")))
    out = vt.build(T, None)
    assert out["investor"] is None and out["notes"] == {"investor": vt.FAILED}
    assert out["bars"] and out["computed"] and out["canslim"] and out["memberships"]


def test_missing_tables_are_empty_with_note(env):
    env.use(canslim=(f"FROM {DB}.canslim_daily", MISSING),
            fund=(f"FROM {DB}.fundamentals_periodic", MISSING),
            groups=(f"FROM {DB}.market_group_daily", MISSING))
    out = vt.build(T, None)
    assert out["canslim"] is None and out["fundamentals"] == {"quarterly": [], "annual": []}
    assert [m["rank"] for m in out["memberships"]] == [None, None, None]  # 소속은 보이고 지표만 비어 있다
    assert out["notes"] == {"canslim": vt.TABLE_MISSING, "fundamentals": vt.TABLE_MISSING,
                            "memberships": vt.TABLE_MISSING}


def test_pg_failures_are_isolated(env, monkeypatch):
    def boom(t):
        raise RuntimeError("pg down")

    monkeypatch.setattr(vt, "_stock_info", boom)
    monkeypatch.setattr(vt, "_theme_memberships", boom)
    out = vt.build(T, None)
    assert out["profile"] is None and out["memberships"] is None
    assert out["notes"] == {"profile": vt.FAILED, "memberships": vt.FAILED}
    assert out["bars"] and len(out["links"]) == 4  # 이름을 몰라 DART 링크는 뺀다


def test_known_stock_without_bars(env):
    env.use(latest=(f"max(date) FROM {DB}.daily_prices WHERE ticker", [[date(1970, 1, 1)]]))
    out = vt.build(T, None)
    assert out["date"] is None
    assert out["bars"] is None and out["computed"] is None and out["canslim"] is None and out["memberships"] is None
    assert out["notes"] == {"date": vt.NO_BARS}
    assert out["fundamentals"]["quarterly"]  # 날짜와 무관한 재무는 보인다


def test_links():
    links = vt.links("005930", "삼성 전자&우")
    assert [l["label"] for l in links] == ["네이버 종목", "네이버 일별시세", "네이버 투자자별 매매", "FnGuide", "DART 공시"]
    assert links[0]["url"] == "https://finance.naver.com/item/main.naver?code=005930"
    assert links[1]["url"] == "https://finance.naver.com/item/sise_day.naver?code=005930"
    assert links[2]["url"] == "https://finance.naver.com/item/frgn.naver?code=005930"
    assert links[3]["url"] == "https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?gicode=A005930"
    assert links[4]["url"] == ("https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm="
                               "%EC%82%BC%EC%84%B1%20%EC%A0%84%EC%9E%90%26%EC%9A%B0")
    assert len(vt.links("005930", None)) == 4


def test_non_finite_floats_become_none(env):
    nan, inf = float("nan"), float("inf")
    row = list(CANSLIM_ROW)
    row[10], row[25] = nan, inf
    env.use(computed=(f"FROM {DB}.market_stock_daily", [[70500.0, nan, inf, None, 8.7e11, -inf, "0013"]]),
            investor=(f"FROM {DB}.investor_daily", [[nan, 800, 200, -70, 56, 14]]),
            fund=(f"FROM {DB}.fundamentals_periodic", [["Q", "202606", nan, 1.0, None, inf, None, None, None, 2.0]]),
            canslim=(f"FROM {DB}.canslim_daily", [row]),
            groups=(f"FROM {DB}.market_group_daily", [["sector", "0013", "x", 4, nan, 120]]))
    out = vt.build(T, None)
    assert out["computed"]["chg_1d"] is None and out["computed"]["chg_5d"] is None and out["computed"]["mcap"] is None
    assert out["investor"]["prsn_qty"] is None and out["investor"]["frgn_qty"] == 800
    assert out["fundamentals"]["quarterly"][0]["eps"] is None and out["fundamentals"]["quarterly"][0]["roe"] is None
    assert out["canslim"]["c_growth"] is None and out["canslim"]["avg_value_20d"] is None
    assert out["memberships"][0]["chg_1d"] is None
    import json
    json.dumps(out, allow_nan=False)
    assert out["notes"] == {}


def test_theme_failure_keeps_sector(env, monkeypatch):
    def boom(t):
        raise RuntimeError("pg down")

    monkeypatch.setattr(vt, "_theme_memberships", boom)
    out = vt.build(T, None)
    assert [m["kind"] for m in out["memberships"]] == ["sector"] and out["memberships"][0]["rank"] == 4
    assert out["notes"] == {"memberships": vt.THEME_FAILED}


def test_explicit_date_before_first_bar_is_not_404(env, monkeypatch):
    monkeypatch.setattr(vt, "_stock_info", lambda t: None)
    env.use(bars=(f"FROM {DB}.daily_prices FINAL", []))  # 그 날짜 이전 일봉 없음, 최신 일봉은 있음
    out = vt.build("999999", "2000-01-03")
    assert out["bars"] == [] and out["profile"] is None


def test_explicit_date_without_any_bars_is_404(env, monkeypatch):
    monkeypatch.setattr(vt, "_stock_info", lambda t: None)
    env.use(latest=(f"max(date) FROM {DB}.daily_prices WHERE ticker", [[date(1970, 1, 1)]]),
            bars=(f"FROM {DB}.daily_prices FINAL", []))
    with pytest.raises(vt.StockNotFound):
        vt.build("999999", "2026-10-15")


def test_dart_link_encodes_korean_name():
    from urllib.parse import quote
    url = vt.links("005930", "삼성전자")[-1]["url"]
    assert url.endswith(quote("삼성전자")) and "삼성" not in url

"""스크리너 조건검색 조회 — 프리셋·필터 WHERE, 화이트리스트, 범위 검증, 볼린저, 페이징·이름, GraphQL 연결(가짜 CH·PG)."""
from datetime import date

import pytest
from clickhouse_connect.driver.exceptions import DatabaseError, OperationalError

from apps.stock_api.graphql.schema import schema
from apps.stock_api.services import screener_query as sq

D = date(2026, 10, 16)


class _FakeCH:
    def __init__(self, results):
        self.results, self.queries = list(results), []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters or {}))
        return type("R", (), {"result_rows": self.results.pop(0) if self.results else []})()


@pytest.fixture
def ch(monkeypatch):
    holder = {}

    def use(results=None):
        holder["ch"] = _FakeCH([[(D,)], [(0,)], []] if results is None else results)
        monkeypatch.setattr(sq, "_ch", lambda: holder["ch"])
        return holder["ch"]

    monkeypatch.setattr(sq, "_names", lambda tickers: {"AAA": "에이"})
    monkeypatch.setattr(sq, "_sector_names", lambda codes: {"0013": "전기·전자"})
    return use


def test_no_data_yet(ch, monkeypatch):
    ch([[(date(1970, 1, 1),)]])
    assert sq.screen() == {"date": None, "total": 0, "bb_sigma": 2.0, "items": []}

    class Boom:
        def query(self, sql, parameters=None):
            raise DatabaseError("Code: 60. DB::Exception: Table x.screener_daily does not exist. (UNKNOWN_TABLE)",
                                code=60, name="UNKNOWN_TABLE")  # 첫 계산 전(테이블 없음)

    monkeypatch.setattr(sq, "_ch", lambda: Boom())
    assert sq.screen(filters={"bb_sigma": 3}) == {"date": None, "total": 0, "bb_sigma": 3.0, "items": []}


def test_latest_date_missing_table_variants(monkeypatch):
    for exc in (DatabaseError("x", code=60), DatabaseError("x", name="UNKNOWN_TABLE"),
                RuntimeError("Code: 60. (UNKNOWN_TABLE)")):
        def boom(sql, params=None, _e=exc):
            raise _e

        monkeypatch.setattr(sq, "_query", boom)
        assert sq.latest_date() is None


def test_latest_date_other_errors_raise(monkeypatch, caplog):
    for exc in (OperationalError("Error executing HTTP request attempt 1"), TimeoutError("timeout"),
                DatabaseError("Code: 241 memory limit", code=241, name="MEMORY_LIMIT_EXCEEDED")):
        def boom(sql, params=None, _e=exc):
            raise _e

        monkeypatch.setattr(sq, "_query", boom)
        with pytest.raises(type(exc)):
            sq.latest_date()
    assert "최신 기준일 조회 실패" in caplog.text


@pytest.mark.parametrize("preset, cond", [
    ("volume_surge", "vol_ratio20 >= 2.0"),
    ("golden_cross", "gc_days IS NOT NULL"),
    ("oversold", "rsi14 <= 30.0"),
    ("new_high", "is_new_high = 1"),
])
def test_preset_adds_condition(ch, preset, cond):
    fake = ch()
    sq.screen(preset=preset)
    assert cond in fake.queries[1][0] and cond in fake.queries[2][0]   # count·목록 둘 다


def test_unknown_preset_and_sort_ignored(ch):
    fake = ch()
    sq.screen(preset="x; DROP TABLE t", sort="ticker; --")
    count_sql, rows_sql = fake.queries[1][0], fake.queries[2][0]
    assert count_sql.endswith("WHERE date = %(d)s AND liquid = 1")
    assert "DROP" not in rows_sql and "ORDER BY value DESC, ticker" in rows_sql


def test_filters_bound_as_params(ch):
    fake = ch()
    sq.screen(filters={"market": "KOSDAQ", "price_min": 1000, "price_max": 50000, "mcap_min": 500, "value_min": 10,
                       "vol_ratio_min": 1.5, "rsi_min": 20, "rsi_max": 40, "ma_order": "PERFECT", "roe_min": -5,
                       "sales_growth_min": -10, "per_max": 15, "pbr_max": 1.2, "debt_ratio_max": 100,
                       "vp_above_max": 30}, sort="vp_above")
    sql, params = fake.queries[2]
    for frag in ("market = %(market)s", "liquid = 1", "close >= %(price_min)s", "close <= %(price_max)s",
                 "mcap >= %(mcap_min)s", "value >= %(value_min)s", "vol_ratio20 >= %(vol_ratio_min)s",
                 "rsi14 >= %(rsi_min)s", "rsi14 <= %(rsi_max)s", "ma_order = %(ma_order)s", "roe >= %(roe_min)s",
                 "sales_growth >= %(sales_growth_min)s", "per <= %(per_max)s", "pbr <= %(pbr_max)s",
                 "debt_ratio <= %(debt_ratio_max)s", "vp_above_pct <= %(vp_above_max)s"):
        assert frag in sql, frag
    assert params["market"] == "KOSDAQ" and params["ma_order"] == 1
    assert params["mcap_min"] == 500 * 1e8 and params["value_min"] == 10 * 1e8   # 억 원 → 원
    assert params["price_min"] == 1000.0 and params["roe_min"] == -5.0 and params["sales_growth_min"] == -10.0
    assert "ORDER BY vp_above_pct ASC NULLS LAST" in sql
    assert "KOSDAQ" not in sql and "1000" not in sql                            # 사용자 값은 바인딩만


def test_invalid_ranges_ignored(ch):
    fake = ch()
    sq.screen(filters={"price_min": -1, "rsi_min": 60, "rsi_max": 40, "per_min": float("nan"), "mcap_max": True,
                       "ma_order": "SIDEWAYS", "market": "NYSE", "debt_ratio_max": "abc", "bb_position": "LEFT"})
    sql, params = fake.queries[1]
    assert sql.endswith("WHERE date = %(d)s AND liquid = 1")
    assert set(params) == {"d", "limit", "offset"}


def test_liquid_only_false(ch):
    fake = ch()
    sq.screen(filters={"liquid_only": False})
    assert "liquid" not in fake.queries[1][0]


def test_bollinger_filters(ch):
    fake = ch()
    out = sq.screen(filters={"bb_sigma": 2.5, "bb_position": "ABOVE", "bb_width_max": 10})
    sql, params = fake.queries[2]
    assert "close > ma20 + %(bb_k)s * std20" in sql
    assert "ma20 > 0 AND 2 * %(bb_k)s * std20 * 100 / ma20 <= %(bb_width_max)s" in sql
    assert params["bb_k"] == 2.5 and params["bb_width_max"] == 10.0 and out["bb_sigma"] == 2.5

    fake = ch()
    out = sq.screen(filters={"bb_sigma": 7, "bb_position": "INSIDE"})   # 목록 밖 σ → 2
    sql, params = fake.queries[2]
    assert "close BETWEEN ma20 - %(bb_k)s * std20 AND ma20 + %(bb_k)s * std20" in sql
    assert params["bb_k"] == 2.0 and out["bb_sigma"] == 2.0

    fake = ch()
    sq.screen(filters={"bb_position": "BELOW"})
    assert "close < ma20 - %(bb_k)s * std20" in fake.queries[2][0]


def test_items_mapping_and_paging(ch):
    rows = [("AAA", "KOSPI", "0013", 10500.0, 3.2, 5e9, 1e12, 2.4, 55.0, 10000.0, 200.0, 1, 1, 0, 12.5, 9.5, 1.1, 14.0),
            ("BBB", "KOSDAQ", "", 900.0, None, 1e8, None, None, None, None, None, 0, 0, None, None, None, None, None)]
    fake = ch([[(D,)], [(2,)], rows])
    out = sq.screen(limit=500, offset=-3)
    assert out["date"] == "2026-10-16" and out["total"] == 2 and out["bb_sigma"] == 2.0
    assert out["items"][0] == {
        "ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": "전기·전자", "close": 10500.0, "chg_1d": 3.2,
        "value": 5e9, "mcap": 1e12, "vol_ratio20": 2.4, "rsi14": 55.0, "ma_order": 1, "is_new_high": True,
        "gc_days": 0, "vp_above_pct": 12.5, "per": 9.5, "pbr": 1.1, "roe": 14.0,
        "bb_position": "ABOVE", "bb_width_pct": 8.0}
    b = out["items"][1]
    assert b["name"] == "BBB" and b["sector_name"] is None and b["is_new_high"] is False
    assert b["bb_position"] is None and b["bb_width_pct"] is None
    sql, params = fake.queries[2]
    assert params["limit"] == 200 and params["offset"] == 0                    # 상한·음수 보정
    assert "screener_daily FINAL" in sql and "ORDER BY value DESC, ticker" in sql
    assert params["d"] == D


def test_bb_helpers():
    assert sq.bb_position(10500.0, 10000.0, 200.0, 2.0) == "ABOVE"
    assert sq.bb_position(9500.0, 10000.0, 200.0, 2.0) == "BELOW"
    assert sq.bb_position(10400.0, 10000.0, 200.0, 2.0) == "INSIDE"            # 경계값은 밴드 안
    assert sq.bb_position(1.0, None, 1.0, 2.0) is None
    assert sq.bb_width_pct(10000.0, 200.0, 2.0) == 8.0
    assert sq.bb_width_pct(0.0, 1.0, 2.0) is None and sq.bb_width_pct(None, 1.0, 2.0) is None


ITEM = {"ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": "전기·전자", "close": 1.0, "chg_1d": -2.5,
        "value": 1e9, "mcap": None, "vol_ratio20": 2.1, "rsi14": 28.0, "ma_order": -1, "is_new_high": False,
        "gc_days": None, "vp_above_pct": 40.0, "per": None, "pbr": 0.8, "roe": -3.0, "bb_position": "BELOW",
        "bb_width_pct": 12.0}


def test_graphql_wiring(monkeypatch):
    seen = []

    def fake_screen(**kw):
        seen.append(kw)
        return {"date": "2026-10-16", "total": 1, "bb_sigma": 1.5, "items": [ITEM]}

    monkeypatch.setattr(sq, "screen", fake_screen)
    q = """query($f: ScreenerFilterInput) { screenerScreen(preset: "oversold", filters: $f) {
      date total bbSigma
      items { ticker chg1d volRatio20 rsi14 isNewHigh gcDays vpAbovePct bbPosition bbWidthPct maOrder sectorName } } }"""
    res = schema.execute_sync(q, variable_values={"f": {"market": "KOSPI", "priceMin": 1000, "bbSigma": 1.5,
                                                         "bbPosition": "BELOW", "liquidOnly": False}})
    assert res.errors is None, res.errors
    kw = seen[0]
    assert kw["preset"] == "oversold" and kw["sort"] == "value" and kw["limit"] == 50 and kw["offset"] == 0
    f = kw["filters"]
    assert f["market"] == "KOSPI" and f["price_min"] == 1000 and f["bb_sigma"] == 1.5 and f["bb_position"] == "BELOW"
    assert f["liquid_only"] is False and f["rsi_max"] is None
    data = res.data["screenerScreen"]
    assert data["bbSigma"] == 1.5 and data["total"] == 1
    assert data["items"][0] == {"ticker": "AAA", "chg1d": -2.5, "volRatio20": 2.1, "rsi14": 28.0, "isNewHigh": False,
                                "gcDays": None, "vpAbovePct": 40.0, "bbPosition": "BELOW", "bbWidthPct": 12.0,
                                "maOrder": -1, "sectorName": "전기·전자"}

    res = schema.execute_sync("{ screenerScreen { total } }")
    assert res.errors is None
    assert seen[1]["filters"] == {} and seen[1]["preset"] is None              # 필터 없음 = 빈 사전(거래 활발 기본 켬)

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
    ("foreign_buy_5d", "frgn_buy_days >= 5"),
    ("double_buy_new_high", "is_new_high = 1 AND frgn_buy_days >= 1 AND orgn_buy_days >= 1"),
    ("pension_buy_10d", "pension_buy_days >= 10"),
    ("lending_drop", "lending_chg5 <= -20"),
    ("ma5_20", "ma5 IS NOT NULL AND ma20 IS NOT NULL AND round(ma5, 2) > round(ma20, 2)"),
])
def test_preset_adds_condition(ch, preset, cond):
    fake = ch()
    sq.screen(preset=preset)
    assert cond in fake.queries[1][0] and cond in fake.queries[2][0]   # count·목록 둘 다


def test_flow_preset_before_first_compute_is_empty_not_error(ch, monkeypatch):
    fake = ch([[(D,)]])
    query = fake.query

    def boom(sql, parameters=None):
        if "frgn_buy_days" in sql:
            raise DatabaseError("Code: 47. DB::Exception: Unknown identifier. (UNKNOWN_IDENTIFIER)", code=47)
        return query(sql, parameters)

    fake.query = boom
    assert sq.screen(preset="foreign_buy_5d") == {"date": D.isoformat(), "total": 0, "bb_sigma": 2.0, "items": []}


def test_pension_preset_where_combines_with_filters():
    where, params = sq.build_where("pension_buy_10d", {"market": "KOSDAQ", "mcap_min": 1000})
    assert where == ["date = %(d)s", "pension_buy_days >= 10", "market = %(market)s", "liquid = 1",
                     "mcap >= %(mcap_min)s"]
    assert params == {"market": "KOSDAQ", "mcap_min": 1000 * sq.EOK}
    assert sq.PENSION_BUY_DAYS == 10
    assert sq.LENDING_DROP_PCT == -20


def test_pension_preset_before_column_exists_is_empty_not_error(ch):
    fake = ch([[(D,)]])
    query = fake.query

    def boom(sql, parameters=None):
        if "pension_buy_days" in sql:
            raise DatabaseError("Code: 47. DB::Exception: Unknown identifier. (UNKNOWN_IDENTIFIER)", code=47)
        return query(sql, parameters)

    fake.query = boom
    assert sq.screen(preset="pension_buy_10d") == {"date": D.isoformat(), "total": 0, "bb_sigma": 2.0, "items": []}


def test_other_count_errors_still_raise(ch):
    fake = ch([[(D,)]])
    query = fake.query

    def boom(sql, parameters=None):
        if "count()" in sql:
            raise DatabaseError("Code: 241. Memory limit", code=241)
        return query(sql, parameters)

    fake.query = boom
    with pytest.raises(DatabaseError):
        sq.screen()


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
    rows = [("AAA", "KOSPI", "0013", 10500.0, 3.2, 5e9, 1e12, 2.4, 55.0, 10000.0, 200.0, 1, 1, 0, 12.5, 9.5, 1.1, 14.0,
             476190.0, 10250.0, 9800.0),
            ("BBB", "KOSDAQ", "", 900.0, None, 1e8, None, None, None, None, None, 0, 0, None, None, None, None, None,
             111111.0, None, None)]
    fake = ch([[(D,)], [(2,)], rows])
    out = sq.screen(limit=500, offset=-3)
    assert out["date"] == "2026-10-16" and out["total"] == 2 and out["bb_sigma"] == 2.0
    assert out["items"][0] == {
        "ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": "전기·전자", "close": 10500.0, "chg_1d": 3.2,
        "value": 5e9, "mcap": 1e12, "vol_ratio20": 2.4, "rsi14": 55.0, "ma_order": 1, "is_new_high": True,
        "gc_days": 0, "vp_above_pct": 12.5, "per": 9.5, "pbr": 1.1, "roe": 14.0,
        "bb_position": "ABOVE", "bb_width_pct": 8.0,
        "volume": 476190.0, "ma5": 10250.0, "ma20": 10000.0, "ma50": 9800.0, "ma5_20_spread_pct": 2.5}
    b = out["items"][1]
    assert b["volume"] == 111111.0 and b["ma5"] is None and b["ma20"] is None and b["ma5_20_spread_pct"] is None
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


def test_lending_preset_before_column_exists_is_empty_not_error(ch):
    # 배포 직후 compute_screener 가 lending_chg5 컬럼을 더하기 전에 '대차잔고 급감' 칩을 눌러도 0건(오류 아님)
    fake = ch([[(D,)]])
    query = fake.query

    def boom(sql, parameters=None):
        if "lending_chg5" in sql:
            raise DatabaseError("Code: 47. DB::Exception: Unknown identifier. (UNKNOWN_IDENTIFIER)", code=47)
        return query(sql, parameters)

    fake.query = boom
    assert sq.screen(preset="lending_drop") == {"date": D.isoformat(), "total": 0, "bb_sigma": 2.0, "items": []}


# ---------------------------------------------------------------- 5·20일선 정배열(관리자 스크리너)
_MA5_20 = "ma5 IS NOT NULL AND ma20 IS NOT NULL AND round(ma5, 2) > round(ma20, 2)"


@pytest.mark.parametrize("mode, cond", [
    ("MA5_20", _MA5_20),
    ("CLOSE_MA5_20", "ma5 IS NOT NULL AND ma20 IS NOT NULL AND close >= ma5 AND round(ma5, 2) > round(ma20, 2)"),
    ("PULLBACK_MA5_20",
     "ma5 IS NOT NULL AND ma20 IS NOT NULL AND close < ma5 AND close >= ma20 AND round(ma5, 2) > round(ma20, 2)"),
])
def test_ma5_20_modes_are_constant_sql(mode, cond):
    where, params = sq.build_where(None, {"ma_order": mode})
    assert where == ["date = %(d)s", "liquid = 1", cond]
    assert params == {}                                                     # 상수 조건 — 바인딩 없음


def test_perfect_reverse_keep_bound_param():
    # 기존 PERFECT·REVERSE 는 바인딩 그대로(하위 호환)
    for mode, code in (("PERFECT", 1), ("REVERSE", -1)):
        where, params = sq.build_where(None, {"ma_order": mode})
        assert where[-1] == "ma_order = %(ma_order)s" and params == {"ma_order": code}


def test_new_range_filters_bound_with_units():
    where, params = sq.build_where("ma5_20", {
        "value_min": 30, "value_max": 1000, "volume_min": 10, "volume_max": 500, "chg_min": -2, "chg_max": 5,
        "spread_5_20_min": 0, "spread_5_20_max": 3})
    for frag in ("value >= %(value_min)s", "value <= %(value_max)s", "volume >= %(volume_min)s",
                 "volume <= %(volume_max)s", "chg_1d >= %(chg_min)s", "chg_1d <= %(chg_max)s",
                 "ma20 > 0 AND (ma5 - ma20) * 100 / ma20 >= %(spread_5_20_min)s",
                 "ma20 > 0 AND (ma5 - ma20) * 100 / ma20 <= %(spread_5_20_max)s"):
        assert frag in where, frag
    assert params["value_min"] == 30 * sq.EOK and params["value_max"] == 1000 * sq.EOK      # 억 원
    assert params["volume_min"] == 10 * 1e4 and params["volume_max"] == 500 * 1e4           # 만 주
    assert params["chg_min"] == -2.0 and params["chg_max"] == 5.0                           # 음수 허용
    assert params["spread_5_20_min"] == 0.0 and params["spread_5_20_max"] == 3.0


def test_negative_spread_allowed_and_volume_negative_ignored():
    where, params = sq.build_where(None, {"spread_5_20_min": -5, "volume_min": -1, "value_max": -3})
    assert "ma20 > 0 AND (ma5 - ma20) * 100 / ma20 >= %(spread_5_20_min)s" in where
    assert params == {"spread_5_20_min": -5.0}


@pytest.mark.parametrize("lo, hi", [("value_min", "value_max"), ("volume_min", "volume_max"), ("chg_min", "chg_max"),
                                    ("spread_5_20_min", "spread_5_20_max")])
def test_new_reversed_pairs_ignored(lo, hi):
    where, params = sq.build_where(None, {lo: 10, hi: 1})
    assert where == ["date = %(d)s", "liquid = 1"] and params == {}


def test_new_filters_values_never_in_sql(ch):
    fake = ch()
    sq.screen(preset="ma5_20", filters={"ma_order": "PULLBACK_MA5_20", "chg_min": -7.25, "volume_max": 123.5,
                                        "spread_5_20_max": 9.75}, sort="spread_5_20")
    sql, params = fake.queries[2]
    assert "-7.25" not in sql and "123.5" not in sql and "9.75" not in sql
    assert "ORDER BY (ma5 - ma20) / nullIf(ma20, 0) DESC NULLS LAST, ticker" in sql
    assert params["chg_min"] == -7.25


@pytest.mark.parametrize("sort, order", [
    ("volume", "volume DESC, ticker"),
    ("spread_5_20", "(ma5 - ma20) / nullIf(ma20, 0) DESC NULLS LAST, ticker"),
])
def test_new_sorts(ch, sort, order):
    fake = ch()
    sq.screen(sort=sort)
    assert f"ORDER BY {order}" in fake.queries[2][0]


def test_unknown_ma_mode_ignored():
    where, params = sq.build_where(None, {"ma_order": "MA5_20; DROP TABLE x"})
    assert where == ["date = %(d)s", "liquid = 1"] and params == {}


def test_ma5_20_spread_pct():
    assert sq.ma5_20_spread_pct(10250.0, 10000.0) == 2.5
    assert sq.ma5_20_spread_pct(9500.0, 10000.0) == -5.0
    assert sq.ma5_20_spread_pct(None, 1.0) is None and sq.ma5_20_spread_pct(1.0, None) is None
    assert sq.ma5_20_spread_pct(1.0, 0.0) is None


def test_graphql_ma5_20_fields(monkeypatch):
    seen = []
    item = {**ITEM, "volume": 476190.0, "ma5": 10250.0, "ma20": 10000.0, "ma50": 9800.0, "ma5_20_spread_pct": 2.5}

    def fake_screen(**kw):
        seen.append(kw)
        return {"date": "2026-10-16", "total": 1, "bb_sigma": 2.0, "items": [item]}

    monkeypatch.setattr(sq, "screen", fake_screen)
    q = """query($f: ScreenerFilterInput) { screenerScreen(preset: "ma5_20", filters: $f, sort: "spread_5_20") {
      items { ticker volume ma5 ma20 ma50 ma5Ma20SpreadPct } } }"""
    res = schema.execute_sync(q, variable_values={"f": {
        "maOrder": "CLOSE_MA5_20", "valueMax": 1000, "volumeMin": 10, "volumeMax": 500, "chgMin": -2, "chgMax": 5,
        "ma5Ma20SpreadMin": 0, "ma5Ma20SpreadMax": 3}})
    assert res.errors is None, res.errors
    kw = seen[0]
    assert kw["preset"] == "ma5_20" and kw["sort"] == "spread_5_20"
    f = kw["filters"]
    assert f["ma_order"] == "CLOSE_MA5_20" and f["value_max"] == 1000 and f["volume_min"] == 10
    assert f["volume_max"] == 500 and f["chg_min"] == -2 and f["chg_max"] == 5
    assert f["spread_5_20_min"] == 0 and f["spread_5_20_max"] == 3
    assert res.data["screenerScreen"]["items"][0] == {"ticker": "AAA", "volume": 476190.0, "ma5": 10250.0,
                                                      "ma20": 10000.0, "ma50": 9800.0, "ma5Ma20SpreadPct": 2.5}


def test_graphql_old_items_without_new_fields_still_work(monkeypatch):
    # 신규 필드가 없는 예전 모양 item 도 그대로 만들어진다(웹·앱 쿼리는 새 필드를 묻지 않음)
    monkeypatch.setattr(sq, "screen", lambda **kw: {"date": "2026-10-16", "total": 1, "bb_sigma": 2.0, "items": [ITEM]})
    res = schema.execute_sync("{ screenerScreen { items { ticker volume ma5 ma5Ma20SpreadPct } } }")
    assert res.errors is None, res.errors
    assert res.data["screenerScreen"]["items"][0] == {"ticker": "AAA", "volume": None, "ma5": None,
                                                      "ma5Ma20SpreadPct": None}

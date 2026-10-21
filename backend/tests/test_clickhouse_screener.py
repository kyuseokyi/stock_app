"""스크리너 CH 입출력 — DDL·적재 컬럼 순서·로더 변환(가짜 CH 클라이언트)."""
from datetime import date, timedelta

from apps.collector.repositories import clickhouse_screener as cs

D1, D2 = date(2026, 10, 15), date(2026, 10, 16)


class _FakeCH:
    def __init__(self, results=None):
        self.commands, self.inserts, self.queries = [], [], []
        self._results = list(results or [])

    def command(self, sql):
        self.commands.append(sql)

    def insert(self, table, rows, column_names):
        self.inserts.append((table, rows, column_names))

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters))
        rows = self._results.pop(0) if self._results else []
        return type("R", (), {"result_rows": rows})()


def test_ensure_table_columns():
    ch = _FakeCH()
    cs.ensure_screener_table(ch)
    ddl = ch.commands[0]
    assert ".screener_daily" in ddl and "ReplacingMergeTree(ingested_at)" in ddl
    assert "PARTITION BY toYYYYMM(date)" in ddl and "ORDER BY (date, ticker)" in ddl
    for col in cs.ROW_COLUMNS:
        assert f"\n    {col} " in ddl, col
    assert "gc_days Nullable(Int16)" in ddl and "ma_order Int8" in ddl and "is_new_high UInt8" in ddl


def test_upsert_rows_uses_column_order():
    ch = _FakeCH()
    assert cs.upsert_rows([], ch) == 0 and ch.inserts == []
    row = {c: None for c in cs.ROW_COLUMNS} | {"date": D2, "ticker": "AAA", "close": 1.0}
    assert cs.upsert_rows([row], ch) == 1
    table, rows, cols = ch.inserts[0]
    assert table.endswith(".screener_daily") and cols == cs.ROW_COLUMNS
    assert rows == [[row[c] for c in cs.ROW_COLUMNS]]


def test_load_bars_sorted_per_ticker_with_low():
    ch = _FakeCH([[("BBB", D2, 11.0, 9.0, 10.0, 100), ("AAA", D2, 21, 19, 20, 5), ("AAA", D1, 11, 9, 10, 3)]])
    out = cs.load_bars(D2, client=ch)
    assert out == {"AAA": [(D1, 11.0, 9.0, 10.0, 3.0), (D2, 21.0, 19.0, 20.0, 5.0)],
                   "BBB": [(D2, 11.0, 9.0, 10.0, 100.0)]}
    sql, params = ch.queries[0]
    assert "high, low, close, volume" in sql and "daily_prices FINAL" in sql
    assert params == {"d": D2, "since": D2 - timedelta(days=400)}


def test_load_fundamentals_keeps_latest_year():
    ch = _FakeCH([[("AAA", "202312", 100.0, 1000.0, 10.0, 5.0, 3.0, 80.0),
                   ("AAA", "202412", 120.0, 1100.0, 11.0, 6.0, 4.0, 70.0),
                   ("BBB", "202412", None, None, None, None, None, None)]])
    out = cs.load_fundamentals(ch)
    assert out["AAA"] == {"yymm": "202412", "eps": 120.0, "bps": 1100.0, "roe": 11.0, "sales_growth": 6.0,
                          "op_growth": 4.0, "debt_ratio": 70.0}
    assert out["BBB"]["eps"] is None
    assert "period = 'Y'" in ch.queries[0][0] and "ORDER BY ticker, stac_yymm" in ch.queries[0][0]


def test_load_fundamentals_fills_null_fields_from_previous_year():
    ch = _FakeCH([[("AAA", "202312", 100.0, 1000.0, 10.0, 5.0, 3.0, 80.0),
                   ("AAA", "202412", None, None, 11.0, None, 4.0, 70.0)]])
    out = cs.load_fundamentals(ch)["AAA"]
    assert out == {"yymm": "202412", "eps": 100.0, "bps": 1000.0, "roe": 11.0, "sales_growth": 5.0,
                   "op_growth": 4.0, "debt_ratio": 70.0}      # 최신 행의 값이 있으면 그 값, 비면 이전 결산 값


def test_load_bars_ticker_filter():
    ch = _FakeCH([[("AAA", D2, 21, 19, 20, 5)]])
    assert list(cs.load_bars(D2, client=ch, tickers=["AAA", "BBB"])) == ["AAA"]
    sql, params = ch.queries[0]
    assert "ticker IN %(tickers)s" in sql and params["tickers"] == ("AAA", "BBB")
    assert cs.load_bars(D2, client=ch, tickers=[]) == {} and len(ch.queries) == 1   # 빈 목록은 조회 없음


def test_slice_bars_matches_per_day_load():
    """한 번 읽어 자른 결과 == 날짜별로 읽은 결과(범위: as_of 이하, as_of-days 초과)."""
    base = date(2026, 1, 1)
    table = [("AAA", base + timedelta(days=i), 12.0, 8.0, 10.0 + i, 100.0 + i) for i in range(0, 60)]
    table += [("BBB", base + timedelta(days=i), 12.0, 8.0, 5.0, 50.0) for i in range(40, 60)]

    def fake_for(as_of, days):
        since = as_of - timedelta(days=days)
        return _FakeCH([[r for r in table if since < r[1] <= as_of]])

    whole = cs.load_bars(base + timedelta(days=59), days=200, client=fake_for(base + timedelta(days=59), 200))
    for off in (10, 45, 59):
        d = base + timedelta(days=off)
        assert cs.slice_bars(whole, d, 30) == cs.load_bars(d, days=30, client=fake_for(d, 30))


def test_load_fundamentals_skips_partial_year_for_flow_fields():
    """KIS 연간 최신 행(202606 = 상반기 누적)은 EPS·ROE·성장률에 쓰지 않고, BPS·부채비율(시점 값)에만 쓴다."""
    ch = _FakeCH([[("AAA", "202412", 4950.0, 57981.0, 9.03, 16.2, 3.0, 26.0),
                   ("AAA", "202512", 6564.0, 63997.0, 10.85, 10.88, 4.0, 29.9),
                   ("AAA", "202606", 17687.0, 86052.0, 31.39, 98.67, 50.0, 31.1)]])
    assert cs.load_fundamentals(ch)["AAA"] == {"yymm": "202512", "eps": 6564.0, "bps": 86052.0, "roe": 10.85,
                                               "sales_growth": 10.88, "op_growth": 4.0, "debt_ratio": 31.1}


def test_load_fundamentals_non_december_settlement():
    """3월 결산사는 03 이 결산월 — 202509(진행 중) 는 기간 값에서 빠진다."""
    ch = _FakeCH([[("BBB", "202403", 10.0, 100.0, 5.0, 1.0, 1.0, 50.0),
                   ("BBB", "202503", 12.0, 110.0, 6.0, 2.0, 2.0, 55.0),
                   ("BBB", "202509", 7.0, 120.0, 3.0, 9.0, 9.0, 60.0)]])
    out = cs.load_fundamentals(ch)["BBB"]
    assert (out["yymm"], out["eps"], out["roe"], out["bps"], out["debt_ratio"]) == ("202503", 12.0, 6.0, 120.0, 60.0)

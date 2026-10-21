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

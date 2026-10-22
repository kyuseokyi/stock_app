"""차트 패턴 CH 입출력 — DDL·봉 로드·기준일 삭제 후 적재(가짜 CH 클라이언트)."""
from datetime import date, timedelta

import pytest

from apps.collector.repositories import clickhouse_patterns as cp

D1, D2 = date(2026, 10, 15), date(2026, 10, 16)


class _FakeCH:
    def __init__(self, results=None):
        self.ops, self.queries = [], []
        self._results = list(results or [])

    def command(self, sql, parameters=None):
        self.ops.append(("command", sql, parameters))

    def insert(self, table, rows, column_names):
        self.ops.append(("insert", table, rows, column_names))

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters))
        rows = self._results.pop(0) if self._results else []
        return type("R", (), {"result_rows": rows})()


def test_ddl_columns():
    ch = _FakeCH()
    cp.ensure_patterns_table(ch)
    ddl = ch.ops[0][1]
    assert ".chart_pattern_daily" in ddl and "ReplacingMergeTree(ingested_at)" in ddl
    assert "PARTITION BY toYYYYMM(date)" in ddl and "ORDER BY (date, ticker, rim_date)" in ddl
    for col in cp.ROW_COLUMNS:
        assert f"\n    {col} " in ddl, col
    assert "ingested_at DateTime64(3)" in ddl
    for frag in ("low_date Nullable(Date)", "low_price Nullable(Float64)", "is_active UInt8", "is_current UInt8",
                 "breakout_date Nullable(Date)", "days_since_breakout Nullable(Int32)", "points String",
                 "prior_uptrend_pct Nullable(Float64)"):
        assert frag in ddl, frag


def test_load_bars_limits_count_filters_and_ascending():
    # CH 는 종목별 날짜 내림차순으로 준다
    ch = _FakeCH([[("AAA", D2, 2, 3, 1, 2.5, 50), ("AAA", D1, 1, 2, 0.5, 1.5, 40), ("BBB", D2, 5, 6, 4, 5.5, 9)]])
    out = cp.load_bars(D2, client=ch, tickers=["AAA", "BBB"])
    assert out == {"AAA": [(D1, 1.0, 2.0, 0.5, 1.5, 40.0), (D2, 2.0, 3.0, 1.0, 2.5, 50.0)],
                   "BBB": [(D2, 5.0, 6.0, 4.0, 5.5, 9.0)]}
    sql, params = ch.queries[0]
    assert "daily_prices FINAL" in sql and "open, high, low, close, volume" in sql
    assert "ORDER BY ticker, date DESC LIMIT %(n)s BY ticker" in sql and "ticker IN %(tickers)s" in sql
    assert params["n"] == 770 and params["d"] == D2 and params["tickers"] == ("AAA", "BBB")
    assert params["since"] == D2 - timedelta(days=1500)


def test_load_bars_without_tickers_and_empty_tickers():
    ch = _FakeCH()
    cp.load_bars(D2, bars=100, client=ch)
    sql, params = ch.queries[0]
    assert "ticker IN" not in sql and params["n"] == 100
    assert cp.load_bars(D2, client=ch, tickers=[]) == {} and len(ch.queries) == 1


def test_replace_day_inserts_then_deletes_older_with_same_t0():
    ch = _FakeCH()
    row = {c: None for c in cp.ROW_COLUMNS} | {"date": D2, "ticker": "AAA"}
    row2 = dict(row, ticker="BBB")
    assert cp.replace_day(D2, [row, row2], ch) == 2
    assert [o[0] for o in ch.ops] == ["insert", "command"]
    ins, dele = ch.ops
    assert ins[3] == cp.ROW_COLUMNS and "ingested_at" in cp.ROW_COLUMNS
    idx = cp.ROW_COLUMNS.index("ingested_at")
    t0s = {r[idx] for r in ins[2]}
    assert len(t0s) == 1
    t0 = t0s.pop()
    assert t0.tzinfo is not None and t0.microsecond % 1000 == 0
    assert [r[cp.ROW_COLUMNS.index("ticker")] for r in ins[2]] == ["AAA", "BBB"]
    assert dele[1].startswith("DELETE FROM") and "date = %(d)s AND ingested_at < toDateTime64(%(t0)s, 3" in dele[1]
    assert dele[2]["d"] == D2 and dele[2]["t0"] == t0.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def test_replace_day_insert_failure_skips_delete():
    class Boom(_FakeCH):
        def insert(self, table, rows, column_names):
            raise RuntimeError("insert down")

    ch = Boom()
    row = {c: None for c in cp.ROW_COLUMNS}
    with pytest.raises(RuntimeError):
        cp.replace_day(D2, [row], ch)
    assert ch.ops == []  # DELETE 호출 없음


def test_replace_day_empty_rows_touches_nothing():
    ch = _FakeCH()
    assert cp.replace_day(D2, [], ch) == 0 and ch.ops == []

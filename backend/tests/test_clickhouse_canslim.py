"""CANSLIM CH 입출력 — DDL·적재 컬럼·로더 변환(가짜 CH 클라이언트)."""
from datetime import date

from apps.collector.repositories import clickhouse_canslim as cc


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


def test_ensure_tables():
    ch = _FakeCH()
    cc.ensure_canslim_tables(ch)
    joined = "\n".join(ch.commands)
    assert ".canslim_daily" in joined and ".canslim_market" in joined
    assert joined.count("ReplacingMergeTree(ingested_at)") == 2
    for col in cc.ROW_COLUMNS:
        assert f"\n    {col} " in joined, col


def test_upsert_rows_uses_column_order():
    ch = _FakeCH()
    row = {c: None for c in cc.ROW_COLUMNS}
    row.update({"date": date(2026, 10, 16), "ticker": "AAA", "market": "KOSPI", "sector_m": "0013", "close": 1.0,
                "score": 80, "pass_count": 6, "liquid": 1, "c_quarter": "", "c_turnaround": 0,
                **{k: 1 for k in "cansilm"}})
    assert cc.upsert_rows([row], client=ch) == 1
    table, rows, cols = ch.inserts[0]
    assert table.endswith(".canslim_daily") and cols == cc.ROW_COLUMNS
    assert rows[0][cols.index("ticker")] == "AAA" and rows[0][cols.index("score")] == 80
    assert cc.upsert_rows([], client=ch) == 0 and len(ch.inserts) == 1


def test_upsert_markets():
    ch = _FakeCH()
    cc.upsert_markets([{"date": date(2026, 10, 16), "market": "KOSPI", "close": 1.0, "ma50": 1.0, "ma200": 1.0,
                        "dist_days": 2, "status": "조정"}], client=ch)
    assert ch.inserts[0][2] == cc.MARKET_COLUMNS and ch.inserts[0][1][0][-1] == "조정"


def test_latest_and_trading_dates():
    assert cc.latest_trading_date(client=_FakeCH([[(date(2026, 10, 16),)]])) == date(2026, 10, 16)
    assert cc.latest_trading_date(client=_FakeCH([[(date(1970, 1, 1),)]])) is None
    ch = _FakeCH([[(date(2026, 10, 16),), (date(2026, 10, 15),)]])
    assert cc.trading_dates(date(2026, 10, 16), 2, client=ch) == [date(2026, 10, 15), date(2026, 10, 16)]


def test_load_bars_sorted_per_ticker():
    d1, d2 = date(2026, 10, 15), date(2026, 10, 16)
    ch = _FakeCH([[("AAA", d2, 11.0, 10.0, 5), ("AAA", d1, 9.0, 8.0, 4), ("BBB", d1, 2.0, 1.0, 1)]])
    bars = cc.load_bars(d2, client=ch)
    assert bars == {"AAA": [(d1, 9.0, 8.0, 4.0), (d2, 11.0, 10.0, 5.0)], "BBB": [(d1, 2.0, 1.0, 1.0)]}
    assert ch.queries[0][1]["d"] == d2


def test_load_index_investor_fundamentals():
    d = date(2026, 10, 16)
    ch = _FakeCH([[("KR:0001", d, 2600.0, 100.0), ("KR:1001", d, 800.0, None)]])
    assert cc.load_index_bars(d, client=ch) == {"KOSPI": [(2600.0, 100.0)], "KOSDAQ": [(800.0, None)]}
    ch = _FakeCH([[("AAA", date(2026, 10, 15), 5), ("AAA", d, -3)]])
    assert cc.load_investor(d, client=ch) == {"AAA": [5, -3]}
    ch = _FakeCH([[("AAA", "Q", "202606", 80.0, 12.0), ("AAA", "Y", "202512", 220.0, 21.0)]])
    assert cc.load_fundamentals(client=ch) == {"AAA": {"Y": [("202512", 220.0, 21.0)], "Q": [("202606", 80.0)]}}

"""시장 그룹 CH 입출력 — DDL·적재 컬럼·로더·숨김 테마 덮어쓰기(가짜 CH 클라이언트)."""
from datetime import date

from apps.collector.repositories import clickhouse_market_groups as cg

D = date(2026, 10, 16)


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


def test_ensure_tables_have_all_columns():
    ch = _FakeCH()
    cg.ensure_market_group_tables(ch)
    joined = "\n".join(ch.commands)
    assert ".market_stock_daily" in joined and ".market_group_daily" in joined
    assert joined.count("ReplacingMergeTree(ingested_at)") == 2
    for col in cg.STOCK_COLUMNS + cg.GROUP_COLUMNS:
        assert f"\n    {col} " in joined, col


def test_load_bars_since_computed_in_python():
    ch = _FakeCH([[("AAA", date(2026, 10, 16), 2.0, 10), ("AAA", date(2026, 10, 15), 1.0, 5),
                   ("BBB", date(2026, 10, 16), 3.0, 1)]])
    out = cg.load_bars(D, client=ch)
    assert out["AAA"] == [(date(2026, 10, 15), 1.0, 5.0), (date(2026, 10, 16), 2.0, 10.0)]
    sql, params = ch.queries[0]
    assert "FINAL" in sql and params["since"] == date(2026, 9, 1) and params["d"] == D


def test_upserts_use_column_order():
    ch = _FakeCH()
    srow = {c: None for c in cg.STOCK_COLUMNS} | {"date": D, "ticker": "AAA", "value": 1.0}
    grow = {c: 0 for c in cg.GROUP_COLUMNS} | {"date": D, "kind": "theme", "group_id": "7", "name": "반도체",
                                               "leader_ticker": "AAA", "leader_chg": None}
    assert cg.upsert_stocks([srow], client=ch) == 1 and cg.upsert_groups([grow], client=ch) == 1
    assert cg.upsert_stocks([], client=ch) == 0 and len(ch.inserts) == 2
    (t1, r1, c1), (t2, r2, c2) = ch.inserts
    assert t1.endswith(".market_stock_daily") and c1 == cg.STOCK_COLUMNS and r1[0][c1.index("ticker")] == "AAA"
    assert t2.endswith(".market_group_daily") and c2 == cg.GROUP_COLUMNS and r2[0][c2.index("name")] == "반도체"


def test_existing_group_ids():
    ch = _FakeCH([[("7",), ("9",)]])
    assert cg.existing_group_ids(D, "theme", client=ch) == {"7", "9"}
    sql, params = ch.queries[0]
    assert "FINAL" in sql and "members > 0" in sql and params == {"d": D, "kind": "theme"}


def test_tombstones_cover_only_vanished_groups():
    rows = cg.tombstones(D, "theme", previous_ids={"7", "9", "11"}, current_ids={"7"})
    assert sorted(r["group_id"] for r in rows) == ["11", "9"]
    r = rows[0]
    assert set(r) == set(cg.GROUP_COLUMNS)
    assert r["members"] == 0 and r["rank"] == 0 and r["kind"] == "theme" and r["date"] == D
    assert r["chg_1d"] is None and r["leader_ticker"] == "" and r["value"] == 0

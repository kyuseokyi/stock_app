"""CH 시장 테이블 — DDL·적재 컬럼·최근 날짜 조회(가짜 CH 클라이언트)."""
from datetime import date

from apps.collector.repositories import clickhouse_market as chm


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


def test_ensure_creates_four_replacing_tables():
    ch = _FakeCH()
    chm.ensure_market_tables(ch)
    joined = "\n".join(ch.commands)
    for t in ("market_index_daily", "investor_daily", "fundamentals_periodic", "macro_series"):
        assert f".{t}" in joined
    assert joined.count("ReplacingMergeTree(ingested_at)") == 4
    assert joined.count("CREATE TABLE IF NOT EXISTS") == 4


def test_upsert_index_rows():
    ch = _FakeCH()
    n = chm.upsert_index_daily("US:SOX", [{"date": date(2026, 10, 15), "open": 1, "high": 2, "low": 0.5,
                                          "close": 1.5, "volume": None}], client=ch)
    assert n == 1
    table, rows, cols = ch.inserts[0]
    assert table.endswith(".market_index_daily") and cols == ["code", "date", "open", "high", "low", "close", "volume"]
    assert rows == [["US:SOX", date(2026, 10, 15), 1, 2, 0.5, 1.5, None]]


def test_upsert_investor_fundamentals_macro_columns():
    ch = _FakeCH()
    chm.upsert_investor_daily("005930", [{"date": date(2026, 10, 16), "prsn_qty": 1, "frgn_qty": 2, "orgn_qty": 3,
                                          "prsn_amt": 4, "frgn_amt": 5, "orgn_amt": 6}], client=ch)
    chm.upsert_fundamentals("005930", "Q", [{"stac_yymm": "202606", "eps": 1.0, "bps": None, "sps": None,
                                             "roe": 2.0, "sales_growth": None, "op_growth": None,
                                             "ni_growth": None, "debt_ratio": None}], client=ch)
    chm.upsert_macro("CPIAUCSL", [(date(2026, 9, 1), 320.1), (date(2026, 10, 1), None)], client=ch)
    assert ch.inserts[0][1][0] == ["005930", date(2026, 10, 16), 1, 2, 3, 4, 5, 6]
    assert ch.inserts[1][1][0][:4] == ["005930", "Q", "202606", 1.0]
    assert ch.inserts[2][1] == [["CPIAUCSL", date(2026, 9, 1), 320.1], ["CPIAUCSL", date(2026, 10, 1), None]]


def test_empty_rows_skip_insert():
    ch = _FakeCH()
    assert chm.upsert_index_daily("KR:0001", [], client=ch) == 0 and ch.inserts == []


def test_latest_dates():
    assert chm.latest_index_date("KR:0001", client=_FakeCH([[date(2026, 10, 16)]])) == date(2026, 10, 16)
    assert chm.latest_index_date("KR:0001", client=_FakeCH([[date(1970, 1, 1)]])) is None  # 빈 테이블 max()
    assert chm.latest_macro_date("UNRATE", client=_FakeCH([[None]])) is None
    assert chm.latest_macro_date("UNRATE", client=_FakeCH([])) is None

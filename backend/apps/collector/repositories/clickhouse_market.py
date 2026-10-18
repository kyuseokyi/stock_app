"""ClickHouse 시장 테이블 — 지수·투자자별 순매수·재무비율·거시 지표.

모두 ReplacingMergeTree(ingested_at): 같은 키를 다시 넣으면 최신 행이 남는다(겹침 재수집 멱등). 조회는 FINAL.
"""
from __future__ import annotations

from datetime import date

from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

_EPOCH = date(1970, 1, 1)  # 빈 테이블의 max(Date) 기본값

INDEX_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.market_index_daily
(
    code         LowCardinality(String),
    date         Date,
    open         Float64,
    high         Float64,
    low          Float64,
    close        Float64,
    volume       Nullable(Float64),
    ingested_at  DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYear(date)
ORDER BY (code, date)
"""

INVESTOR_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.investor_daily
(
    ticker       String,
    date         Date,
    prsn_qty     Int64,
    frgn_qty     Int64,
    orgn_qty     Int64,
    prsn_amt     Int64,
    frgn_amt     Int64,
    orgn_amt     Int64,
    ingested_at  DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(date)
ORDER BY (ticker, date)
"""

FUNDAMENTALS_PERIODIC_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.fundamentals_periodic
(
    ticker        String,
    period        LowCardinality(String),
    stac_yymm     String,
    eps           Nullable(Float64),
    bps           Nullable(Float64),
    sps           Nullable(Float64),
    roe           Nullable(Float64),
    sales_growth  Nullable(Float64),
    op_growth     Nullable(Float64),
    ni_growth     Nullable(Float64),
    debt_ratio    Nullable(Float64),
    ingested_at   DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (ticker, period, stac_yymm)
"""

MACRO_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.macro_series
(
    series_id    LowCardinality(String),
    date         Date,
    value        Nullable(Float64),
    ingested_at  DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (series_id, date)
"""

ALL_DDL = (INDEX_DDL, INVESTOR_DDL, FUNDAMENTALS_PERIODIC_DDL, MACRO_DDL)


def ensure_market_tables(client=None) -> None:
    """수집 태스크 시작 때 멱등 생성(배포에서 init_clickhouse 를 따로 돌리지 않아도 되게)."""
    c = client or get_client()
    for ddl in ALL_DDL:
        c.command(ddl)


def _insert(table: str, rows: list[list], cols: list[str], client) -> int:
    if not rows:
        return 0
    (client or get_client()).insert(f"{CLICKHOUSE_DB}.{table}", rows, column_names=cols)
    return len(rows)


def upsert_index_daily(code: str, records: list[dict], client=None) -> int:
    rows = [[code, r["date"], r["open"], r["high"], r["low"], r["close"], r.get("volume")] for r in records]
    return _insert("market_index_daily", rows, ["code", "date", "open", "high", "low", "close", "volume"], client)


def upsert_investor_daily(ticker: str, records: list[dict], client=None) -> int:
    cols = ["ticker", "date", "prsn_qty", "frgn_qty", "orgn_qty", "prsn_amt", "frgn_amt", "orgn_amt"]
    rows = [[ticker, r["date"], r["prsn_qty"], r["frgn_qty"], r["orgn_qty"], r["prsn_amt"], r["frgn_amt"],
             r["orgn_amt"]] for r in records]
    return _insert("investor_daily", rows, cols, client)


def upsert_fundamentals(ticker: str, period: str, records: list[dict], client=None) -> int:
    cols = ["ticker", "period", "stac_yymm", "eps", "bps", "sps", "roe", "sales_growth", "op_growth",
            "ni_growth", "debt_ratio"]
    rows = [[ticker, period, r["stac_yymm"], r["eps"], r["bps"], r["sps"], r["roe"], r["sales_growth"],
             r["op_growth"], r["ni_growth"], r["debt_ratio"]] for r in records]
    return _insert("fundamentals_periodic", rows, cols, client)


def upsert_macro(series_id: str, observations: list[tuple[date, float | None]], client=None) -> int:
    rows = [[series_id, d, v] for d, v in observations]
    return _insert("macro_series", rows, ["series_id", "date", "value"], client)


def _latest(sql: str, params: dict, client) -> date | None:
    rows = (client or get_client()).query(sql, parameters=params).result_rows
    d = rows[0][0] if rows else None
    return None if d is None or d == _EPOCH else d


def latest_index_date(code: str, client=None) -> date | None:
    return _latest(f"SELECT max(date) FROM {CLICKHOUSE_DB}.market_index_daily FINAL WHERE code = %(c)s",
                   {"c": code}, client)


def latest_macro_date(series_id: str, client=None) -> date | None:
    return _latest(f"SELECT max(date) FROM {CLICKHOUSE_DB}.macro_series FINAL WHERE series_id = %(s)s",
                   {"s": series_id}, client)

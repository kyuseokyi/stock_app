"""시장 그룹 CH 입출력 — 일봉 로드와 결과 적재(market_stock_daily·market_group_daily).

결과 테이블은 ReplacingMergeTree(ingested_at): 같은 키를 다시 넣으면 최신 행이 남는다(관리자 보정 재계산도 같은 경로).
행을 지울 수는 없으므로, 재계산에서 사라진 테마(숨김 등)는 members=0 행으로 덮어쓰고 조회는 members > 0 만 본다.
"""
from __future__ import annotations

from datetime import date

from apps.collector.repositories.clickhouse_canslim import _since, latest_trading_date, trading_dates  # noqa: F401
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

STOCK_COLUMNS = ["date", "ticker", "market", "sector_m", "close", "chg_1d", "chg_5d", "chg_20d", "value", "mcap"]
GROUP_COLUMNS = ["date", "kind", "group_id", "name", "members", "chg_1d", "chg_5d", "chg_20d", "value", "mcap",
                 "up", "down", "flat", "leader_ticker", "leader_chg", "rank"]

STOCK_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.market_stock_daily
(
    date Date,
    ticker String,
    market LowCardinality(String),
    sector_m String,
    close Float64,
    chg_1d Nullable(Float64),
    chg_5d Nullable(Float64),
    chg_20d Nullable(Float64),
    value Float64,
    mcap Nullable(Float64),
    ingested_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(date)
ORDER BY (date, ticker)
"""

GROUP_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.market_group_daily
(
    date Date,
    kind LowCardinality(String),
    group_id String,
    name String,
    members UInt16,
    chg_1d Nullable(Float64),
    chg_5d Nullable(Float64),
    chg_20d Nullable(Float64),
    value Float64,
    mcap Float64,
    up UInt16,
    down UInt16,
    flat UInt16,
    leader_ticker String,
    leader_chg Nullable(Float64),
    rank UInt16,
    ingested_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(date)
ORDER BY (date, kind, group_id)
"""


def ensure_market_group_tables(client=None) -> None:
    c = client or get_client()
    c.command(STOCK_DDL)
    c.command(GROUP_DDL)


def _rows(sql: str, params: dict | None, client) -> list:
    return (client or get_client()).query(sql, parameters=params or {}).result_rows


def load_bars(as_of: date, days: int = 45, client=None) -> dict[str, list[tuple]]:
    """{ticker: [(date, close, volume)]} — as_of 이하 최근 days(달력일, 21봉 확보용), 날짜 오름차순."""
    rows = _rows(f"SELECT ticker, date, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL "
                 "WHERE date <= %(d)s AND date > %(since)s", {"d": as_of, "since": _since(as_of, days)}, client)
    out: dict[str, list[tuple]] = {}
    for ticker, d, close, volume in rows:
        out.setdefault(ticker, []).append((d, float(close), float(volume)))
    for bars in out.values():
        bars.sort(key=lambda b: b[0])
    return out


def existing_group_ids(as_of: date, kind: str, client=None) -> set[str]:
    rows = _rows(f"SELECT group_id FROM {CLICKHOUSE_DB}.market_group_daily FINAL "
                 "WHERE date = %(d)s AND kind = %(kind)s AND members > 0", {"d": as_of, "kind": kind}, client)
    return {r[0] for r in rows}


def tombstones(as_of: date, kind: str, previous_ids: set[str], current_ids: set[str]) -> list[dict]:
    """이전 계산에는 있었는데 이번에 없는 그룹 → 비어 있음(members 0) 행."""
    blank = {c: 0 for c in GROUP_COLUMNS} | {"chg_1d": None, "chg_5d": None, "chg_20d": None, "leader_chg": None,
                                             "name": "", "leader_ticker": "", "date": as_of, "kind": kind}
    return [blank | {"group_id": gid} for gid in sorted(previous_ids - current_ids)]


def _insert(table: str, columns: list[str], rows: list[dict], client) -> int:
    if not rows:
        return 0
    (client or get_client()).insert(f"{CLICKHOUSE_DB}.{table}", [[r.get(c) for c in columns] for r in rows],
                                    column_names=columns)
    return len(rows)


def upsert_stocks(rows: list[dict], client=None) -> int:
    return _insert("market_stock_daily", STOCK_COLUMNS, rows, client)


def upsert_groups(rows: list[dict], client=None) -> int:
    return _insert("market_group_daily", GROUP_COLUMNS, rows, client)

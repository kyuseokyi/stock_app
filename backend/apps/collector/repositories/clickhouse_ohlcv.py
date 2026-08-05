"""ClickHouse daily_prices 적재/조회 리포지토리.

ReplacingMergeTree(ingested_at) 이므로 같은 (ticker,date)는 재삽입 시 최신으로 대체된다(멱등).
조회는 FINAL 로 최신 1행만 취한다.
"""

from __future__ import annotations

from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

# daily_prices 삽입 컬럼(ingested_at 은 DEFAULT now() 로 자동)
_COLUMNS = [
    "ticker", "date", "open", "high", "low", "close", "volume",
    "ma5", "ma20", "ma50", "ma120",
]


def upsert_daily_prices(ticker: str, records: list[dict]) -> int:
    """OHLCV+MA 레코드를 daily_prices 에 적재. 삽입 행수 반환."""
    if not records:
        return 0
    rows = [
        [
            ticker,
            r["date"],
            r["open"], r["high"], r["low"], r["close"], r["volume"],
            r.get("ma5"), r.get("ma20"), r.get("ma50"), r.get("ma120"),
        ]
        for r in records
    ]
    client = get_client()
    client.insert(f"{CLICKHOUSE_DB}.daily_prices", rows, column_names=_COLUMNS)
    return len(rows)


def count_ticker(ticker: str) -> int:
    """해당 종목의 (중복 제거 후) 적재 행수."""
    client = get_client()
    result = client.query(
        f"SELECT count() FROM {CLICKHOUSE_DB}.daily_prices FINAL WHERE ticker = %(t)s",
        parameters={"t": ticker},
    )
    return int(result.result_rows[0][0])

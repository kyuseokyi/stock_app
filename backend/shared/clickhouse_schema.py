"""ClickHouse 시계열 스키마 초기화.

아키텍처 설계서(docs/architecture_plan.md)의 ClickHouse 섹션을 근거로
`daily_prices`(일봉+보조지표)와 `fundamentals`(재무)를 생성한다.

스토리지 전략:
  - 파티셔닝: toYYYYMM(date) 월 단위 → 오래된 파티션 통째 삭제 용이
  - 정렬키: (ticker, date) → 종목/기간 조회 최적화
  - TTL: 일봉은 장기 보관(10년). 향후 분봉 추가 시 3개월 TTL 별도 적용.

ORM(SQLAlchemy) 대상이 아니므로 Postgres 모델(shared/models.py)과 분리한다.

실행:
    uv run python -m shared.clickhouse_schema
"""

from __future__ import annotations

import os

import clickhouse_connect

CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "localhost")
CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "8123"))
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "password")
CLICKHOUSE_DB = os.getenv("CLICKHOUSE_DB", "stock_data")


DAILY_PRICES_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.daily_prices
(
    ticker      String,
    date        Date,
    open        Float64,
    high        Float64,
    low         Float64,
    close       Float64,
    volume      UInt64,
    ma5         Nullable(Float64),
    ma20        Nullable(Float64),
    ma50        Nullable(Float64),
    ma120       Nullable(Float64),
    bb_upper    Nullable(Float64),
    bb_lower    Nullable(Float64),
    rsi_14      Nullable(Float64),
    macd        Nullable(Float64)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (ticker, date)
TTL date + INTERVAL 10 YEAR
"""

FUNDAMENTALS_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.fundamentals
(
    ticker          String,
    date            Date,
    per             Nullable(Float64),
    pbr             Nullable(Float64),
    roe             Nullable(Float64),
    dividend_yield  Nullable(Float64),
    market_cap      Nullable(Float64)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (ticker, date)
"""


def get_client():
    """관리(스키마) 작업용 ClickHouse 클라이언트."""
    return clickhouse_connect.get_client(
        host=CLICKHOUSE_HOST,
        port=CLICKHOUSE_PORT,
        username=CLICKHOUSE_USER,
        password=CLICKHOUSE_PASSWORD,
    )


def init_clickhouse() -> None:
    """데이터베이스와 시계열 테이블을 멱등(idempotent)하게 생성한다."""
    client = get_client()
    client.command(f"CREATE DATABASE IF NOT EXISTS {CLICKHOUSE_DB}")
    client.command(DAILY_PRICES_DDL)
    client.command(FUNDAMENTALS_DDL)
    tables = client.query(
        f"SELECT name FROM system.tables WHERE database = '{CLICKHOUSE_DB}'"
    ).result_rows
    print(f"[ClickHouse] database='{CLICKHOUSE_DB}' 테이블:", [r[0] for r in tables])


if __name__ == "__main__":
    init_clickhouse()

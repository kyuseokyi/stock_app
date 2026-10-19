"""ClickHouse 시계열 스키마 초기화.

아키텍처 설계서(docs/architecture_plan.md)의 ClickHouse 섹션을 근거로
`daily_prices`(일봉+보조지표)와 `fundamentals`(재무)를 생성한다.

스토리지 전략:
  - 파티셔닝: toYYYYMM(date) 월 단위 → 오래된 파티션 통째 삭제 용이
  - 정렬키: (ticker, date) → 종목/기간 조회 최적화
  - TTL: 일봉은 장기 보관(10년). 게임 분봉(game_minute_bars)은 3개월.

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
    ticker       String,
    date         Date,
    open         Float64,
    high         Float64,
    low          Float64,
    close        Float64,
    volume       UInt64,
    ma5          Nullable(Float64),
    ma20         Nullable(Float64),
    ma50         Nullable(Float64),
    ma120        Nullable(Float64),
    bb_upper     Nullable(Float64),
    bb_lower     Nullable(Float64),
    rsi_14       Nullable(Float64),
    macd         Nullable(Float64),
    ingested_at  DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
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


def game_minute_bars_ddl(db: str = CLICKHOUSE_DB) -> str:
    """게임 종목 1분봉(ts=분 시작 KST). source: tick(게임 틱 집계)|kis(당일분봉 보충).

    같은 (ticker, ts) 는 최신 ingested_at 이 남는다(진행 중 바 덮어쓰기). 조회는 항상 FINAL.
    """
    return f"""
CREATE TABLE IF NOT EXISTS {db}.game_minute_bars
(
    ticker       String,
    ts           DateTime('Asia/Seoul'),
    open         Float64,
    high         Float64,
    low          Float64,
    close        Float64,
    volume       UInt64,
    source       LowCardinality(String),
    ingested_at  DateTime64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(ts)
ORDER BY (ticker, ts)
TTL toDateTime(ts) + INTERVAL 3 MONTH
"""


def ensure_game_minute_bars(client=None, db: str = CLICKHOUSE_DB) -> None:
    """game_ws 시작 시 멱등 생성(init_clickhouse 를 배포에서 따로 돌리지 않아도 되게)."""
    (client or get_client()).command(game_minute_bars_ddl(db))


# 프로세스별 재사용 클라이언트 캐시.
# 매 호출 새 클라이언트를 만들면 clickhouse_connect 가 여는 HTTP 소켓이 닫히지 않고
# 쌓여 FD 누수(EMFILE)로 이어진다 → 전종목 수집이 ~1000종목 부근에서
# OSError(24, 'Too many open files')로 무더기 실패(누수된 FD는 회수 안 돼 복구 불가).
# 한 프로세스는 클라이언트 하나만 재사용한다. celery prefork/포크 후에도 자식이
# 자기 클라이언트를 갖도록 PID 로 캐시를 무효화한다. (어디서도 .close() 하지 않음)
#
# autogenerate_session_id=False: 기본값이면 클라이언트가 세션 ID 하나를 모든 요청에 붙이고,
# ClickHouse 는 같은 세션의 동시 쿼리를 거부한다("Attempt to execute concurrent queries
# within the same session"). 전종목 수집이 스레드 4개로 이 클라이언트를 공유하면서
# 2026-10-19 일봉 1,256/4,395 종목이 이 오류로 빠졌다. 세션 없이 쓰면 HTTP 풀 기반이라
# 스레드 간 동시 사용에 안전하다(임시 테이블·SET 같은 세션 상태는 쓰지 않는다).
_client = None
_client_pid: int | None = None


def get_client():
    """관리/적재/조회 공용 ClickHouse 클라이언트(프로세스별 1개 재사용)."""
    global _client, _client_pid
    pid = os.getpid()
    if _client is None or _client_pid != pid:
        _client = clickhouse_connect.get_client(
            host=CLICKHOUSE_HOST,
            port=CLICKHOUSE_PORT,
            username=CLICKHOUSE_USER,
            password=CLICKHOUSE_PASSWORD,
            autogenerate_session_id=False,
        )
        _client_pid = pid  # 연결 성공 후에만 캐시 확정(실패 시 다음 호출에서 재시도)
    return _client


def init_clickhouse() -> None:
    """데이터베이스와 시계열 테이블을 멱등(idempotent)하게 생성한다."""
    client = get_client()
    client.command(f"CREATE DATABASE IF NOT EXISTS {CLICKHOUSE_DB}")
    client.command(DAILY_PRICES_DDL)
    client.command(FUNDAMENTALS_DDL)
    client.command(game_minute_bars_ddl())
    from apps.collector.repositories.clickhouse_market import ensure_market_tables  # 순환 import 방지

    ensure_market_tables(client)
    tables = client.query(
        f"SELECT name FROM system.tables WHERE database = '{CLICKHOUSE_DB}'"
    ).result_rows
    print(f"[ClickHouse] database='{CLICKHOUSE_DB}' 테이블:", [r[0] for r in tables])


if __name__ == "__main__":
    init_clickhouse()

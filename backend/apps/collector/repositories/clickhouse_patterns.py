"""차트 패턴 CH 입출력 — 일봉(시가 포함) 로드·chart_pattern_daily DDL·기준일 삭제 후 적재.

결과 테이블은 ReplacingMergeTree(ingested_at) 이지만, 다시 계산해서 사라진 베이스는 덮어쓰기로 지워지지 않는다.
→ 같은 기준일을 먼저 지운 뒤(경량 DELETE) 넣는다. 호출부는 빈 결과일 때 replace_day 를 부르지 않는다.
"""
from __future__ import annotations

from datetime import date, timedelta

from apps.collector.repositories.clickhouse_canslim import latest_trading_date  # noqa: F401
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

BARS = 770                 # 종목별 읽는 최근 봉 수
_SPAN_DAYS = 1500          # 스캔 범위 하한(달력일) — 770봉(≈1,130일)을 넉넉히 덮는다

ROW_COLUMNS = [
    "date", "ticker", "market", "pattern_type", "rim_date", "low_date", "low_price", "pivot", "depth", "length",
    "is_active", "is_current", "breakout_date", "breakout_price_pct", "breakout_vol_pct", "days_since_breakout",
    "base_count", "subcount", "totalcount", "label", "prior_uptrend_pct", "confidence", "points", "close",
]

DAILY_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.chart_pattern_daily
(
    date Date,
    ticker String,
    market LowCardinality(String),
    pattern_type LowCardinality(String),
    rim_date Date,
    low_date Nullable(Date),
    low_price Nullable(Float64),
    pivot Float64,
    depth Float64,
    length Int32,
    is_active UInt8,
    is_current UInt8,
    breakout_date Nullable(Date),
    breakout_price_pct Nullable(Float64),
    breakout_vol_pct Nullable(Float64),
    days_since_breakout Nullable(Int32),
    base_count Int32,
    subcount Int32,
    totalcount Int32,
    label String,
    prior_uptrend_pct Nullable(Float64),
    confidence Float64,
    points String,
    close Float64,
    ingested_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(date)
ORDER BY (date, ticker, rim_date)
"""


def ensure_patterns_table(client=None) -> None:
    (client or get_client()).command(DAILY_DDL)


def load_bars(as_of: date, bars: int = BARS, client=None, tickers=None) -> dict[str, list[tuple]]:
    """{ticker: [(date, open, high, low, close, volume)]} — as_of 이하 종목별 최근 bars 개(봉 개수 기준), 날짜 오름차순.
    tickers 를 주면 그 종목만(빈 목록이면 조회 없이 {}). 한 번의 쿼리: 날짜 내림차순 + LIMIT n BY ticker 후 뒤집는다."""
    sql = (f"SELECT ticker, date, open, high, low, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL "
           "WHERE date <= %(d)s AND date > %(since)s")
    params: dict = {"d": as_of, "since": as_of - timedelta(days=_SPAN_DAYS)}
    if tickers is not None:
        if not tickers:
            return {}
        sql += " AND ticker IN %(tickers)s"
        params["tickers"] = tuple(tickers)
    sql += " ORDER BY ticker, date DESC LIMIT %(n)s BY ticker"
    params["n"] = int(bars)
    cl = client or get_client()
    out: dict[str, list[tuple]] = {}
    for ticker, d, o, h, l, c, v in cl.query(sql, parameters=params).result_rows:
        out.setdefault(ticker, []).append((d, float(o), float(h), float(l), float(c), float(v)))
    for rows in out.values():
        rows.reverse()  # 내림차순으로 받았으므로 오름차순으로
    return out


def replace_day(as_of: date, rows: list[dict], client=None) -> int:
    """기준일 행을 지우고 rows 를 넣는다. rows 가 비면 아무것도 하지 않는다(기존 데이터 보존)."""
    if not rows:
        return 0
    cl = client or get_client()
    cl.command(f"DELETE FROM {CLICKHOUSE_DB}.chart_pattern_daily WHERE date = %(d)s", parameters={"d": as_of})
    cl.insert(f"{CLICKHOUSE_DB}.chart_pattern_daily", [[r.get(c) for c in ROW_COLUMNS] for r in rows],
              column_names=ROW_COLUMNS)
    return len(rows)

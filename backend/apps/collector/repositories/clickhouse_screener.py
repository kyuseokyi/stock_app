"""스크리너 CH 입출력 — 일봉 로드(고가·저가 포함)·최신 연간 재무 로드·screener_daily 적재.

결과 테이블은 ReplacingMergeTree(ingested_at): 같은 (date, ticker) 를 다시 계산하면 최신 행이 남는다(멱등, 조회는 FINAL).
daily_prices 에 컬럼을 더하지 않는다 — 일봉 30일 겹침 재수집이 다른 단계가 채운 컬럼을 NULL 로 덮기 때문.
"""
from __future__ import annotations

from datetime import date

from apps.collector.repositories.clickhouse_canslim import _since, latest_trading_date, trading_dates  # noqa: F401
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

ROW_COLUMNS = [
    "date", "ticker", "market", "sector_m", "close", "chg_1d", "volume", "value", "mcap", "vol_ratio20", "rsi14",
    "ma5", "ma20", "ma50", "ma60", "ma120", "std20", "ma_order", "high_52w_prev", "is_new_high", "gc_days",
    "vp_above_pct", "roe", "eps", "per", "pbr", "sales_growth", "op_growth", "debt_ratio", "liquid",
]

DAILY_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.screener_daily
(
    date Date,
    ticker String,
    market LowCardinality(String),
    sector_m String,
    close Float64,
    chg_1d Nullable(Float64),
    volume Float64,
    value Float64,
    mcap Nullable(Float64),
    vol_ratio20 Nullable(Float64),
    rsi14 Nullable(Float64),
    ma5 Nullable(Float64),
    ma20 Nullable(Float64),
    ma50 Nullable(Float64),
    ma60 Nullable(Float64),
    ma120 Nullable(Float64),
    std20 Nullable(Float64),
    ma_order Int8,
    high_52w_prev Nullable(Float64),
    is_new_high UInt8,
    gc_days Nullable(Int16),
    vp_above_pct Nullable(Float64),
    roe Nullable(Float64),
    eps Nullable(Float64),
    per Nullable(Float64),
    pbr Nullable(Float64),
    sales_growth Nullable(Float64),
    op_growth Nullable(Float64),
    debt_ratio Nullable(Float64),
    liquid UInt8,
    ingested_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(date)
ORDER BY (date, ticker)
"""

_FIN_FIELDS = ("eps", "bps", "roe", "sales_growth", "op_growth", "debt_ratio")


def ensure_screener_table(client=None) -> None:
    (client or get_client()).command(DAILY_DDL)


def _rows(sql: str, params: dict | None, client) -> list:
    return (client or get_client()).query(sql, parameters=params or {}).result_rows


def load_bars(as_of: date, days: int = 400, client=None) -> dict[str, list[tuple]]:
    """{ticker: [(date, high, low, close, volume)]} — as_of 이하 최근 days(달력일 ≈ 275거래일), 날짜 오름차순."""
    rows = _rows(f"SELECT ticker, date, high, low, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL "
                 "WHERE date <= %(d)s AND date > %(since)s", {"d": as_of, "since": _since(as_of, days)}, client)
    out: dict[str, list[tuple]] = {}
    for ticker, d, high, low, close, volume in rows:
        out.setdefault(ticker, []).append((d, float(high), float(low), float(close), float(volume)))
    for bars in out.values():
        bars.sort(key=lambda b: b[0])
    return out


def load_fundamentals(client=None) -> dict[str, dict]:
    """{ticker: {yymm, eps, bps, roe, sales_growth, op_growth, debt_ratio}} — 연간(Y) 최신 결산월 한 행.
    분기(Q) 누적 여부가 확인되지 않아 연간만 쓴다. 과거 기준일 백필도 최신 값을 쓴다."""
    rows = _rows(f"SELECT ticker, stac_yymm, eps, bps, roe, sales_growth, op_growth, debt_ratio "
                 f"FROM {CLICKHOUSE_DB}.fundamentals_periodic FINAL WHERE period = 'Y' ORDER BY ticker, stac_yymm",
                 None, client)
    out: dict[str, dict] = {}
    for ticker, ym, *vals in rows:
        out[ticker] = {"yymm": ym, **dict(zip(_FIN_FIELDS, vals))}  # 오름차순이라 마지막 = 최신
    return out


def upsert_rows(rows: list[dict], client=None) -> int:
    if not rows:
        return 0
    (client or get_client()).insert(f"{CLICKHOUSE_DB}.screener_daily",
                                    [[r.get(c) for c in ROW_COLUMNS] for r in rows], column_names=ROW_COLUMNS)
    return len(rows)

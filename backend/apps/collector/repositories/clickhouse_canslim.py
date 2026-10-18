"""CANSLIM CH 입출력 — 계산 입력 로드(일봉·지수·수급·재무)와 결과 적재(canslim_daily·canslim_market).

결과 테이블은 ReplacingMergeTree(ingested_at): 같은 (date, ticker) 를 다시 계산하면 최신 행이 남는다(멱등).
"""
from __future__ import annotations

from datetime import date, timedelta

from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

_EPOCH = date(1970, 1, 1)
INDEX_CODES = {"KR:0001": "KOSPI", "KR:1001": "KOSDAQ"}

ROW_COLUMNS = [
    "date", "ticker", "market", "sector_m", "close", "score", "pass_count", "liquid",
    "c", "a", "n", "s", "l", "i", "m",
    "c_growth", "c_quarter", "c_turnaround", "a_cagr", "a_roe", "n_pct_from_high", "n_high_52w", "s_ud_ratio",
    "l_rs", "l_rs_raw", "sector_rs_rank", "sector_rs_count", "i_net_qty", "i_buy_days", "m_dist_days",
    "avg_value_20d",
]
MARKET_COLUMNS = ["date", "market", "close", "ma50", "ma200", "dist_days", "status"]

DAILY_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.canslim_daily
(
    date Date,
    ticker String,
    market LowCardinality(String),
    sector_m String,
    close Float64,
    score UInt8,
    pass_count UInt8,
    liquid UInt8,
    c Int8,
    a Int8,
    n Int8,
    s Int8,
    l Int8,
    i Int8,
    m Int8,
    c_growth Nullable(Float64),
    c_quarter String,
    c_turnaround UInt8,
    a_cagr Nullable(Float64),
    a_roe Nullable(Float64),
    n_pct_from_high Nullable(Float64),
    n_high_52w Nullable(Float64),
    s_ud_ratio Nullable(Float64),
    l_rs Nullable(UInt8),
    l_rs_raw Nullable(Float64),
    sector_rs_rank Nullable(UInt16),
    sector_rs_count Nullable(UInt16),
    i_net_qty Nullable(Float64),
    i_buy_days Nullable(UInt8),
    m_dist_days Nullable(Float64),
    avg_value_20d Nullable(Float64),
    ingested_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(date)
ORDER BY (date, ticker)
"""

MARKET_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.canslim_market
(
    date Date,
    market LowCardinality(String),
    close Float64,
    ma50 Float64,
    ma200 Float64,
    dist_days UInt8,
    status String,
    ingested_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (date, market)
"""


def ensure_canslim_tables(client=None) -> None:
    c = client or get_client()
    c.command(DAILY_DDL)
    c.command(MARKET_DDL)


def _since(as_of: date, days: int) -> date:
    # 날짜 파라미터는 문자열로 바인딩돼 CH 안에서 '2026-08-18' - 400 같은 연산이 안 된다 — 파이썬에서 계산
    return as_of - timedelta(days=int(days))


def _rows(sql: str, params: dict | None, client) -> list:
    return (client or get_client()).query(sql, parameters=params or {}).result_rows


def latest_trading_date(client=None) -> date | None:
    rows = _rows(f"SELECT max(date) FROM {CLICKHOUSE_DB}.daily_prices", None, client)
    d = rows[0][0] if rows else None
    return None if d is None or d == _EPOCH else d


def trading_dates(as_of: date, n: int, client=None) -> list[date]:
    """as_of 이하 최근 n 개 거래일(오래된 → 최신)."""
    rows = _rows(f"SELECT DISTINCT date FROM {CLICKHOUSE_DB}.daily_prices WHERE date <= %(d)s "
                 "ORDER BY date DESC LIMIT %(n)s", {"d": as_of, "n": int(n)}, client)
    return sorted(r[0] for r in rows)


def load_bars(as_of: date, days: int = 400, client=None) -> dict[str, list[tuple]]:
    """{ticker: [(date, high, close, volume)]} — as_of 이하 최근 days(달력일), 날짜 오름차순."""
    rows = _rows(f"SELECT ticker, date, high, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL "
                 "WHERE date <= %(d)s AND date > %(since)s", {"d": as_of, "since": _since(as_of, days)}, client)
    out: dict[str, list[tuple]] = {}
    for ticker, d, high, close, volume in rows:
        out.setdefault(ticker, []).append((d, float(high), float(close), float(volume)))
    for bars in out.values():
        bars.sort(key=lambda b: b[0])
    return out


def load_index_bars(as_of: date, days: int = 400, client=None) -> dict[str, list[tuple]]:
    """{KOSPI|KOSDAQ: [(close, volume)]} — 날짜 오름차순."""
    rows = _rows(f"SELECT code, date, close, volume FROM {CLICKHOUSE_DB}.market_index_daily FINAL "
                 "WHERE code IN %(codes)s AND date <= %(d)s AND date > %(since)s ORDER BY code, date",
                 {"codes": tuple(INDEX_CODES), "d": as_of, "since": _since(as_of, days)}, client)
    out: dict[str, list[tuple]] = {}
    for code, _d, close, volume in rows:
        out.setdefault(INDEX_CODES[code], []).append((float(close), None if volume is None else float(volume)))
    return out


def load_investor(as_of: date, days: int = 45, client=None) -> dict[str, list[int]]:
    """{ticker: [기관+외국인 순매수 수량]} — as_of 이하 최근(날짜 오름차순). 판정은 마지막 20거래일."""
    rows = _rows(f"SELECT ticker, date, frgn_qty + orgn_qty FROM {CLICKHOUSE_DB}.investor_daily FINAL "
                 "WHERE date <= %(d)s AND date > %(since)s ORDER BY ticker, date",
                 {"d": as_of, "since": _since(as_of, days)}, client)
    out: dict[str, list[int]] = {}
    for ticker, _d, net in rows:
        out.setdefault(ticker, []).append(int(net))
    return out


def load_fundamentals(client=None) -> dict[str, dict[str, list[tuple]]]:
    """{ticker: {"Y": [(yymm, eps, roe)], "Q": [(yymm, eps)]}} — 최신 수집값(과거 기준일도 같은 값 사용)."""
    rows = _rows(f"SELECT ticker, period, stac_yymm, eps, roe FROM {CLICKHOUSE_DB}.fundamentals_periodic FINAL "
                 "ORDER BY ticker, period, stac_yymm", None, client)
    out: dict[str, dict[str, list[tuple]]] = {}
    for ticker, period, ym, eps, roe in rows:
        bucket = out.setdefault(ticker, {"Y": [], "Q": []})
        if period == "Y":
            bucket["Y"].append((ym, eps, roe))
        elif period == "Q":
            bucket["Q"].append((ym, eps))
    return out


def upsert_rows(rows: list[dict], client=None) -> int:
    if not rows:
        return 0
    (client or get_client()).insert(f"{CLICKHOUSE_DB}.canslim_daily", [[r.get(c) for c in ROW_COLUMNS] for r in rows],
                                    column_names=ROW_COLUMNS)
    return len(rows)


def upsert_markets(markets: list[dict], client=None) -> int:
    if not markets:
        return 0
    (client or get_client()).insert(f"{CLICKHOUSE_DB}.canslim_market",
                                    [[m.get(c) for c in MARKET_COLUMNS] for m in markets], column_names=MARKET_COLUMNS)
    return len(markets)

"""스크리너 CH 입출력 — 일봉 로드(고가·저가 포함)·최신 연간 재무 로드·screener_daily 적재.

결과 테이블은 ReplacingMergeTree(ingested_at): 같은 (date, ticker) 를 다시 계산하면 최신 행이 남는다(멱등, 조회는 FINAL).
daily_prices 에 컬럼을 더하지 않는다 — 일봉 30일 겹침 재수집이 다른 단계가 채운 컬럼을 NULL 로 덮기 때문.
"""
from __future__ import annotations

from datetime import date

from apps.collector.canslim.rules import closed_years
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
_FLOW_FIELDS = frozenset({"eps", "roe", "sales_growth", "op_growth"})  # 한 해 동안의 값 — 결산이 끝난 해만
_STOCK_FIELDS = frozenset({"bps", "debt_ratio"})                     # 시점 값 — 최신 행까지


def ensure_screener_table(client=None) -> None:
    (client or get_client()).command(DAILY_DDL)


def _rows(sql: str, params: dict | None, client) -> list:
    return (client or get_client()).query(sql, parameters=params or {}).result_rows


def load_bars(as_of: date, days: int = 400, client=None, tickers=None) -> dict[str, list[tuple]]:
    """{ticker: [(date, high, low, close, volume)]} — as_of 이하 최근 days(달력일 ≈ 275거래일), 날짜 오름차순.
    tickers 를 주면 그 종목만 읽는다(분석 대상 밖 종목 제외). 빈 목록이면 조회 없이 {}."""
    sql = (f"SELECT ticker, date, high, low, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL "
           "WHERE date <= %(d)s AND date > %(since)s")
    params: dict = {"d": as_of, "since": _since(as_of, days)}
    if tickers is not None:
        if not tickers:
            return {}
        sql += " AND ticker IN %(tickers)s"
        params["tickers"] = tuple(tickers)
    out: dict[str, list[tuple]] = {}
    for ticker, d, high, low, close, volume in _rows(sql, params, client):
        out.setdefault(ticker, []).append((d, float(high), float(low), float(close), float(volume)))
    for bars in out.values():
        bars.sort(key=lambda b: b[0])
    return out


def slice_bars(bars: dict[str, list[tuple]], as_of: date, days: int = 400) -> dict[str, list[tuple]]:
    """한 번 읽은 봉에서 load_bars(as_of, days) 와 같은 범위(as_of 이하, as_of-days 초과)만 잘라낸다."""
    since = _since(as_of, days)
    out = {}
    for ticker, rows in bars.items():
        cut = [b for b in rows if since < b[0] <= as_of]
        if cut:
            out[ticker] = cut
    return out


def load_fundamentals(client=None) -> dict[str, dict]:
    """{ticker: {yymm, eps, bps, roe, sales_growth, op_growth, debt_ratio}} — 연간(Y), 필드별로 null 이 아닌 가장 최근 값.

    KIS 연간 응답의 최신 행은 진행 중인 해의 누적(예: 202606 = 상반기)이라 그대로 쓰면 PER 이 약 2배가 된다.
    → 기간 값(EPS·ROE·매출·영업이익 성장)은 결산이 끝난 해만(`rules.closed_years`), 시점 값(BPS·부채비율)은
    재무상태표 기준이라 최신 행까지 쓴다. yymm 은 결산이 끝난 가장 최근 해. 최신 행의 일부 값이 비면 이전 값으로 채운다.
    분기(Q)는 누적 여부가 확인되지 않아 쓰지 않는다. 과거 기준일 백필도 최신 값을 쓴다."""
    rows = _rows(f"SELECT ticker, stac_yymm, eps, bps, roe, sales_growth, op_growth, debt_ratio "
                 f"FROM {CLICKHOUSE_DB}.fundamentals_periodic FINAL WHERE period = 'Y' ORDER BY ticker, stac_yymm",
                 None, client)
    by_ticker: dict[str, list[tuple]] = {}
    for r in rows:
        by_ticker.setdefault(r[0], []).append(tuple(r[1:]))
    out: dict[str, dict] = {}
    for ticker, trows in by_ticker.items():
        closed = closed_years(trows)
        cur = {"yymm": (closed or trows)[-1][0], **dict.fromkeys(_FIN_FIELDS)}
        for src, fields in ((closed, _FLOW_FIELDS), (trows, _STOCK_FIELDS)):
            for ym, *vals in src:  # 오름차순이라 뒤 행이 최신 — null 이 아닌 값만 덮어쓴다
                for k, v in zip(_FIN_FIELDS, vals):
                    if k in fields and v is not None:
                        cur[k] = v
        out[ticker] = cur
    return out


def upsert_rows(rows: list[dict], client=None) -> int:
    if not rows:
        return 0
    (client or get_client()).insert(f"{CLICKHOUSE_DB}.screener_daily",
                                    [[r.get(c) for c in ROW_COLUMNS] for r in rows], column_names=ROW_COLUMNS)
    return len(rows)

"""종목별 대차잔고 추이 조회 — CH stock_lending_daily(키움 ka20068, 수집은 collector.collect_lending_daily).

공개 REST `GET /api/v1/stocks/{ticker}/lending` 이 쓴다. 최근 days 행을 오래된 순으로 돌려준다.
데이터가 없으면(개발 서버 — 키움 키 없음) 빈 목록. 금액은 원(키움 백만원 × 1e6 으로 적재됨).
"""
from __future__ import annotations

from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

DEFAULT_DAYS = 120
MAX_DAYS = 500


def clamp_days(days: int | None) -> int:
    """행 수 상한 — 없으면 DEFAULT_DAYS, 1~MAX_DAYS 로 자른다."""
    if days is None:
        return DEFAULT_DAYS
    return max(1, min(MAX_DAYS, int(days)))


def fetch_rows(ticker: str, limit: int, client=None) -> list[tuple]:
    """(date, balance_qty, net_qty, balance_amt) — 최신 limit 행(최신 → 과거)."""
    sql = (f"SELECT date, balance_qty, net_qty, balance_amt FROM {CLICKHOUSE_DB}.stock_lending_daily FINAL "
           "WHERE ticker = %(t)s ORDER BY date DESC LIMIT %(n)s")
    return (client or get_client()).query(sql, parameters={"t": ticker, "n": int(limit)}).result_rows


def lending_trend(ticker: str, days: int | None = DEFAULT_DAYS, client=None) -> list[dict]:
    """[{date: 'YYYY-MM-DD', balance_qty, net_qty, balance_amt}] 오래된 순. 행이 없으면 []."""
    rows = fetch_rows(ticker, clamp_days(days), client)
    return [{"date": d.isoformat(), "balance_qty": int(bq), "net_qty": int(nq), "balance_amt": int(ba)}
            for d, bq, nq, ba in reversed(rows)]

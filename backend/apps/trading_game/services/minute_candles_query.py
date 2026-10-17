"""게임 분봉 조회(ClickHouse game_minute_bars FINAL) — 1분봉을 n분 단위로 묶는다.

범위: 데이터가 있는 최근 거래일 N일(1m=2·5m=5·15m=10·60m=30 — 60분봉은 60선 워밍업 포함).
t = 버킷 시작 epoch seconds(UTC) — SQL 에서 toUnixTimestamp 로 계산(타임존 해석 차이 방지).
"""
from __future__ import annotations

from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

# interval → (묶음 분, 최근 거래일 수)
INTERVALS: dict[str, tuple[int, int]] = {"1m": (1, 2), "5m": (5, 5), "15m": (15, 10), "60m": (60, 30)}


def build_sql(interval: str, db: str = CLICKHOUSE_DB) -> str:
    minutes, days = INTERVALS[interval]  # KeyError = 잘못된 단위(라우터가 먼저 422)
    src = f"{db}.game_minute_bars FINAL"
    return (
        "SELECT toUnixTimestamp(b) AS t, argMin(open, ts), max(high), min(low), argMax(close, ts), sum(volume) "
        f"FROM (SELECT ts, open, high, low, close, volume, toStartOfInterval(ts, INTERVAL {minutes} MINUTE) AS b "
        f"FROM {src} WHERE ticker = %(t)s AND toDate(ts) >= ("
        f"SELECT min(d) FROM (SELECT DISTINCT toDate(ts) AS d FROM {src} WHERE ticker = %(t)s "
        f"ORDER BY d DESC LIMIT {days}))) "
        "GROUP BY b ORDER BY b"
    )


def rows_to_candles(rows) -> list[dict]:
    return [
        {"t": int(t), "open": float(o), "high": float(h), "low": float(lo), "close": float(c), "volume": int(v)}
        for t, o, h, lo, c, v in rows
    ]


def fetch_candles(ticker: str, interval: str, client=None, db: str = CLICKHOUSE_DB) -> list[dict]:
    """동기 조회(스레드에서 호출). CH 예외는 그대로 올린다(서비스가 503 으로)."""
    rows = (client or get_client()).query(build_sql(interval, db), parameters={"t": ticker}).result_rows
    return rows_to_candles(rows)


def build_session_sql(db: str = CLICKHOUSE_DB) -> str:
    """데이터가 있는 가장 최근 거래일(KST, ts 가 Asia/Seoul) 1분봉 → 하루 봉 1개.

    일봉(daily_prices)은 20:30 수집 후에야 오늘 행이 생기므로 그 전 일봉 차트의 오늘 봉을 이 값으로 채운다.
    """
    src = f"{db}.game_minute_bars FINAL"
    return (
        "SELECT toString(toDate(ts)) AS d, argMin(open, ts), max(high), min(low), argMax(close, ts), sum(volume) "
        f"FROM {src} WHERE ticker = %(t)s AND toDate(ts) = ("
        f"SELECT max(toDate(ts)) FROM {src} WHERE ticker = %(t)s) "
        "GROUP BY d"
    )


def fetch_session_bar(ticker: str, client=None, db: str = CLICKHOUSE_DB) -> dict | None:
    """{"date","open","high","low","close","volume"} 또는 분봉이 없으면 None. CH 예외는 그대로 올린다."""
    rows = (client or get_client()).query(build_session_sql(db), parameters={"t": ticker}).result_rows
    if not rows:
        return None
    d, o, h, lo, c, v = rows[0]
    return {"date": str(d), "open": float(o), "high": float(h), "low": float(lo), "close": float(c), "volume": int(v)}

"""ClickHouse 실데이터 조회 소스 (stock_api 읽기 전용).

daily_prices(FINAL)에서 종목 OHLCV를 읽어 chart.Candle 로 반환.
수집된 종목이면 실데이터, 없으면 None(→ 온더플라이 폴백).
"""

from __future__ import annotations

from apps.stock_api.services.chart import Candle
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client


def get_candles(symbol: str, start_date: str, end_date: str) -> list[Candle] | None:
    """ClickHouse에 해당 종목 데이터가 있으면 Candle 리스트, 없으면 None."""
    try:
        rows = (
            get_client()
            .query(
                f"SELECT date, open, high, low, close, volume "
                f"FROM {CLICKHOUSE_DB}.daily_prices FINAL "
                "WHERE ticker = %(t)s AND date BETWEEN %(s)s AND %(e)s ORDER BY date",
                parameters={"t": symbol, "s": start_date, "e": end_date},
            )
            .result_rows
        )
    except Exception:
        return None  # CH 장애 시 온더플라이로 폴백

    if not rows:
        return None
    return [
        Candle(
            date=d.isoformat(),
            open=float(o),
            high=float(h),
            low=float(lo),
            close=float(c),
            volume=int(v),
        )
        for d, o, h, lo, c, v in rows
    ]

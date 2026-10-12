"""과열 판단용 Wilder RSI(14) — 일봉 종가(오늘 이전) + 실시간 현재가 (Phase 5a).

종가 배열은 하루 단위로 Redis 에 캐시해 주문마다 ClickHouse 를 치지 않는다.
모든 실패는 None(넛지 미발생)으로 흡수한다 — 주문 경로를 막지 않는 best-effort.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Awaitable, Callable, Sequence
from zoneinfo import ZoneInfo

log = logging.getLogger("trading_game.rsi")

KST = ZoneInfo("Asia/Seoul")
RSI_PERIOD = 14
CLOSES_LOOKBACK = 100          # Wilder 평활 수렴용 (MTS 값과 근사)
CALENDAR_SPAN_DAYS = 200       # 영업일 100개 이상 확보용 달력 구간
CACHE_TTL_SECONDS = 26 * 3600

ClosesProvider = Callable[[str, date], Awaitable[list[float]]]


def wilder_rsi(closes: Sequence[float], period: int = RSI_PERIOD) -> float | None:
    """Wilder RSI. 첫 period 개 변화량 단순평균으로 시드 → 이후 (prev*(p-1)+x)/p 평활."""
    if len(closes) < period + 1:
        return None
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    avg_gain = sum(max(c, 0.0) for c in changes[:period]) / period
    avg_loss = sum(max(-c, 0.0) for c in changes[:period]) / period
    for c in changes[period:]:
        avg_gain = (avg_gain * (period - 1) + max(c, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-c, 0.0)) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)


def _fetch_closes_from_clickhouse(ticker: str, today: date) -> list[float]:
    # 의도적 cross-app import(collector settle_season 과 동일 선례) — get_candles 가
    # stock_api GraphQL Candle 타입을 반환해 shared 로 옮기지 않는다. 지연 import 로 결합 최소화.
    from apps.stock_api.services import clickhouse_source

    start = (today - timedelta(days=CALENDAR_SPAN_DAYS)).isoformat()
    end = (today - timedelta(days=1)).isoformat()
    candles = clickhouse_source.get_candles(ticker, start, end) or []
    closes = [float(c.close) for c in candles if str(c.date)[:10] < today.isoformat()]
    return closes[-CLOSES_LOOKBACK:]


async def clickhouse_closes(ticker: str, today: date) -> list[float]:
    """동기 ClickHouse 조회를 스레드로 위임(이벤트 루프 블로킹 방지)."""
    return await asyncio.to_thread(_fetch_closes_from_clickhouse, ticker, today)


def _cache_key(ticker: str, today: date) -> str:
    return f"game:rsi:closes:{ticker}:{today:%Y%m%d}"


async def current_rsi(
    redis,
    ticker: str,
    live_price: Decimal,
    *,
    today: date | None = None,
    closes_provider: ClosesProvider = clickhouse_closes,
) -> float | None:
    """오늘 이전 종가(캐시) + live_price 로 RSI 계산. 실패·데이터 부족 시 None."""
    today = today or datetime.now(KST).date()
    key = _cache_key(ticker, today)
    try:
        raw = await redis.get(key)
        if raw is not None:
            closes = [float(x) for x in json.loads(raw)]
        else:
            closes = await closes_provider(ticker, today)
            if closes:  # 빈 결과는 캐시하지 않음(수집 지연 시 재시도)
                await redis.set(key, json.dumps(closes), ex=CACHE_TTL_SECONDS)
        return wilder_rsi([*closes, float(live_price)])
    except Exception:
        log.warning("RSI 계산 실패 ticker=%s — 넛지 생략", ticker, exc_info=True)
        return None

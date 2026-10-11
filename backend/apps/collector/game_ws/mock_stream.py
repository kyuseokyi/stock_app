"""Mock 실시간 틱 생성기.

장외/휴장/KIS 키 미설정 시 가상 틱을 발행해 전체 파이프라인을 검증한다.
next_tick 은 순수 함수(테스트용), mock_ticks 는 asyncio 래퍼.
"""
from __future__ import annotations

import asyncio
import random
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def next_tick(ticker: str, prev_price: float, base_price: float) -> tuple[float, dict]:
    """직전가 기준 ±0.1~0.3% 변동한 다음 틱을 생성. (새 가격, tick dict) 반환."""
    step = random.choice([-1, 1]) * random.uniform(0.001, 0.003)
    new_price = max(1.0, prev_price * (1 + step))
    price_int = int(round(new_price))
    tick = {
        "ticker": ticker,
        "price": price_int,
        "change_price": int(round(new_price - base_price)),
        "change_rate": round((new_price / base_price - 1) * 100, 2),
        "volume": 0,  # Mock 은 누적량 미집계
        "timestamp": datetime.now(KST).isoformat(),
    }
    return new_price, tick


async def mock_ticks(ticker: str, base_price: float, stop: asyncio.Event | None = None):
    """초당 1~3틱을 무한 생성하는 async 제너레이터."""
    price = float(base_price)
    while stop is None or not stop.is_set():
        n = random.randint(1, 3)
        for _ in range(n):
            price, tick = next_tick(ticker, price, base_price)
            yield tick
            await asyncio.sleep(1.0 / n)

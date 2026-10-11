"""트레이딩 게임 실시간 시세 수집 데몬.

ACTIVE 시즌의 종목을 1회 조회해 구독 대상으로 고정한다(시즌 교체 시 재시작).
MOCK_TICK_STREAM=true 또는 KIS 키 미설정이면 Mock 생성기로, 아니면 실 KIS WS 로
분기한다. 각 틱을 Redis stock:tick:{ticker} 로 발행한다.

실행:
    uv run python -m apps.collector.run_game_ws
    MOCK_TICK_STREAM=true uv run python -m apps.collector.run_game_ws
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.game_models import GameSeason
from shared.kis_config import get_kis_config
from apps.collector.game_ws.mock_stream import mock_ticks
from apps.collector.game_ws.publisher import TickPublisher
from apps.collector.kis.ws_client import KISWebSocketClient
from apps.collector.kis.ws_parser import parse_message

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("run_game_ws")

KST = timezone(timedelta(hours=9))


async def _active_season_ticker() -> str | None:
    async with AsyncSessionLocal() as db:
        s = (
            await db.execute(
                select(GameSeason).where(GameSeason.status == "ACTIVE").order_by(GameSeason.id)
            )
        ).scalars().first()
        return s.ticker if s else None


def _payload_from_parsed(tick: dict) -> dict:
    """파서 tick(time=HHMMSS)을 발행 payload(timestamp ISO)로 변환."""
    hhmmss = tick["time"]
    now = datetime.now(KST)
    try:
        ts = now.replace(
            hour=int(hhmmss[0:2]), minute=int(hhmmss[2:4]),
            second=int(hhmmss[4:6]), microsecond=0,
        ).isoformat()
    except (ValueError, IndexError):
        ts = now.isoformat()
    return {
        "ticker": tick["ticker"],
        "price": tick["price"],
        "change_price": tick["change_price"],
        "change_rate": tick["change_rate"],
        "volume": tick["volume"],
        "timestamp": ts,
    }


async def run() -> None:
    ticker = await _active_season_ticker()
    if not ticker:
        log.error("ACTIVE 시즌이 없습니다. 시드(scripts.seed_trading_game) 후 재시도하세요.")
        return

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    publisher = TickPublisher(redis_url)
    stop = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    cfg = get_kis_config()
    use_mock = os.getenv("MOCK_TICK_STREAM", "").lower() == "true" or not cfg.is_configured
    base_price = float(os.getenv("MOCK_BASE_PRICE", "71500"))

    log.info("수집 시작: ticker=%s mock=%s", ticker, use_mock)
    try:
        if use_mock:
            async for tick in mock_ticks(ticker, base_price, stop):
                await publisher.publish(tick)
                if stop.is_set():
                    break
        else:
            client = KISWebSocketClient(cfg, ticker, redis_url)
            async for raw in client.stream():
                if stop.is_set():
                    break
                parsed = parse_message(raw)
                if not parsed:
                    continue
                for t in parsed:
                    await publisher.publish(_payload_from_parsed(t))
    finally:
        await publisher.close()
        log.info("수집 데몬 종료")


if __name__ == "__main__":
    asyncio.run(run())

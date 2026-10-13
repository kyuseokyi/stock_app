"""트레이딩 게임 실시간 시세 수집 데몬.

ACTIVE 시즌 종목을 주기적으로(GAME_WS_SEASON_POLL_SEC, 기본 60초) 확인해, 종목이 바뀌면
구독을 새 종목으로 교체한다(월말 시즌 롤오버 시 수동 재시작 불필요). 시즌이 없으면 종료하지 않고
기다리며, 구독 태스크가 예외로 끝나면 다음 확인 때 다시 시작한다.
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
from collections.abc import Awaitable, Callable
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
                # trading_game(account_service.get_active_season)과 같은 기준 — 최신 ACTIVE
                select(GameSeason).where(GameSeason.status == "ACTIVE").order_by(GameSeason.id.desc())
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


async def _consume(use_mock, cfg, ticker, base_price, redis_url, publisher) -> None:
    if use_mock:
        async for tick in mock_ticks(ticker, base_price):
            await publisher.publish(tick)
    else:
        client = KISWebSocketClient(cfg, ticker, redis_url)
        async for raw in client.stream():
            parsed = parse_message(raw)
            if not parsed:
                continue
            for t in parsed:
                await publisher.publish(_payload_from_parsed(t))


async def _finish(task: asyncio.Task | None) -> None:
    """구독 태스크를 취소하고 끝날 때까지 기다린다(예외는 로그만)."""
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa: BLE001
        log.exception("수집 태스크 예외")


async def supervise(
    get_ticker: Callable[[], Awaitable[str | None]],
    start_consumer: Callable[[str], asyncio.Task],
    stop: asyncio.Event,
    poll_sec: float,
) -> None:
    """활성 시즌 종목을 poll_sec 마다 확인해 구독을 맞춘다. stop 이 설정되면 정리 후 반환."""
    current: str | None = None
    task: asyncio.Task | None = None
    try:
        while not stop.is_set():
            try:
                ticker = await get_ticker()
            except Exception:  # noqa: BLE001 — DB 일시 장애: 현재 구독 유지, 다음 주기 재시도
                log.exception("활성 시즌 조회 실패 — 다음 주기 재시도")
                ticker = current
            if ticker != current:
                await _finish(task)
                task = None
                current = ticker
                if ticker:
                    log.info("구독 시작/교체: ticker=%s", ticker)
                else:
                    log.warning("ACTIVE 시즌 없음 — 시즌 생성 대기")
            if current and (task is None or task.done()):
                if task is not None:
                    await _finish(task)  # 끝난 태스크의 예외를 로그로 회수
                    log.warning("구독 태스크 종료 — 재시작: ticker=%s", current)
                task = start_consumer(current)
            try:
                await asyncio.wait_for(stop.wait(), timeout=poll_sec)
            except asyncio.TimeoutError:
                pass
    finally:
        await _finish(task)


async def run() -> None:
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    publisher = TickPublisher(redis_url)
    stop = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    cfg = get_kis_config()
    use_mock = os.getenv("MOCK_TICK_STREAM", "").lower() == "true" or not cfg.is_configured
    base_price = float(os.getenv("MOCK_BASE_PRICE", "71500"))
    poll_sec = float(os.getenv("GAME_WS_SEASON_POLL_SEC", "60"))

    def start_consumer(ticker: str) -> asyncio.Task:
        log.info("수집 시작: ticker=%s mock=%s", ticker, use_mock)
        return asyncio.create_task(_consume(use_mock, cfg, ticker, base_price, redis_url, publisher))

    try:
        await supervise(_active_season_ticker, start_consumer, stop, poll_sec)
    finally:
        await publisher.close()
        log.info("수집 데몬 종료")


if __name__ == "__main__":
    asyncio.run(run())

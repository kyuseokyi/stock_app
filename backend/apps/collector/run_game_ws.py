"""트레이딩 게임 실시간 시세 수집 데몬.

ACTIVE 시즌 종목을 주기적으로(GAME_WS_SEASON_POLL_SEC, 기본 60초) 확인해, 종목이 바뀌면
구독을 새 종목으로 교체한다(월말 시즌 롤오버 시 수동 재시작 불필요). 시즌이 없으면 종료하지 않고
기다리며, 구독 태스크가 예외로 끝나면 다음 확인 때 다시 시작한다.
MOCK_TICK_STREAM=true 또는 KIS 키 미설정이면 Mock 생성기로, 아니면 실 KIS WS 로
분기한다. 각 틱을 Redis stock:tick:{ticker} 로 발행하고, 발행한 틱을 1분봉으로 묶어
ClickHouse game_minute_bars 에 저장한다(game_ws/minute_bars — 별도 태스크, 실패 무시).
시작·종목 전환 시 1회 오늘 09:00~첫 틱 이전 분봉을 KIS 당일분봉으로 보충한다(game_ws/kis_backfill).

실 KIS WS 체결 TR(CLAUDE.md "KIS 데이터 수집 규칙" UN→J 폴백의 실시간판):
- 기본 H0UNCNT0(통합 KRX+NXT) — NXT 애프터마켓(16:00~20:00)까지 틱 수신, 일봉 UN 종가와 일치.
- 구독 시작 시 REST 일봉 UN 프로브가 빈 응답(NXT 미상장)이면 H0STCNT0(KRX).
- 프로브 실패 시 UN 시도, UN 구독이 연속 거부되면 클라이언트가 H0STCNT0 로 런타임 폴백.
- GAME_WS_TR_ID=auto(기본)|H0UNCNT0|H0STCNT0|H0NXCNT0 로 강제 지정 가능(롤백용).
- UN 은 NXT 프리마켓·KRX 마감~애프터마켓 사이 체결도 보내므로, TRADING_WINDOWS(분 단위) 밖 틱은
  발행하지 않는다(tick_listener 의 틱별 자동청산·랭킹이 거래창 밖에서 돌지 않게).

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
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.game_models import GameSeason
from shared.kis_config import get_kis_config
from apps.collector.game_ws.kis_backfill import run_backfill
from apps.collector.game_ws.minute_bars import MinuteBarRecorder
from apps.collector.game_ws.mock_stream import mock_ticks
from apps.collector.game_ws.publisher import TickPublisher
from apps.collector.game_ws.tr_select import select_tr_id
from apps.collector.kis.ws_client import KISWebSocketClient
from apps.collector.kis.ws_parser import parse_message
from apps.trading_game.services import market_clock

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


def _in_window(now_kst: datetime, windows: list[tuple[time, time]]) -> bool:
    """거래창 판정(분 단위 절삭 — 15:30:xx 종가 단일가·20:00:xx 체결 포함)."""
    return market_clock.in_trading_window(now_kst.replace(second=0, microsecond=0), windows)


def _record(recorder, tick: dict) -> None:
    """발행한 틱을 분봉 집계기에 — 실패해도 발행 경로에 영향 없음."""
    if recorder is None:
        return
    try:
        recorder.record(tick)
    except Exception:  # noqa: BLE001
        log.exception("분봉 기록 실패(무시)")


async def _consume(use_mock, cfg, ticker, base_price, redis_url, publisher, recorder=None) -> None:
    if use_mock:
        async for tick in mock_ticks(ticker, base_price):
            await publisher.publish(tick)
            _record(recorder, tick)
    else:
        tr_id = await select_tr_id(ticker)
        client = KISWebSocketClient(cfg, ticker, redis_url, tr_id=tr_id)
        windows = market_clock.load_windows()
        async for raw in client.stream():
            parsed = parse_message(raw)
            if not parsed:
                continue
            if not _in_window(datetime.now(KST), windows):
                continue  # 거래창 밖(NXT 프리마켓 등) 틱 미발행
            for t in parsed:
                payload = _payload_from_parsed(t)
                await publisher.publish(payload)
                _record(recorder, payload)


def _should_record_bars(use_mock: bool, mock_opt_in: str | None) -> bool:
    return not use_mock or (mock_opt_in or "").lower() == "true"


def _claim_backfill(done: set[tuple[str, str]], ticker: str, now_kst: datetime) -> bool:
    """(종목, KST 날짜)당 1회만 — 구독 태스크 재시작(크래시)마다 KIS 를 다시 부르지 않게."""
    key = (ticker, now_kst.date().isoformat())
    if key in done:
        return False
    done.add(key)
    return True


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
    # 1분봉 저장(ClickHouse) — 별도 태스크, 실패해도 틱 발행 무관
    # Mock 틱은 기본 미저장(운영 차트 오염 방지) — 로컬 스모크만 GAME_MINUTE_BARS_MOCK=true
    record_bars = _should_record_bars(use_mock, os.getenv("GAME_MINUTE_BARS_MOCK"))
    recorder = MinuteBarRecorder()
    bars_stop = asyncio.Event()
    bars_task = asyncio.create_task(recorder.run(bars_stop))
    backfilled: set[tuple[str, str]] = set()
    side_tasks: set[asyncio.Task] = set()

    def start_consumer(ticker: str) -> asyncio.Task:
        log.info("수집 시작: ticker=%s mock=%s", ticker, use_mock)
        # 시작·종목 전환 시 당일 KIS 분봉 보충(Mock/키 없음이면 생략, 실패는 로그만)
        if not use_mock and _claim_backfill(backfilled, ticker, datetime.now(KST)):
            t = asyncio.create_task(asyncio.to_thread(run_backfill, ticker, lambda: recorder.first_minute(ticker)))
            side_tasks.add(t)
            t.add_done_callback(side_tasks.discard)
        return asyncio.create_task(
            _consume(use_mock, cfg, ticker, base_price, redis_url, publisher,
                     recorder=recorder if record_bars else None)
        )

    try:
        await supervise(_active_season_ticker, start_consumer, stop, poll_sec)
    finally:
        bars_stop.set()
        try:
            await asyncio.wait_for(bars_task, timeout=10)
        except Exception:  # noqa: BLE001
            log.warning("분봉 저장 종료 대기 실패(무시)")
        await publisher.close()
        log.info("수집 데몬 종료")


if __name__ == "__main__":
    asyncio.run(run())

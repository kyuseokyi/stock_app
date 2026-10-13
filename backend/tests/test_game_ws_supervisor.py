"""run_game_ws 시즌 감시 루프 — 시즌 종목 변경 시 구독 교체, 시즌 없음에도 종료하지 않음."""
from __future__ import annotations

import asyncio

from apps.collector import run_game_ws


async def _run_supervise(tickers: list[str | None], polls: int):
    """get_ticker 가 tickers 를 순서대로 돌려주고, polls 번 확인 후 stop."""
    seq = iter(tickers)
    last: dict[str, str | None] = {"t": None}
    started: list[str] = []
    tasks: list[tuple[str, asyncio.Task]] = []
    stop = asyncio.Event()
    calls = {"n": 0}

    async def get_ticker():
        calls["n"] += 1
        if calls["n"] >= polls:
            stop.set()
        try:
            last["t"] = next(seq)
        except StopIteration:
            pass
        return last["t"]

    def start_consumer(ticker: str) -> asyncio.Task:
        started.append(ticker)
        # 시작 직후(첫 실행 전) 취소될 수도 있으므로 코루틴 내부가 아닌 태스크 상태로 확인한다
        task = asyncio.create_task(asyncio.Event().wait())
        tasks.append((ticker, task))
        return task

    await run_game_ws.supervise(get_ticker, start_consumer, stop, poll_sec=0.01)
    cancelled = [t for t, task in tasks if task.cancelled()]
    return started, cancelled


async def test_switches_consumer_when_season_ticker_changes():
    started, cancelled = await _run_supervise(["005930", "005930", "000660", "000660"], polls=4)
    assert started == ["005930", "000660"]
    assert cancelled == ["005930", "000660"]  # 교체 시 1회 + 종료 시 정리 1회


async def test_waits_without_season_then_starts():
    started, cancelled = await _run_supervise([None, None, "005930"], polls=3)
    assert started == ["005930"]
    assert cancelled == ["005930"]


async def test_stops_consumer_when_season_disappears():
    started, cancelled = await _run_supervise(["005930", None, None], polls=3)
    assert started == ["005930"]
    assert cancelled == ["005930"]


async def test_restarts_consumer_that_crashed():
    stop = asyncio.Event()
    calls = {"n": 0}
    started: list[str] = []

    async def get_ticker():
        calls["n"] += 1
        if calls["n"] >= 3:
            stop.set()
        return "005930"

    def start_consumer(ticker: str) -> asyncio.Task:
        started.append(ticker)

        async def _boom():
            raise RuntimeError("ws 끊김")

        return asyncio.create_task(_boom())

    await run_game_ws.supervise(get_ticker, start_consumer, stop, poll_sec=0.01)
    assert len(started) >= 2  # 죽은 구독을 다음 확인 때 다시 시작

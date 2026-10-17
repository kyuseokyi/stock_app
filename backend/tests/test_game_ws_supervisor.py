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


async def test_consume_real_uses_selected_tr(monkeypatch):
    """실 KIS 경로: select_tr_id 결과 TR 로 WS 클라이언트를 만들고 파싱 틱을 발행한다."""
    made = {}

    async def fake_select(ticker):
        return "H0STCNT0"

    class FakeClient:
        def __init__(self, cfg, ticker, redis_url, tr_id, status_tr_id=None):
            made.update(ticker=ticker, tr_id=tr_id)

        async def stream(self):
            rec = ["0"] * 47
            rec[0], rec[1], rec[2], rec[3], rec[13] = "293490", "093000", "1000", "2", "5"
            yield "0|H0STCNT0|001|" + "^".join(rec)

    published = []

    class Pub:
        async def publish(self, tick):
            published.append(tick)

    monkeypatch.setattr(run_game_ws, "select_tr_id", fake_select)
    monkeypatch.setattr(run_game_ws, "KISWebSocketClient", FakeClient)
    monkeypatch.setattr(run_game_ws, "_in_window", lambda now, w: True)
    await run_game_ws._consume(False, object(), "293490", 0, "redis://x", Pub())
    assert made == {"ticker": "293490", "tr_id": "H0STCNT0"}
    assert [(t["ticker"], t["price"]) for t in published] == [("293490", 1000)]


def test_tick_window_gate_minute_granularity():
    """UN 은 NXT 프리마켓·15:30~16:00 체결도 보내므로 TRADING_WINDOWS 밖 틱은 발행하지 않는다."""
    from datetime import datetime

    from apps.trading_game.services.market_clock import KST, parse_windows

    w = parse_windows("09:00-15:30,16:00-20:00")
    at = lambda h, m, s=0: datetime(2026, 10, 13, h, m, s, tzinfo=KST)  # noqa: E731
    assert run_game_ws._in_window(at(8, 30), w) is False      # NXT 프리마켓
    assert run_game_ws._in_window(at(12, 0), w) is True
    assert run_game_ws._in_window(at(15, 30, 40), w) is True  # KRX 종가 단일가 체결(분 단위 포함)
    assert run_game_ws._in_window(at(15, 45), w) is False
    assert run_game_ws._in_window(at(17, 0), w) is True       # NXT 애프터마켓
    assert run_game_ws._in_window(at(20, 0, 30), w) is True
    assert run_game_ws._in_window(at(20, 1), w) is False


async def test_consume_real_drops_out_of_window_ticks(monkeypatch):
    async def fake_select(ticker):
        return "H0UNCNT0"

    class FakeClient:
        def __init__(self, cfg, ticker, redis_url, tr_id, status_tr_id=None):
            pass

        async def stream(self):
            rec = ["0"] * 47
            rec[0], rec[1], rec[2], rec[13] = "005930", "083000", "1000", "5"
            yield "0|H0UNCNT0|001|" + "^".join(rec)

    published = []

    class Pub:
        async def publish(self, tick):
            published.append(tick)

    monkeypatch.setattr(run_game_ws, "select_tr_id", fake_select)
    monkeypatch.setattr(run_game_ws, "KISWebSocketClient", FakeClient)
    monkeypatch.setattr(run_game_ws, "_in_window", lambda now, w: False)
    await run_game_ws._consume(False, object(), "005930", 0, "redis://x", Pub())
    assert published == []


# ---------------------------------------------------------------- 장운영정보(H0STMKO0) 라우팅
def _status_frame(ticker="005930", trht="N", mkop="112", vi="Y", ovtm="N", stat="00"):
    # 공식 명세 순서: 종목코드, 거래정지여부, 사유, 장운영구분, 예상장운영구분, 임의연장, 동시호가배분, 종목상태, VI, 시간외VI, 거래소
    return "0|H0STMKO0|001|" + "^".join([ticker, trht, "", mkop, "", "", "", stat, vi, ovtm, "K"])


async def test_consume_routes_status_frames_even_out_of_window(monkeypatch):
    from fakeredis import aioredis as fake_aioredis

    from apps.trading_game.services import market_status

    made = {}

    async def fake_select(ticker):
        return "H0UNCNT0"

    class FakeClient:
        def __init__(self, cfg, ticker, redis_url, tr_id, status_tr_id=None):
            made["status_tr_id"] = status_tr_id

        async def stream(self):
            yield _status_frame(vi="Y")

    redis = fake_aioredis.FakeRedis(decode_responses=True)

    class Pub:
        def __init__(self):
            self.redis = redis
            self.ticks = []

        async def publish(self, tick):
            self.ticks.append(tick)

    class Cfg:
        mode = "prod"

    monkeypatch.setattr(run_game_ws, "select_tr_id", fake_select)
    monkeypatch.setattr(run_game_ws, "KISWebSocketClient", FakeClient)
    monkeypatch.setattr(run_game_ws, "_in_window", lambda now, w: False)  # 거래창 밖이어도 상태는 반영
    pub = Pub()
    await run_game_ws._consume(False, Cfg(), "005930", 0, "redis://x", pub)
    assert made["status_tr_id"] == "H0STMKO0" and pub.ticks == []
    import time as _t
    assert (await market_status.read_status(redis, "005930", _t.time()))["state"] == "VI"


def test_status_tr_only_in_prod_and_switchable(monkeypatch):
    class Prod:
        mode = "prod"

    class Vps:
        mode = "vps"

    assert run_game_ws._status_tr_id(Prod()) == "H0STMKO0"
    assert run_game_ws._status_tr_id(Vps()) is None  # 모의투자 미지원
    monkeypatch.setenv("GAME_WS_MARKET_STATUS", "false")
    assert run_game_ws._status_tr_id(Prod()) is None


async def test_bad_status_frame_does_not_break_stream(monkeypatch, caplog):
    class Pub:
        redis = None  # 쓰이면 예외 — 해석 실패라 쓰이지 않아야 한다

    await run_game_ws._handle_status(Pub(), "005930", "0|H0STMKO0|001|a^b^c")
    assert "해석 실패" in caplog.text

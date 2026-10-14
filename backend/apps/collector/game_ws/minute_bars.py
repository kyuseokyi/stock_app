"""게임 틱 → 1분봉 집계·저장(ClickHouse game_minute_bars, source='tick').

- MinuteBarAggregator: 순수 집계기. 분이 바뀌면 직전 분 확정 바 반환, snapshot() 은 진행 중 바.
  틱 시각 = 발행 payload 의 timestamp(KIS 체결시각 HHMMSS + 오늘 KST, Mock 은 생성 시각) →
  없으면 time(HHMMSS) → 그래도 없으면 수신 시각. 현재 분보다 이른 틱(지각 도착)은 무시.
  거래량 = 누적 거래량(volume) 증분 합(첫 틱·누적 감소 시 0, 기준 재설정).
- MinuteBarRecorder: record() 는 동기·비대기(큐 put_nowait, 가득 차면 버림) — 틱 발행 경로를 막지 않는다.
  run() 의 writer 태스크가 큐를 FIFO 로 비워 스레드에서 insert, flusher 가 진행 중 바를 주기 insert.
  CH 장애는 로그만(게임 동작 무관).
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
FLUSH_SEC = 15.0
QUEUE_MAX = 1000
COLUMNS = ["ticker", "ts", "open", "high", "low", "close", "volume", "source", "ingested_at"]


@dataclass
class Bar:
    ticker: str
    ts: datetime  # 분 시작(KST aware)
    open: float
    high: float
    low: float
    close: float
    volume: int = 0


def tick_time(tick: dict, now: datetime | None = None) -> datetime:
    """틱 체결 시각(KST). timestamp(ISO) → time(HHMMSS) → now 순."""
    now = now or datetime.now(KST)
    raw = tick.get("timestamp")
    if raw:
        try:
            dt = datetime.fromisoformat(str(raw))
            return (dt if dt.tzinfo else dt.replace(tzinfo=KST)).astimezone(KST)
        except ValueError:
            pass
    hhmmss = tick.get("time")
    if hhmmss:
        try:
            return now.astimezone(KST).replace(
                hour=int(hhmmss[0:2]), minute=int(hhmmss[2:4]), second=int(hhmmss[4:6]), microsecond=0,
            )
        except (ValueError, IndexError, TypeError):
            pass
    return now


class MinuteBarAggregator:
    def __init__(self, ticker: str):
        self.ticker = ticker
        self._cur: Bar | None = None
        self._acml: int | None = None
        self.first_minute: datetime | None = None

    def _vol_delta(self, acml) -> int:
        try:
            acml = int(acml)
        except (TypeError, ValueError):
            return 0
        prev, self._acml = self._acml, acml
        if prev is None or acml < prev:  # 첫 틱 또는 누적 기준 변경
            return 0
        return acml - prev

    def add(self, tick: dict, now: datetime | None = None) -> list[Bar]:
        price = float(tick.get("price") or 0)
        if price <= 0:
            return []
        minute = tick_time(tick, now).replace(second=0, microsecond=0)
        cur = self._cur
        if cur is not None and minute < cur.ts:
            return []  # 지각 틱 무시(누적 기준도 건드리지 않음)
        vol = self._vol_delta(tick.get("volume"))
        if cur is not None and minute == cur.ts:
            cur.high = max(cur.high, price)
            cur.low = min(cur.low, price)
            cur.close = price
            cur.volume += vol
            return []
        if self.first_minute is None:
            self.first_minute = minute
        self._cur = Bar(self.ticker, minute, price, price, price, price, vol)
        return [cur] if cur is not None else []

    def snapshot(self) -> Bar | None:
        return replace(self._cur) if self._cur is not None else None


def to_rows(bars: list[Bar], source: str, ingested_at: datetime) -> list[list]:
    """insert 행. 같은 (ticker, ts) 는 뒤엣것만(같은 ingested_at 이면 Replacing 결과가 모호)."""
    last: dict[tuple[str, datetime], Bar] = {}
    for b in bars:
        last[(b.ticker, b.ts)] = b
    return [
        [b.ticker, b.ts, float(b.open), float(b.high), float(b.low), float(b.close),
         max(0, int(b.volume)), source, ingested_at]
        for b in last.values()
    ]


def insert_bars(bars: list[Bar], source: str, client=None, db: str | None = None) -> None:
    """game_minute_bars 동기 insert(스레드에서 호출)."""
    from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

    rows = to_rows(bars, source, datetime.now(timezone.utc))
    if rows:
        (client or get_client()).insert(f"{db or CLICKHOUSE_DB}.game_minute_bars", rows, column_names=COLUMNS)


def _ensure_table() -> None:
    from shared.clickhouse_schema import ensure_game_minute_bars

    ensure_game_minute_bars()


class MinuteBarRecorder:
    def __init__(
        self,
        insert: Callable[[list[Bar], str], None] = insert_bars,
        ensure: Callable[[], None] = _ensure_table,
        flush_sec: float = FLUSH_SEC,
        queue_max: int = QUEUE_MAX,
    ):
        self._insert = insert
        self._ensure = ensure
        self._ensured = False
        self._flush_sec = flush_sec
        self._aggs: dict[str, MinuteBarAggregator] = {}
        self._queue: asyncio.Queue[list[Bar]] = asyncio.Queue(maxsize=queue_max)
        self.dropped = 0

    def first_minute(self, ticker: str) -> datetime | None:
        agg = self._aggs.get(ticker)
        return agg.first_minute if agg else None

    def record(self, tick: dict) -> None:
        """틱 1개 집계 — 절대 예외를 올리거나 대기하지 않는다."""
        try:
            ticker = tick["ticker"]
            agg = self._aggs.get(ticker)
            if agg is None:
                agg = self._aggs[ticker] = MinuteBarAggregator(ticker)
            done = agg.add(tick)
            if done:
                self._enqueue(done)
        except Exception:  # noqa: BLE001
            log.exception("분봉 집계 실패(무시)")

    def _enqueue(self, bars: list[Bar]) -> None:
        try:
            self._queue.put_nowait(bars)
        except asyncio.QueueFull:
            self.dropped += 1
            log.warning("분봉 저장 큐 가득 — 버림(누적 %d)", self.dropped)

    def _snapshots(self) -> list[Bar]:
        return [s for a in self._aggs.values() if (s := a.snapshot()) is not None]

    async def _write(self, bars: list[Bar]) -> None:
        try:
            if not self._ensured:
                await asyncio.to_thread(self._ensure)
                self._ensured = True
            await asyncio.to_thread(self._insert, bars, "tick")
        except Exception as e:  # noqa: BLE001 — CH 장애는 로그만
            self._ensured = False
            log.warning("분봉 저장 실패(무시): %s", e)

    async def _drain_once(self) -> None:
        batch = await self._queue.get()
        while not self._queue.empty():
            batch = batch + self._queue.get_nowait()
        await self._write(batch)

    async def _writer(self) -> None:
        while True:
            await self._drain_once()

    async def _flusher(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=self._flush_sec)
            except asyncio.TimeoutError:
                pass
            snaps = self._snapshots()
            if snaps:
                self._enqueue(snaps)

    async def run(self, stop: asyncio.Event) -> None:
        """stop 까지 저장 루프. 종료 시 남은 큐 + 진행 중 바를 한 번 더 저장."""
        writer = asyncio.create_task(self._writer())
        try:
            await self._flusher(stop)  # 종료 직전 스냅샷까지 enqueue
        finally:
            writer.cancel()
            try:
                await writer
            except asyncio.CancelledError:
                pass
            rest: list[Bar] = []
            while not self._queue.empty():
                rest += self._queue.get_nowait()
            if rest:
                await self._write(rest)

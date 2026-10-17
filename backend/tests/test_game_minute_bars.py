"""게임 1분봉 — CH 스키마·틱 집계기·저장기 테스트."""
from __future__ import annotations

from shared import clickhouse_schema


def test_minute_bars_ddl_shape():
    ddl = clickhouse_schema.game_minute_bars_ddl("smoke_db")
    assert "CREATE TABLE IF NOT EXISTS smoke_db.game_minute_bars" in ddl
    assert "ts           DateTime('Asia/Seoul')" in ddl
    assert "source       LowCardinality(String)" in ddl
    assert "ReplacingMergeTree(ingested_at)" in ddl
    assert "ORDER BY (ticker, ts)" in ddl
    assert "PARTITION BY toYYYYMM(ts)" in ddl


def test_ensure_minute_bars_runs_ddl():
    sent = []

    class C:
        def command(self, sql):
            sent.append(sql)

    clickhouse_schema.ensure_game_minute_bars(C(), "x")
    assert len(sent) == 1 and "x.game_minute_bars" in sent[0]


# ---------------------------------------------------------------- 집계기
import asyncio  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

from apps.collector.game_ws import minute_bars as mb  # noqa: E402

KST = timezone(timedelta(hours=9))


def _t(h, m, s=0, price=100, vol=0, ticker="005930"):
    ts = datetime(2026, 10, 14, h, m, s, tzinfo=KST).isoformat()
    return {"ticker": ticker, "price": price, "volume": vol, "timestamp": ts}


def test_tick_time_prefers_timestamp_then_hhmmss_then_now():
    now = datetime(2026, 10, 14, 10, 0, 5, tzinfo=KST)
    assert mb.tick_time({"timestamp": "2026-10-14T09:31:59+09:00"}, now) == datetime(2026, 10, 14, 9, 31, 59, tzinfo=KST)
    # UTC 표기도 KST 로 정규화
    assert mb.tick_time({"timestamp": "2026-10-14T00:31:00+00:00"}, now).hour == 9
    assert mb.tick_time({"time": "093000"}, now) == datetime(2026, 10, 14, 9, 30, 0, tzinfo=KST)
    assert mb.tick_time({"timestamp": "깨짐"}, now) == now
    assert mb.tick_time({}, now) == now


def test_aggregator_ohlc_and_minute_boundary():
    agg = mb.MinuteBarAggregator("005930")
    assert agg.add(_t(9, 0, 1, 100)) == []
    assert agg.add(_t(9, 0, 20, 105)) == []
    assert agg.add(_t(9, 0, 40, 98)) == []
    assert agg.add(_t(9, 0, 59, 101)) == []
    done = agg.add(_t(9, 1, 0, 102))  # 분이 바뀌면 직전 분 확정
    assert len(done) == 1
    b = done[0]
    assert (b.ticker, b.ts) == ("005930", datetime(2026, 10, 14, 9, 0, tzinfo=KST))
    assert (b.open, b.high, b.low, b.close) == (100, 105, 98, 101)
    snap = agg.snapshot()
    assert snap.ts == datetime(2026, 10, 14, 9, 1, tzinfo=KST)
    assert (snap.open, snap.high, snap.low, snap.close) == (102, 102, 102, 102)


def test_aggregator_volume_from_cumulative_delta():
    agg = mb.MinuteBarAggregator("005930")
    agg.add(_t(9, 0, 1, vol=1000))   # 기준점(첫 틱 증분은 0)
    agg.add(_t(9, 0, 2, vol=1010))
    agg.add(_t(9, 0, 3, vol=1025))
    done = agg.add(_t(9, 1, 0, vol=1030))
    assert done[0].volume == 25
    assert agg.snapshot().volume == 5
    agg.add(_t(9, 1, 5, vol=10))      # 누적 감소(TR 폴백 등 기준 변경) → 0, 기준 재설정
    agg.add(_t(9, 1, 6, vol=13))
    assert agg.snapshot().volume == 8


def test_aggregator_ignores_ticks_older_than_current_bucket():
    agg = mb.MinuteBarAggregator("005930")
    agg.add(_t(9, 1, 0, 100, vol=100))
    assert agg.add(_t(9, 0, 59, 999, vol=50)) == []   # 직전 분 틱 지각 도착 → 무시
    agg.add(_t(9, 1, 10, 101, vol=110))
    s = agg.snapshot()
    assert (s.high, s.close, s.volume) == (101, 101, 10)  # 무시한 틱이 기준·가격에 영향 없음


def test_aggregator_skips_gap_minutes_and_bad_price():
    agg = mb.MinuteBarAggregator("005930")
    agg.add(_t(9, 0, 0, 100))
    assert agg.add(_t(9, 0, 1, 0)) == []  # 0원 틱 무시
    done = agg.add(_t(9, 5, 0, 110))      # 빈 분은 만들지 않음
    assert [b.ts.minute for b in done] == [0]
    assert done[0].close == 100
    assert agg.first_minute == datetime(2026, 10, 14, 9, 0, tzinfo=KST)


def test_snapshot_none_before_first_tick():
    assert mb.MinuteBarAggregator("005930").snapshot() is None


def test_rows_dedupe_last_wins():
    a = mb.Bar("005930", datetime(2026, 10, 14, 9, 0, tzinfo=KST), 1, 1, 1, 1, 0)
    b = mb.Bar("005930", datetime(2026, 10, 14, 9, 0, tzinfo=KST), 1, 2, 1, 2, 3)
    rows = mb.to_rows([a, b], "tick", datetime(2026, 10, 14, tzinfo=timezone.utc))
    assert len(rows) == 1 and rows[0][5] == 2 and rows[0][7] == "tick"


# ---------------------------------------------------------------- 저장기
async def test_recorder_inserts_finalized_and_periodic_snapshot():
    inserted: list[tuple[list, str]] = []
    rec = mb.MinuteBarRecorder(insert=lambda bars, source: inserted.append((bars, source)),
                               ensure=lambda: None, flush_sec=0.02)
    stop = asyncio.Event()
    task = asyncio.create_task(rec.run(stop))
    rec.record(_t(9, 0, 1, 100))
    rec.record(_t(9, 1, 0, 101))  # 9:00 확정
    await asyncio.sleep(0.1)
    stop.set()
    await task
    flat = [(b.ts.minute, s) for bars, s in inserted for b in bars]
    assert (0, "tick") in flat        # 확정 바 즉시
    assert (1, "tick") in flat        # 진행 중 바(주기 스냅샷/종료 시 flush)
    assert rec.first_minute("005930") == datetime(2026, 10, 14, 9, 0, tzinfo=KST)


async def test_recorder_insert_failure_is_swallowed():
    calls = {"n": 0}

    def boom(bars, source):
        calls["n"] += 1
        raise RuntimeError("CH down")

    rec = mb.MinuteBarRecorder(insert=boom, ensure=lambda: None, flush_sec=0.01)
    stop = asyncio.Event()
    task = asyncio.create_task(rec.run(stop))
    rec.record(_t(9, 0, 1))
    rec.record(_t(9, 1, 1))
    await asyncio.sleep(0.05)
    stop.set()
    await task  # 예외 없이 종료
    assert calls["n"] >= 1


def test_recorder_record_never_raises_and_drops_when_full():
    rec = mb.MinuteBarRecorder(insert=lambda b, s: None, ensure=lambda: None, queue_max=1)
    rec.record({"ticker": "005930"})  # price 없음 → 로그만
    for m in range(5):
        rec.record(_t(9, m, 0))      # 큐(1) 초과분은 버림(대기 없음)
    assert rec.dropped >= 1


async def test_consume_publishes_even_if_recorder_fails(monkeypatch):
    from apps.collector import run_game_ws

    async def fake_select(ticker):
        return "H0STCNT0"

    class FakeClient:
        def __init__(self, cfg, ticker, redis_url, tr_id, status_tr_id=None):
            pass

        async def stream(self):
            rec = ["0"] * 47
            rec[0], rec[1], rec[2], rec[3], rec[13] = "005930", "093000", "1000", "2", "5"
            yield "0|H0STCNT0|001|" + "^".join(rec)

    published = []

    class Pub:
        async def publish(self, tick):
            published.append(tick)

    class BadRecorder:
        def record(self, tick):
            raise RuntimeError("집계 실패")

    monkeypatch.setattr(run_game_ws, "select_tr_id", fake_select)
    monkeypatch.setattr(run_game_ws, "KISWebSocketClient", FakeClient)
    monkeypatch.setattr(run_game_ws, "_in_window", lambda now, w: True)
    await run_game_ws._consume(False, object(), "005930", 0, "redis://x", Pub(), recorder=BadRecorder())
    assert [t["price"] for t in published] == [1000]


async def test_consume_feeds_recorder_with_published_payload(monkeypatch):
    from apps.collector import run_game_ws

    seen = []

    class Rec:
        def record(self, tick):
            seen.append(tick)

    class Pub:
        async def publish(self, tick):
            pass

    async def fake_mock_ticks(ticker, base):
        yield _t(9, 0, 1, 100)

    monkeypatch.setattr(run_game_ws, "mock_ticks", fake_mock_ticks)
    await run_game_ws._consume(True, None, "005930", 100, "redis://x", Pub(), recorder=Rec())
    assert [t["price"] for t in seen] == [100]


def test_mock_ticks_not_recorded_unless_opt_in():
    from apps.collector import run_game_ws

    assert run_game_ws._should_record_bars(False, None) is True
    assert run_game_ws._should_record_bars(True, None) is False
    assert run_game_ws._should_record_bars(True, "true") is True

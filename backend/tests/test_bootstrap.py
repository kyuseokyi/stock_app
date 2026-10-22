"""초기 데이터 준비 — 마지막 확정 거래일, backfill_all_daily end 기본값, 부트스트랩 단계·차단·진행 기록(가짜, KIS 호출 없음)."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import fakeredis
import pytest

from apps.collector import trading_day
from apps.collector.tasks import bootstrap as bs
from apps.collector.tasks import universe

KST = timezone(timedelta(hours=9))


def kst(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=KST)


# ---------------------------------------------------------------- 마지막 확정 거래일
# 2026-10-22 = 목, 10-24 토, 10-25 일, 10-26 월
@pytest.mark.parametrize("now, expected", [
    (kst(2026, 10, 22, 20, 29), date(2026, 10, 21)),  # 평일 20:29 → 전 평일
    (kst(2026, 10, 22, 20, 30), date(2026, 10, 22)),  # 평일 20:30 → 오늘
    (kst(2026, 10, 22, 23, 59), date(2026, 10, 22)),
    (kst(2026, 10, 23, 0, 0), date(2026, 10, 22)),    # 자정 넘으면 새 날(금 00:00 → 직전 평일 목)
    (kst(2026, 10, 23, 23, 59), date(2026, 10, 23)),  # 금 23:59 → 금
    (kst(2026, 10, 24, 0, 0), date(2026, 10, 23)),    # 토 00:00 → 금
    (kst(2026, 10, 26, 0, 0), date(2026, 10, 23)),    # 월 00:00 → 금
    (datetime(2026, 10, 22, 15, 0, tzinfo=timezone.utc), date(2026, 10, 22)),  # UTC 15:00 = KST 금 00:00 → 목
    (kst(2026, 10, 24, 22, 0), date(2026, 10, 23)),   # 토 → 금
    (kst(2026, 10, 25, 9, 0), date(2026, 10, 23)),    # 일 → 금
    (kst(2026, 10, 26, 8, 0), date(2026, 10, 23)),    # 월 아침 → 금
    (datetime(2026, 10, 22, 11, 30, tzinfo=timezone.utc), date(2026, 10, 22)),  # UTC 11:30 = KST 20:30
])
def test_last_confirmed_trading_day(now, expected):
    assert trading_day.last_confirmed_trading_day(now) == expected


def test_last_confirmed_trading_day_default_now_is_kst(monkeypatch):
    monkeypatch.setattr(trading_day, "now_kst", lambda: kst(2026, 10, 26, 8, 0))
    assert trading_day.last_confirmed_trading_day() == date(2026, 10, 23)


# ---------------------------------------------------------------- backfill_all_daily end
def _capture_backfill(monkeypatch):
    calls = []
    monkeypatch.setattr(universe, "fetch_domestic_daily_range",
                        lambda t, s, e, client=None: calls.append((t, s, e)) or [])
    monkeypatch.setattr(universe, "upsert_daily_prices", lambda t, rows: 0)
    monkeypatch.setattr(universe, "enrich_with_ma", lambda rows: rows)

    def fake_run(one, limit, source, rate, workers):
        one("005930", None)
        one("000660", None)
        return {"ok": 2}

    monkeypatch.setattr(universe, "_run_universe", fake_run)
    return calls


def test_backfill_all_daily_end_defaults_to_last_confirmed_day(monkeypatch):
    calls = _capture_backfill(monkeypatch)
    monkeypatch.setattr(universe.trading_day, "last_confirmed_trading_day", lambda now=None: date(2026, 10, 21))
    universe.backfill_all_daily(months=1)
    assert calls == [("005930", "20260920", "20261021"), ("000660", "20260920", "20261021")]


def test_backfill_all_daily_explicit_end(monkeypatch):
    calls = _capture_backfill(monkeypatch)
    monkeypatch.setattr(universe.trading_day, "last_confirmed_trading_day",
                        lambda now=None: pytest.fail("end 가 있으면 확정 거래일을 계산하지 않는다"))
    universe.backfill_all_daily(months=1, end="20261015")
    assert calls[0] == ("005930", "20260914", "20261015")


# ---------------------------------------------------------------- 부트스트랩
KEYS = [k for k, _, _ in bs.STEPS]


@pytest.fixture
def env(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(bs, "get_sync_redis", lambda: fake)
    order: list = []
    snapshots: list = []

    def stub(key, result=None):
        def f(*a, **k):
            order.append((key, a, k))
            raw = fake.get(bs.PROGRESS_KEY)
            snapshots.append(json.loads(raw) if raw else None)
            return result if result is not None else {"ok": 1}
        return f

    monkeypatch.setattr(bs, "backfill_all_daily", stub("daily_backfill", {"ok": 2500, "total": 2600}))
    monkeypatch.setattr(bs, "collect_market_indices", lambda region: stub(f"indices_{region.lower()}")(region))
    monkeypatch.setattr(bs, "collect_investor_daily", stub("investor"))
    monkeypatch.setattr(bs, "collect_fundamentals", stub("fundamentals"))
    monkeypatch.setattr(bs, "collect_ipo_events", stub("ipo", {"events": 3}))
    monkeypatch.setattr(bs, "collect_macro_series", stub("macro", {"skipped": "FRED_API_KEY 없음"}))
    monkeypatch.setattr(bs, "backfill_canslim", stub("canslim"))
    monkeypatch.setattr(bs, "backfill_market_groups", stub("market_groups"))
    monkeypatch.setattr(bs, "backfill_screener", stub("screener"))
    monkeypatch.setattr(bs, "compute_patterns", stub("patterns", {"rows": 9}))

    class Env:
        redis = fake

        def __init__(self):
            self.order = order
            self.snapshots = snapshots

        def keys(self):
            return [o[0] for o in order]

        def progress(self):
            return json.loads(fake.get(bs.PROGRESS_KEY))

    return Env()


def clock(*times):
    """now_fn — 차례로 돌려주고 마지막 값을 유지."""
    seq = list(times)

    def now():
        return seq.pop(0) if len(seq) > 1 else seq[0]
    return now


def test_runs_all_steps_in_order(env):
    out = bs.run_bootstrap(37, task_id="t1", now_fn=clock(kst(2026, 10, 22, 10, 0)))
    assert env.keys() == KEYS
    daily = env.order[0]
    assert daily[2] == {"months": 37, "end": "20261021"}  # 10:00 → 전 평일
    assert [o[2] for o in env.order if o[0] in ("canslim", "market_groups", "screener")] == [{"days": 60}] * 3
    assert out["states"] == {k: "ok" for k in KEYS}
    assert out["end_date"] == "2026-10-21" and out["months"] == 37
    p = env.progress()
    assert p["task_id"] == "t1" and p["end_date"] == "2026-10-21" and p["finished_at"] is not None
    assert [s["key"] for s in p["steps"]] == KEYS
    assert all(s["state"] == "ok" and isinstance(s["seconds"], float) for s in p["steps"])
    assert '"rows": 9' in p["steps"][-1]["summary"]
    assert 0 < env.redis.ttl(bs.PROGRESS_KEY) <= bs.PROGRESS_TTL


def test_progress_updated_at_each_step(env):
    bs.run_bootstrap(37, now_fn=clock(kst(2026, 10, 22, 10, 0)))
    # fundamentals(5번째) 실행 중 기록: 앞 4단계 ok, 자기 running, 뒤는 pending, 아직 안 끝남
    snap = env.snapshots[4]
    states = [s["state"] for s in snap["steps"]]
    assert states[:4] == ["ok"] * 4 and states[4] == "running" and set(states[5:]) == {"pending"}
    assert snap["finished_at"] is None


def test_step_failure_is_isolated(env, monkeypatch):
    def boom():
        raise RuntimeError("kis down")

    monkeypatch.setattr(bs, "collect_investor_daily", boom)
    monkeypatch.setattr(bs, "backfill_canslim", lambda days: {"error": "no bars"})
    out = bs.run_bootstrap(37, now_fn=clock(kst(2026, 10, 22, 10, 0)))
    assert out["states"]["investor"] == "failed" and out["states"]["canslim"] == "failed"
    assert out["states"]["fundamentals"] == "ok" and out["states"]["patterns"] == "ok"
    assert "patterns" in env.keys()
    step = next(s for s in env.progress()["steps"] if s["key"] == "investor")
    assert "kis down" in step["summary"]


@pytest.mark.parametrize("fail, goes_on", [(104, True), (156, False), (2600, False)])
def test_daily_fail_ratio(env, monkeypatch, fail, goes_on):
    # 총 2600: 4% 실패는 계속, 6% 실패·전부 실패(성공 0)는 중단
    monkeypatch.setattr(bs, "backfill_all_daily",
                        lambda **k: {"total": 2600, "ok": 2600 - fail, "failed_count": fail})
    out = bs.run_bootstrap(37, now_fn=clock(kst(2026, 10, 22, 10, 0)))
    assert (out["states"]["daily_backfill"] == "ok") is goes_on
    assert (env.keys() == KEYS[1:]) is goes_on
    summary = env.progress()["steps"][0]["summary"]
    assert f"실패 {fail}" in summary


def test_daily_zero_universe_fails(env, monkeypatch):
    monkeypatch.setattr(bs, "backfill_all_daily", lambda **k: {"total": 0, "ok": 0, "failed_count": 0})
    out = bs.run_bootstrap(37, now_fn=clock(kst(2026, 10, 22, 10, 0)))
    assert out["states"]["daily_backfill"] == "failed" and env.keys() == []


@pytest.mark.parametrize("daily", [
    lambda **k: (_ for _ in ()).throw(RuntimeError("master down")),
    lambda **k: {"error": "x"},
    lambda **k: {"total": 2600, "ok": 0, "failed_count": 2600},  # 예외 없이 전 종목 실패
])
def test_daily_failure_skips_rest(env, monkeypatch, daily):
    monkeypatch.setattr(bs, "backfill_all_daily", daily)
    out = bs.run_bootstrap(37, now_fn=clock(kst(2026, 10, 22, 10, 0)))
    assert env.keys() == []
    assert out["states"]["daily_backfill"] == "failed"
    assert all(out["states"][k] == "skipped" for k in KEYS[1:])
    p = env.progress()
    assert all(s["reason"] == bs.DAILY_FAILED_MSG for s in p["steps"][1:])
    assert p["finished_at"] is not None


@pytest.mark.parametrize("h, m, blocked", [(15, 59, False), (16, 0, True), (17, 59, True), (21, 29, True), (21, 30, False)])
def test_start_window_block(env, h, m, blocked):
    out = bs.run_bootstrap(37, task_id="t2", now_fn=clock(kst(2026, 10, 22, h, m)))
    if blocked:
        assert out == {"skipped": bs.START_BLOCKED_MSG} and env.keys() == []
        p = env.progress()
        assert p["skipped"] == bs.START_BLOCKED_MSG and p["finished_at"] is not None and p["task_id"] == "t2"
        assert all(s["state"] == "skipped" for s in p["steps"])
    else:
        assert env.keys() == KEYS


def test_start_block_keeps_previous_progress(env):
    bs.run_bootstrap(37, task_id="old", now_fn=clock(kst(2026, 10, 22, 10, 0)))
    before = env.progress()
    out = bs.run_bootstrap(37, task_id="new", now_fn=clock(kst(2026, 10, 22, 17, 0)))
    assert out == {"skipped": bs.START_BLOCKED_MSG}
    after = env.progress()
    assert after["skipped"] == bs.START_BLOCKED_MSG and after["skipped_at"]
    assert after["task_id"] == "old" and after["steps"] == before["steps"]
    assert after["finished_at"] == before["finished_at"]


@pytest.mark.parametrize("h, m, blocked", [(18, 59, False), (19, 0, True), (21, 29, True), (21, 30, False)])
def test_kis_block_boundary(env, h, m, blocked):
    # 시작 15:00, 첫 KIS 단계(daily) 직전 시각이 h:m
    out = bs.run_bootstrap(37, now_fn=clock(kst(2026, 10, 22, 15, 0), kst(2026, 10, 22, h, m)))
    if blocked:
        assert env.keys() == [] and out["states"]["daily_backfill"] == "skipped"
    else:
        assert env.keys()[0] == "daily_backfill"


def test_kis_window_block_mid_run(env):
    # 시작 15:00 → daily·indices_kr·indices_us 는 18:59 까지, investor 직전 19:00 → 그 단계부터 끝까지 skipped
    now = clock(kst(2026, 10, 22, 15, 0), kst(2026, 10, 22, 18, 0), kst(2026, 10, 22, 18, 30),
                kst(2026, 10, 22, 18, 59), kst(2026, 10, 22, 19, 0))
    out = bs.run_bootstrap(37, now_fn=now)
    assert env.keys() == ["daily_backfill", "indices_kr", "indices_us"]
    assert [out["states"][k] for k in KEYS[3:]] == ["skipped"] * 8
    p = env.progress()
    assert all(s["reason"] == bs.KIS_BLOCKED_MSG for s in p["steps"][3:])


def test_kis_block_does_not_apply_to_compute_steps(env):
    # 1~7 은 18:00, 계산 단계 직전 시각이 20:10 이어도 계산은 그대로 진행(KIS 단계만 차단)
    times = [kst(2026, 10, 22, 15, 0)] + [kst(2026, 10, 22, 18, 0)] * 7 + [kst(2026, 10, 22, 20, 10)]
    out = bs.run_bootstrap(37, now_fn=clock(*times))
    assert env.keys() == KEYS and set(out["states"].values()) == {"ok"}


def test_progress_write_failure_is_ignored(env, monkeypatch):
    def bad_client():
        raise ValueError("bad url")

    monkeypatch.setattr(bs, "get_sync_redis", bad_client)
    out = bs.run_bootstrap(37, now_fn=clock(kst(2026, 10, 22, 10, 0)))
    assert set(out["states"].values()) == {"ok"}


def test_task_registered_and_included():
    from apps.collector.celery_app import celery_app

    assert "apps.collector.tasks.bootstrap" in celery_app.conf.include
    assert bs.bootstrap_data.name == "collector.bootstrap_data"


def test_task_wrapper_passes_months_and_task_id(monkeypatch):
    seen = {}
    monkeypatch.setattr(bs, "run_bootstrap", lambda months, task_id=None: seen.update(m=months, t=task_id) or {})
    bs.bootstrap_data.apply(kwargs={"months": 12}, task_id="abc")
    assert seen == {"m": 12, "t": "abc"}

"""스크리너 태스크 — 하루 계산·저장, 60일 백필(날짜별 격리), celery include, 일일 파이프라인 마지막 단계(실패 격리)."""
from datetime import date

import fakeredis
import pytest

from apps.collector.screener.compute import DayResult
from apps.collector.tasks import screener as task

D1, D2 = date(2026, 10, 15), date(2026, 10, 16)


@pytest.fixture
def fake(monkeypatch):
    calls = {"compute": [], "rows": []}
    monkeypatch.setattr(task.chm, "ensure_market_tables", lambda: None)
    monkeypatch.setattr(task.cs, "ensure_screener_table", lambda: None)
    monkeypatch.setattr(task.cs, "latest_trading_date", lambda: D2)
    monkeypatch.setattr(task.cs, "trading_dates", lambda as_of, n: [D1, D2][-n:])
    calls["load"] = []
    monkeypatch.setattr(task.cs, "load_bars",
                        lambda as_of, days=400, client=None, tickers=None: calls["load"].append((as_of, days, tickers))
                        or {"AAA": [("bar", as_of)]})
    monkeypatch.setattr(task.cs, "slice_bars", lambda bars, as_of, days=400: {"AAA": as_of})
    monkeypatch.setattr(task.cs, "load_fundamentals", lambda: {"AAA": {"eps": 1.0}})
    monkeypatch.setattr(task, "_universe", lambda: [("AAA", "에이", "KOSPI")])
    monkeypatch.setattr(task, "_profiles", lambda: {"AAA": ("KOSPI", "0013", 100, False)})

    def compute_day(as_of, universe, profiles, bars, fundamentals):
        calls["compute"].append((as_of, bars, fundamentals))
        if as_of == calls.get("fail_on"):
            raise RuntimeError("bad day")
        res = calls.get("result")
        if res is not None:
            return res
        return DayResult([{"ticker": "AAA", "is_new_high": 1, "gc_days": None}], 0, 0)

    monkeypatch.setattr(task, "compute_day", compute_day)
    monkeypatch.setattr(task.cs, "upsert_rows", lambda rows: calls["rows"].append(rows) or len(rows))
    return calls


def test_compute_latest_day(fake):
    out = task.compute_screener()
    assert out == {"date": "2026-10-16", "rows": 1, "failed": 0, "skipped_no_bar": 0, "new_high": 1,
                   "golden_cross": 0}
    assert fake["compute"] == [(D2, {"AAA": [("bar", D2)]}, {"AAA": {"eps": 1.0}})]
    assert fake["load"] == [(D2, 400, ["AAA"])]                  # 분석 대상 종목만 읽는다


def test_compute_specific_day_and_no_data(fake, monkeypatch):
    assert task.compute_screener("2026-10-15")["date"] == "2026-10-15"
    monkeypatch.setattr(task.cs, "latest_trading_date", lambda: None)
    assert task.compute_screener() == {"skipped": "일봉 없음"}


def test_backfill_isolates_bad_day(fake):
    fake["fail_on"] = D1
    out = task.backfill_screener(days=2)
    assert out["ok"] == ["2026-10-16"] and out["failed"][0]["date"] == "2026-10-15"
    assert [c[0] for c in fake["compute"]] == [D1, D2]


def test_backfill_loads_bars_once_and_slices_per_day(fake):
    out = task.backfill_screener(days=2)
    assert out["ok"] == ["2026-10-15", "2026-10-16"] and len(out["days"]) == 2
    assert fake["load"] == [(D2, 1 + 400, ["AAA"])]              # 봉 로드 1회, 범위 = 날짜 간격 + 400일
    assert [c[1] for c in fake["compute"]] == [{"AAA": D1}, {"AAA": D2}]


def _rows_n(n):
    return [{"ticker": f"T{i}", "is_new_high": 0, "gc_days": None} for i in range(n)]


UNI = [(f"T{i}", "n", "KOSPI") for i in range(100)]


def test_run_day_all_failed_is_error_not_exception(fake):
    fake["result"] = DayResult([], 100, 0)
    out = task._run_day(D2, UNI, {}, {}, {})
    assert out["rows"] == 0 and out["failed"] == 100 and "error" in out


def test_run_day_failure_ratio_threshold(fake):
    fake["result"] = DayResult(_rows_n(95), 5, 0)                # 5/100 = 5% → 실패
    assert "error" in task._run_day(D2, UNI, {}, {}, {})
    fake["result"] = DayResult(_rows_n(96), 4, 0)                # 4% → 정상(소수 실패 격리)
    out = task._run_day(D2, UNI, {}, {}, {})
    assert "error" not in out and out["rows"] == 96 and out["failed"] == 4


def test_run_day_skipped_counted_and_empty_universe_ok(fake):
    fake["result"] = DayResult(_rows_n(90), 0, 10)
    out = task._run_day(D2, UNI, {}, {}, {})
    assert "error" not in out and out["skipped_no_bar"] == 10
    fake["result"] = DayResult([], 0, 0)
    assert "error" not in task._run_day(D2, [], {}, {}, {})      # 대상 0개면 0행도 정상


def test_backfill_records_error_days_as_failed(fake, monkeypatch):
    fake["result"] = DayResult([], 100, 0)
    monkeypatch.setattr(task, "_universe", lambda: UNI)
    out = task.backfill_screener(days=2)
    assert out["ok"] == [] and [f["date"] for f in out["failed"]] == ["2026-10-15", "2026-10-16"]
    assert out["days"][0]["failed"] == 100


def test_celery_include():
    from apps.collector.celery_app import celery_app

    assert "apps.collector.tasks.screener" in celery_app.conf.include


def test_daily_pipeline_runs_screener_last_even_if_groups_fail(monkeypatch):
    from apps.collector.tasks import market_data as md

    order = []
    monkeypatch.setattr(md, "get_sync_redis", lambda: fakeredis.FakeRedis(decode_responses=True))
    monkeypatch.setattr(md, "_daily_ohlcv", lambda: order.append("daily") or {})
    monkeypatch.setattr(md, "collect_market_indices", lambda region="KR": order.append("idx") or {})
    monkeypatch.setattr(md, "collect_investor_daily", lambda: order.append("investor") or {})
    monkeypatch.setattr(md, "compute_canslim", lambda: order.append("canslim") or {})

    def groups_boom():
        order.append("groups")
        raise RuntimeError("groups down")

    monkeypatch.setattr(md, "compute_market_groups", groups_boom)
    monkeypatch.setattr(md, "compute_screener", lambda: order.append("screener") or {"rows": 7})
    monkeypatch.setattr(md, "compute_patterns", lambda: order.append("patterns") or {"rows": 3})
    out = md.daily_market_pipeline()
    assert order == ["daily", "idx", "investor", "canslim", "groups", "screener", "patterns"]
    assert "error" in out["market_groups"] and out["screener"] == {"rows": 7}
    assert list(out)[-1] == "patterns"


def test_daily_pipeline_screener_failure_is_recorded_not_raised(monkeypatch):
    from apps.collector.tasks import market_data as md
    from shared import pipeline_record

    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(md, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(md, "_daily_ohlcv", lambda: {})
    monkeypatch.setattr(md, "collect_market_indices", lambda region="KR": {})
    monkeypatch.setattr(md, "collect_investor_daily", lambda: {})
    monkeypatch.setattr(md, "compute_canslim", lambda: {})
    monkeypatch.setattr(md, "compute_market_groups", lambda: {})
    monkeypatch.setattr(md, "compute_patterns", lambda: {})

    def boom():
        raise RuntimeError("screener down")

    monkeypatch.setattr(md, "compute_screener", boom)
    out = md.daily_market_pipeline()          # 예외가 밖으로 새지 않는다
    assert "screener down" in out["screener"]["error"]
    rec = pipeline_record.load(fake)
    last = rec["steps"][-2]
    assert last["name"] == "screener" and last["ok"] is False and "screener down" in last["summary"]
    assert rec["steps"][-1]["name"] == "patterns" and rec["steps"][-1]["ok"] is True
    assert all(s["ok"] for s in rec["steps"][:-2])

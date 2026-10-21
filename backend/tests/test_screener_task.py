"""스크리너 태스크 — 하루 계산·저장, 60일 백필(날짜별 격리), celery include, 일일 파이프라인 마지막 단계(실패 격리)."""
from datetime import date

import fakeredis
import pytest

from apps.collector.tasks import screener as task

D1, D2 = date(2026, 10, 15), date(2026, 10, 16)


@pytest.fixture
def fake(monkeypatch):
    calls = {"compute": [], "rows": []}
    monkeypatch.setattr(task.chm, "ensure_market_tables", lambda: None)
    monkeypatch.setattr(task.cs, "ensure_screener_table", lambda: None)
    monkeypatch.setattr(task.cs, "latest_trading_date", lambda: D2)
    monkeypatch.setattr(task.cs, "trading_dates", lambda as_of, n: [D1, D2][-n:])
    monkeypatch.setattr(task.cs, "load_bars", lambda as_of: {"AAA": as_of})
    monkeypatch.setattr(task.cs, "load_fundamentals", lambda: {"AAA": {"eps": 1.0}})
    monkeypatch.setattr(task, "_universe", lambda: [("AAA", "에이", "KOSPI")])
    monkeypatch.setattr(task, "_profiles", lambda: {"AAA": ("KOSPI", "0013", 100, False)})

    def compute_day(as_of, universe, profiles, bars, fundamentals):
        calls["compute"].append((as_of, bars, fundamentals))
        if as_of == calls.get("fail_on"):
            raise RuntimeError("bad day")
        return [{"ticker": "AAA", "is_new_high": 1, "gc_days": None}]

    monkeypatch.setattr(task, "compute_day", compute_day)
    monkeypatch.setattr(task.cs, "upsert_rows", lambda rows: calls["rows"].append(rows) or len(rows))
    return calls


def test_compute_latest_day(fake):
    out = task.compute_screener()
    assert out == {"date": "2026-10-16", "rows": 1, "new_high": 1, "golden_cross": 0}
    assert fake["compute"] == [(D2, {"AAA": D2}, {"AAA": {"eps": 1.0}})]


def test_compute_specific_day_and_no_data(fake, monkeypatch):
    assert task.compute_screener("2026-10-15")["date"] == "2026-10-15"
    monkeypatch.setattr(task.cs, "latest_trading_date", lambda: None)
    assert task.compute_screener() == {"skipped": "일봉 없음"}


def test_backfill_isolates_bad_day(fake):
    fake["fail_on"] = D1
    out = task.backfill_screener(days=2)
    assert out["ok"] == ["2026-10-16"] and out["failed"][0]["date"] == "2026-10-15"
    assert [c[0] for c in fake["compute"]] == [D1, D2]


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
    out = md.daily_market_pipeline()
    assert order == ["daily", "idx", "investor", "canslim", "groups", "screener"]
    assert "error" in out["market_groups"] and out["screener"] == {"rows": 7}
    assert list(out)[-1] == "screener"


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

    def boom():
        raise RuntimeError("screener down")

    monkeypatch.setattr(md, "compute_screener", boom)
    out = md.daily_market_pipeline()          # 예외가 밖으로 새지 않는다
    assert "screener down" in out["screener"]["error"]
    rec = pipeline_record.load(fake)
    last = rec["steps"][-1]
    assert last["name"] == "screener" and last["ok"] is False and "screener down" in last["summary"]
    assert all(s["ok"] for s in rec["steps"][:-1])

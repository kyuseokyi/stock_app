"""CANSLIM 태스크 — 분기 EPS 형식 설정, 하루 계산·저장, 60일 백필(날짜별 격리), 일일 파이프라인 연결."""
from datetime import date

import pytest

from apps.collector.tasks import canslim as task

D1, D2 = date(2026, 10, 15), date(2026, 10, 16)


@pytest.mark.parametrize("raw, expected", [("true", True), ("1", True), ("YES", True), ("false", False),
                                           ("0", False), ("", None), ("maybe", None)])
def test_q_cumulative_setting(monkeypatch, raw, expected):
    monkeypatch.setenv("FUNDAMENTALS_Q_CUMULATIVE", raw)
    assert task.q_cumulative_setting() is expected


def test_q_cumulative_unset(monkeypatch):
    monkeypatch.delenv("FUNDAMENTALS_Q_CUMULATIVE", raising=False)
    assert task.q_cumulative_setting() is None


@pytest.fixture
def fake(monkeypatch):
    calls = {"compute": [], "rows": [], "markets": []}
    monkeypatch.setattr(task.chm, "ensure_market_tables", lambda: None)
    monkeypatch.setattr(task.cc, "ensure_canslim_tables", lambda: None)
    monkeypatch.setattr(task.cc, "latest_trading_date", lambda: D2)
    monkeypatch.setattr(task.cc, "trading_dates", lambda as_of, n: [D1, D2][-n:])
    monkeypatch.setattr(task.cc, "load_bars", lambda as_of: {"AAA": as_of})
    monkeypatch.setattr(task.cc, "load_index_bars", lambda as_of: {})
    monkeypatch.setattr(task.cc, "load_investor", lambda as_of: {})
    monkeypatch.setattr(task.cc, "load_fundamentals", lambda: {"AAA": {}})
    monkeypatch.setattr(task, "_universe", lambda: [("AAA", "에이", "KOSPI")])
    monkeypatch.setattr(task, "_profiles", lambda: {"AAA": ("0013", 12)})

    def compute_day(as_of, universe, profiles, bars, index_bars, investor, fundamentals, q_cumulative):
        calls["compute"].append((as_of, q_cumulative, bars))
        if as_of == calls.get("fail_on"):
            raise RuntimeError("bad day")
        return [{"ticker": "AAA", "pass_count": 5}], [{"market": "KOSPI"}]

    monkeypatch.setattr(task, "compute_day", compute_day)
    monkeypatch.setattr(task.cc, "upsert_rows", lambda rows: calls["rows"].append(rows) or len(rows))
    monkeypatch.setattr(task.cc, "upsert_markets", lambda m: calls["markets"].append(m) or len(m))
    return calls


def test_compute_latest_day(fake, monkeypatch):
    monkeypatch.setenv("FUNDAMENTALS_Q_CUMULATIVE", "false")
    out = task.compute_canslim()
    assert out == {"date": "2026-10-16", "rows": 1, "markets": 1, "pass5": 1}
    assert fake["compute"] == [(D2, False, {"AAA": D2})]


def test_compute_specific_day_and_no_data(fake, monkeypatch):
    assert task.compute_canslim("2026-10-15")["date"] == "2026-10-15"
    monkeypatch.setattr(task.cc, "latest_trading_date", lambda: None)
    assert task.compute_canslim() == {"skipped": "일봉 없음"}


def test_backfill_isolates_bad_day(fake):
    fake["fail_on"] = D1
    out = task.backfill_canslim(days=2)
    assert out["ok"] == ["2026-10-16"] and out["failed"][0]["date"] == "2026-10-15"
    assert [c[0] for c in fake["compute"]] == [D1, D2]


def test_daily_pipeline_runs_canslim_last(monkeypatch):
    from apps.collector.tasks import market_data as md

    order = []
    monkeypatch.setattr(md, "_daily_ohlcv", lambda: order.append("daily") or {})
    monkeypatch.setattr(md, "collect_market_indices", lambda region="KR": order.append("idx") or {})
    monkeypatch.setattr(md, "collect_investor_daily", lambda: order.append("investor") or {})
    monkeypatch.setattr(md, "compute_canslim", lambda: order.append("canslim") or {"rows": 1})
    monkeypatch.setattr(md, "compute_market_groups", lambda: {})
    monkeypatch.setattr(md, "compute_screener", lambda: {})
    out = md.daily_market_pipeline()
    assert order == ["daily", "idx", "investor", "canslim"] and out["canslim"] == {"rows": 1}


def test_beat_and_include():
    from apps.collector.celery_app import celery_app

    assert celery_app.conf.beat_schedule["compute-canslim-after-fundamentals"]["task"] == "collector.compute_canslim"
    assert "apps.collector.tasks.canslim" in celery_app.conf.include

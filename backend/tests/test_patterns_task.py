"""차트 패턴 태스크 — 행 변환·실패 격리·실패율/0행 error(적재 안 함)·celery include."""
import json
from datetime import date

import pytest

from apps.collector.patterns import Base
from apps.collector.tasks import patterns as task

D = date(2026, 10, 16)


def _base(rim=date(2026, 8, 1), **kw):
    d = dict(pattern_type="cup", rim_date=rim, low_date=date(2026, 9, 1), low_price=80.0, pivot=100.0, depth=20.0,
             length=60, is_active=True, breakout_date=None, breakout_price_pct=None, breakout_vol_pct=None,
             days_since_breakout=None, base_count=1, subcount=1, totalcount=1, label="1단계 컵",
             prior_uptrend_pct=45.0, confidence=0.8, points=({"role": "rim", "date": "2026-08-01", "price": 100.0},))
    d.update(kw)
    return Base(**d)


@pytest.fixture
def fake(monkeypatch):
    st = {"replaced": [], "bars": {}, "bases": {}, "universe": [("AAA", "에이", "KOSPI"), ("BBB", "비", "KOSDAQ")]}
    monkeypatch.setattr(task.cp, "ensure_patterns_table", lambda: None)
    monkeypatch.setattr(task.cp, "latest_trading_date", lambda: D)
    monkeypatch.setattr(task.cp, "load_bars", lambda as_of, bars=770, client=None, tickers=None:
                        st.setdefault("load", (as_of, tickers)) and st["bars"])
    monkeypatch.setattr(task.cp, "replace_day", lambda d, rows: st["replaced"].append((d, rows)) or len(rows))
    monkeypatch.setattr(task, "_universe", lambda: st["universe"])

    def detect(bars):
        r = st["bases"][bars[0][1]]  # open 값으로 종목 구분
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(task, "detect", detect)
    return st


def _bars(tag, last=D):
    return [(date(2026, 10, 15), tag, 2, 1, 1.5, 10.0), (last, tag, 2, 1, 7.0, 10.0)]


def test_rows_is_current_points_close_market(fake):
    fake["bars"] = {"AAA": _bars(1), "BBB": _bars(2)}
    fake["bases"] = {1: [_base(date(2026, 3, 1), is_active=False, breakout_date=D, days_since_breakout=1),
                         _base(date(2026, 8, 1))], 2: []}
    out = task.compute_patterns()
    assert fake["load"] == (D, ["AAA", "BBB"])
    assert out == {"date": "2026-10-16", "rows": 2, "tickers": 2, "failed": 0, "skipped_no_bar": 0,
                   "by_pattern": {"cup": 2}, "active": 1, "breakout_today": 0}
    d, rows = fake["replaced"][0]
    assert d == D and [r["is_current"] for r in rows] == [0, 1] and [r["is_active"] for r in rows] == [0, 1]
    assert rows[1]["market"] == "KOSPI" and rows[1]["close"] == 7.0 and rows[1]["date"] == D
    assert json.loads(rows[1]["points"]) == [{"role": "rim", "date": "2026-08-01", "price": 100.0}]
    assert set(rows[0]) == set(task.cp.ROW_COLUMNS)


def test_breakout_today_counts_current_only(fake):
    fake["bars"] = {"AAA": _bars(1), "BBB": _bars(2)}
    fake["bases"] = {1: [_base(is_active=False, breakout_date=D, days_since_breakout=1)], 2: [_base()]}
    out = task.compute_patterns("2026-10-16")
    assert out["breakout_today"] == 1 and out["active"] == 1


def test_isolates_ticker_exception_and_skips_missing_bar(fake):
    fake["universe"] = [(f"T{i}", "n", "KOSPI") for i in range(100)] + [("OLD", "정지", "KOSPI"), ("EXC", "예외", "KOSPI")]
    fake["bars"] = {f"T{i}": _bars(i) for i in range(100)} | {"OLD": _bars(500, last=date(2026, 10, 15)),
                                                               "EXC": _bars(900)}
    fake["bases"] = {i: [_base()] for i in range(100)} | {900: RuntimeError("bad")}
    out = task.compute_patterns()
    assert out["failed"] == 1 and out["skipped_no_bar"] == 1 and out["tickers"] == 100 and out["rows"] == 100
    assert "error" not in out and len(fake["replaced"]) == 1


def test_failure_ratio_is_error_and_not_replaced(fake):
    fake["universe"] = [(f"T{i}", "n", "KOSPI") for i in range(20)]
    fake["bars"] = {f"T{i}": _bars(i) for i in range(20)}
    fake["bases"] = {i: ([_base()] if i else RuntimeError("x")) for i in range(20)}  # 1/20 = 5%
    out = task.compute_patterns()
    assert "error" in out and out["failed"] == 1 and fake["replaced"] == []


def test_zero_rows_is_error_not_replaced(fake):
    fake["bars"] = {"AAA": _bars(1), "BBB": _bars(2)}
    fake["bases"] = {1: [], 2: []}
    out = task.compute_patterns()
    assert out["rows"] == 0 and "error" in out and fake["replaced"] == []


def test_no_bars_skipped_and_empty_universe_ok(fake, monkeypatch):
    monkeypatch.setattr(task.cp, "latest_trading_date", lambda: None)
    assert task.compute_patterns() == {"skipped": "일봉 없음"}


def test_celery_include_and_task_name():
    from apps.collector.celery_app import celery_app

    assert "apps.collector.tasks.patterns" in celery_app.conf.include
    assert task.compute_patterns.name == "collector.compute_patterns"


def test_pipeline_patterns_failure_is_isolated(monkeypatch):
    import fakeredis

    from apps.collector.tasks import market_data as md

    monkeypatch.setattr(md, "get_sync_redis", lambda: fakeredis.FakeRedis(decode_responses=True))
    monkeypatch.setattr(md, "_daily_ohlcv", lambda: {})
    monkeypatch.setattr(md, "collect_market_indices", lambda region="KR": {})
    monkeypatch.setattr(md, "collect_investor_daily", lambda: {})
    monkeypatch.setattr(md, "compute_canslim", lambda: {})
    monkeypatch.setattr(md, "compute_market_groups", lambda: {})
    monkeypatch.setattr(md, "compute_screener", lambda: {"rows": 1})

    def boom():
        raise RuntimeError("patterns down")

    monkeypatch.setattr(md, "compute_patterns", boom)
    out = md.daily_market_pipeline()
    assert list(out)[-1] == "patterns" and "patterns down" in out["patterns"]["error"] and out["screener"] == {"rows": 1}

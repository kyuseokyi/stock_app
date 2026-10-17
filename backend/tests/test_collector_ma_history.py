"""겹침창(30일) 수집 MA — 직전 종가를 이어 붙여 전체 시계열 계산과 같은 값을 낸다."""
from __future__ import annotations

from datetime import date, timedelta

from apps.collector import indicators
from apps.collector.tasks import ohlcv as ohlcv_task


def _series(n: int) -> list[dict]:
    d0 = date(2026, 1, 1)
    return [
        {"date": d0 + timedelta(days=i), "open": 1.0, "high": 1.0, "low": 1.0, "close": 100.0 + (i * 7) % 13 + i * 0.5,
         "volume": 1}
        for i in range(n)
    ]


def test_history_prefix_matches_full_series():
    full = indicators.enrich_with_ma(_series(200))
    window = _series(200)[180:]
    history = [r["close"] for r in _series(200)[180 - indicators.HISTORY_BARS:180]]
    part = indicators.enrich_with_ma(window, history)
    assert len(part) == 20
    for a, b in zip(part, full[180:]):
        assert a["date"] == b["date"]
        for k in ("ma5", "ma20", "ma50", "ma120"):
            assert a[k] == b[k] and a[k] is not None


def test_without_history_window_only_is_unchanged_behavior():
    part = indicators.enrich_with_ma(_series(200)[180:])
    assert all(r["ma120"] is None and r["ma50"] is None for r in part)
    assert part[-1]["ma5"] is not None
    assert indicators.enrich_with_ma([], [1.0, 2.0]) == []


def test_short_history_new_listing():
    """상장 직후처럼 앞부분이 모자라면 가능한 MA 만 계산(나머지 None)."""
    s = _series(30)
    part = indicators.enrich_with_ma(s[10:], [r["close"] for r in s[:10]])
    full = indicators.enrich_with_ma(s)
    assert [r["ma20"] for r in part] == [r["ma20"] for r in full[10:]]
    assert all(r["ma50"] is None for r in part)


def test_enrich_overlap_window_uses_ch_history(monkeypatch):
    s = _series(200)
    seen = {}

    def fake_load(ticker, before, limit):
        seen.update(ticker=ticker, before=before, limit=limit)
        return [r["close"] for r in s[180 - limit:180]]

    monkeypatch.setattr(ohlcv_task, "load_closes_before", fake_load)
    out = ohlcv_task.enrich_overlap_window("005930", s[180:])
    assert seen == {"ticker": "005930", "before": s[180]["date"], "limit": indicators.HISTORY_BARS}
    assert out[-1]["ma120"] == indicators.enrich_with_ma(s)[-1]["ma120"]


def test_enrich_overlap_window_falls_back_on_ch_error(monkeypatch):
    def boom(*a):
        raise ConnectionError("CH down")

    monkeypatch.setattr(ohlcv_task, "load_closes_before", boom)
    out = ohlcv_task.enrich_overlap_window("005930", _series(200)[180:])
    assert len(out) == 20 and out[-1]["ma120"] is None  # 수집은 계속(기존 방식)
    assert ohlcv_task.enrich_overlap_window("005930", []) == []

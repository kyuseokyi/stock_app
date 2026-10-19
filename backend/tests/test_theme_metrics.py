"""테마 관리자 지표 — 최신 기준일 테마 지표(id 별), 종목 이름·등락 붙이기, CH·PG 실패 시 null(목록은 그대로)."""
from __future__ import annotations

from datetime import date

from apps.stock_api.services import theme_metrics as tm

D = date(2026, 10, 16)


def test_theme_metrics_by_id(monkeypatch):
    seen = []

    def q(sql, params=None):
        seen.append(sql)
        return [[D, "7", 1, 3.2, 5e11, 12, "000660"]]

    monkeypatch.setattr(tm, "_query", q)
    monkeypatch.setattr(tm, "_names", lambda tickers: {t: f"이름{t}" for t in tickers})
    assert tm.theme_metrics() == {"as_of": "2026-10-16", "themes": {"7": {
        "rank": 1, "chg_1d": 3.2, "value": 5e11, "members": 12, "leader_ticker": "000660",
        "leader_name": "이름000660"}}}
    assert "FINAL" in seen[0] and "kind = 'theme'" in seen[0] and "members > 0" in seen[0]


def test_theme_metrics_failure_returns_empty(monkeypatch):
    def boom(sql, params=None):
        raise RuntimeError("ch down")

    monkeypatch.setattr(tm, "_query", boom)
    assert tm.theme_metrics() == {"as_of": None, "themes": {}}


def test_attach_stock_metrics(monkeypatch):
    monkeypatch.setattr(tm, "_query", lambda sql, params=None: [["A", 1.5, 1e9]])
    monkeypatch.setattr(tm, "_names", lambda tickers: {"A": "에이"})
    rows = [{"ticker": "A", "source": "kis", "is_excluded": False, "reason": None},
            {"ticker": "B", "source": "admin", "is_excluded": True, "reason": "x"}]
    out = tm.attach_stock_metrics(rows)
    assert out[0] == {"ticker": "A", "source": "kis", "is_excluded": False, "reason": None,
                      "name": "에이", "chg_1d": 1.5, "value": 1e9}
    assert out[1]["name"] is None and out[1]["chg_1d"] is None and out[1]["reason"] == "x"


def test_attach_stock_metrics_failures_keep_rows(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(tm, "_query", boom)
    monkeypatch.setattr(tm, "_names", boom)
    out = tm.attach_stock_metrics([{"ticker": "A", "source": "kis", "is_excluded": False, "reason": None}])
    assert out == [{"ticker": "A", "source": "kis", "is_excluded": False, "reason": None,
                    "name": None, "chg_1d": None, "value": None}]
    assert tm.attach_stock_metrics([]) == []

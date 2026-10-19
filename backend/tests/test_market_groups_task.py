"""시장 그룹 태스크 — 하루 계산·저장·숨김 테마 덮어쓰기, 테마 조회 실패 시 업종만, 60일 백필(날짜별 격리)."""
from datetime import date

import pytest

from apps.collector.tasks import market_groups as task

D1, D2 = date(2026, 10, 15), date(2026, 10, 16)


@pytest.fixture
def fake(monkeypatch):
    calls = {"compute": [], "stocks": [], "groups": [], "themes": {"7": ("반도체", ["AAA"])}}
    monkeypatch.setattr(task.cg, "ensure_market_group_tables", lambda: None)
    monkeypatch.setattr(task.cg, "latest_trading_date", lambda: D2)
    monkeypatch.setattr(task.cg, "trading_dates", lambda as_of, n: [D1, D2][-n:])
    monkeypatch.setattr(task.cg, "load_bars", lambda as_of: {"AAA": as_of})
    monkeypatch.setattr(task.cg, "existing_group_ids", lambda as_of, kind: {"7", "9"})
    monkeypatch.setattr(task.cg, "upsert_stocks", lambda rows: calls["stocks"].append(rows) or len(rows))
    monkeypatch.setattr(task.cg, "upsert_groups", lambda rows: calls["groups"].append(rows) or len(rows))
    monkeypatch.setattr(task, "_universe", lambda: [("AAA", "에이", "KOSPI")])
    monkeypatch.setattr(task, "_profiles", lambda: {"AAA": ("KOSPI", "0013", 1, False)})
    monkeypatch.setattr(task, "_sector_names", lambda: {"0013": "전기·전자"})

    def themes():
        if isinstance(calls["themes"], Exception):
            raise calls["themes"]
        return calls["themes"]

    monkeypatch.setattr(task, "_themes", themes)

    def compute_day(as_of, universe, profiles, bars, themes_, sector_names):
        calls["compute"].append((as_of, themes_, bars))
        if as_of == calls.get("fail_on"):
            raise RuntimeError("bad day")
        groups = [{"kind": "theme", "group_id": gid} for gid in themes_] + [{"kind": "sector", "group_id": "0013"}]
        return [{"ticker": "AAA"}], groups

    monkeypatch.setattr(task, "compute_day", compute_day)
    return calls


def test_compute_latest_with_tombstones(fake):
    out = task.compute_market_groups()
    assert out == {"date": "2026-10-16", "stocks": 1, "themes": 1, "sectors": 1, "removed_themes": 1}
    assert fake["compute"][0][0] == D2 and fake["compute"][0][2] == {"AAA": D2}
    saved = fake["groups"][0]
    gone = [r for r in saved if r["group_id"] == "9"]
    assert len(gone) == 1 and gone[0]["members"] == 0 and gone[0]["kind"] == "theme"


def test_compute_explicit_date(fake):
    task.compute_market_groups("2026-10-15")
    assert fake["compute"][0][0] == D1


def test_theme_lookup_failure_keeps_sectors_and_skips_tombstones(fake):
    fake["themes"] = RuntimeError("pg down")
    out = task.compute_market_groups()
    assert out["themes"] == 0 and out["sectors"] == 1 and out["removed_themes"] == 0
    assert all(r["group_id"] != "9" for r in fake["groups"][0])


def test_no_bars_yet(fake, monkeypatch):
    monkeypatch.setattr(task.cg, "latest_trading_date", lambda: None)
    assert task.compute_market_groups() == {"skipped": "일봉 없음"}


def test_backfill_isolates_failed_day(fake):
    fake["fail_on"] = D1
    out = task.backfill_market_groups(days=2)
    assert out["ok"] == ["2026-10-16"] and out["failed"][0]["date"] == "2026-10-15"

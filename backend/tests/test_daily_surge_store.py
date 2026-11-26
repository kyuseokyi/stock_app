"""급등락 집계 실행·저장 — 일봉 미확정 건너뜀, 공시·테마 실패 격리, 날짜 단위 교체(멱등), 메모 보존 (sqlite)."""
from __future__ import annotations

from datetime import date

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

import shared.daily_surge_models  # noqa: F401 — 표 등록
from shared.daily_surge_models import DailySurgeNote, DailySurgeStock, DailySurgeThemeGroup
from shared.models import Base
from apps.collector.daily_surge import repository as repo
from apps.collector.daily_surge.run import Deps, run_day

T = date(2026, 11, 26)
P = date(2026, 11, 25)


@pytest.fixture
def session_factory():
    engine = sa.create_engine("sqlite://")
    Base.metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


def _universe(n_filler: int = 0):
    """A·B 화장품 급등, C 급락, D 보합 대금 큼 + 채움 종목 n개."""
    today = {"A": (120.0, 100), "B": (115.0, 100), "C": (80.0, 100), "D": (101.0, 100_000)}
    prev = {"A": (100.0, 10), "B": (100.0, 10), "C": (100.0, 10), "D": (100.0, 10)}
    for i in range(n_filler):
        t = f"F{i:04d}"
        today[t] = (100.0, 1)
        prev[t] = (100.0, 1)
    return today, prev


def _deps(store_calls, *, today, prev, themes=None, theme_error=None, dart=None, dart_error=()):
    def _themes():
        if theme_error:
            raise theme_error
        return themes if themes is not None else {1: ("화장품", ["A", "B"])}, "kiwoom"

    def _dart(ticker, bgn, end):
        if ticker in dart_error:
            raise RuntimeError("dart down")
        return (dart or {}).get(ticker, [])

    return Deps(
        latest_date=lambda: T,
        prev_date=lambda d: P,
        load_day=lambda d: today if d == T else prev,
        profiles=lambda: {t: ("KOSDAQ", True) for t in today},
        names=lambda tickers: {t: f"이름{t}" for t in tickers},
        themes=_themes,
        dart=_dart,
        store=lambda d, stocks, groups, source: store_calls.append((d, stocks, groups, source)) or len(stocks),
    )


def test_skips_when_day_not_settled():
    today, prev = _universe()
    calls: list = []
    out = run_day(None, _deps(calls, today=today, prev=prev), min_rows=10)
    assert out["skipped"].startswith("일봉 미확정")
    assert calls == []


def test_run_day_builds_rows_groups_and_dart():
    today, prev = _universe(n_filler=20)
    calls: list = []
    dart = {"C": [("20261125", "R1", "주주배정 유상증자 결정")]}
    out = run_day("2026-11-26", _deps(calls, today=today, prev=prev, dart=dart), min_rows=10, top_n=1)
    assert out["date"] == "2026-11-26" and out["theme_source"] == "kiwoom"
    assert (out["surge"], out["plunge"], out["groups"], out["dart_failed"]) == (2, 1, 1, 0)
    (d, stocks, groups, source) = calls[0]
    assert d == T and source == "kiwoom"
    by = {s["ticker"]: s for s in stocks}
    assert set(by) == {"A", "B", "C", "D"}  # 채움 종목은 대상 아님
    assert by["A"]["primary_theme_name"] == "화장품" and by["A"]["name"] == "이름A"
    assert by["C"]["dart_keywords"] == ["#유상증자"] and by["C"]["dart_items"][0]["when"] == "prev"
    assert groups[0]["leader_ticker"] == "A"


def test_dart_and_theme_failures_are_isolated():
    today, prev = _universe(n_filler=20)
    calls: list = []
    out = run_day(T, _deps(calls, today=today, prev=prev, theme_error=RuntimeError("pg"), dart_error=("A",)),
                  min_rows=10)
    assert out["dart_failed"] == 1 and out["theme_error"]
    (_d, stocks, groups, source) = calls[0]
    assert groups == [] and source == "none"
    assert {s["ticker"]: s["dart_items"] for s in stocks}["A"] == []


def test_dart_none_means_no_key():
    today, prev = _universe(n_filler=20)
    calls: list = []
    deps = _deps(calls, today=today, prev=prev)
    deps.dart = None
    out = run_day(T, deps, min_rows=10)
    assert out["dart"] == "키 없음"


def test_replace_day_is_idempotent_and_keeps_notes(session_factory):
    today, prev = _universe(n_filler=20)
    calls: list = []
    run_day(T, _deps(calls, today=today, prev=prev), min_rows=10)
    _d, stocks, groups, source = calls[0]
    with session_factory() as s:
        s.add(DailySurgeNote(trade_date=T, scope="theme", target="1", note="한한령 해제 기대"))
        s.add(DailySurgeStock(trade_date=P, ticker="OLD", name="옛", market="KOSPI", close=1, prev_close=1,
                              change_price=0, change_rate=0, volume=1, trading_value=1))
        s.commit()
    for _ in range(2):
        with session_factory() as s:
            repo.replace_day(s, T, stocks, groups, source)
    with session_factory() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(DailySurgeStock).where(
            DailySurgeStock.trade_date == T)) == len(stocks)
        assert s.scalar(sa.select(sa.func.count()).select_from(DailySurgeThemeGroup)) == len(groups) == 1
        assert s.scalar(sa.select(sa.func.count()).select_from(DailySurgeNote)) == 1
        assert s.get(DailySurgeStock, (P, "OLD")) is not None
        g = s.scalars(sa.select(DailySurgeThemeGroup)).one()
        assert (g.theme_source, g.members) == ("kiwoom", ["A", "B"])

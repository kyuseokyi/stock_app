"""전종목 일봉·백필의 키움 폴백 연결 — 호출 조건·집계 키(KIS·키움·CH 모두 가짜)."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest
import requests

from apps.collector.kis.client import KISConnectionError
from apps.collector.kiwoom.client import KiwoomIpError
from apps.collector.kiwoom.daily_fallback import DailyFallback
from apps.collector.tasks import universe
from shared.kiwoom_config import KiwoomConfig

CFG_ON = KiwoomConfig(app_key="FAKEAPPKEY1234567890", app_secret="FAKESECRET-abcdef")
CFG_OFF = KiwoomConfig(app_key="", app_secret="")
ROW = {"date": date(2026, 11, 13), "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 10}


class _FakeKISClient:
    def __init__(self, limiter=None):
        pass

    def close(self):
        pass


class _FakeKiwoomClient:
    created = 0

    def __init__(self):
        type(self).created += 1

    def close(self):
        pass


@pytest.fixture
def env(monkeypatch):
    """KIS·키움·CH 가짜. kis[ticker] = 행 리스트 | 예외. kiwoom[ticker] = 행 리스트 | 예외."""
    state = SimpleNamespace(kis={}, kiwoom={}, kis_calls=[], kiwoom_calls=[], upserts=[], ensured=0)
    _FakeKiwoomClient.created = 0

    tickers = ["A", "B", "C"]
    monkeypatch.setattr(universe, "load_domestic_tickers",
                        lambda source=None: [SimpleNamespace(ticker=t, name=t) for t in tickers])
    monkeypatch.setattr(universe, "KISClient", _FakeKISClient)
    monkeypatch.setattr(universe.time, "sleep", lambda s: None)
    monkeypatch.setattr(universe, "enrich_overlap_window", lambda t, rows: rows)
    monkeypatch.setattr(universe, "enrich_with_ma", lambda rows: rows)

    def kis(ticker, s, e, client=None):
        state.kis_calls.append(ticker)
        v = state.kis.get(ticker, [ROW])
        if isinstance(v, Exception):
            raise v
        return v

    monkeypatch.setattr(universe, "fetch_domestic_daily", kis)
    monkeypatch.setattr(universe, "fetch_domestic_daily_range", kis)

    def kiwoom(ticker, s, e, *, client):
        state.kiwoom_calls.append(ticker)
        v = state.kiwoom.get(ticker, [ROW])
        if isinstance(v, Exception):
            raise v
        return v

    monkeypatch.setattr(universe.kiwoom_fetcher, "fetch_daily_ohlcv", kiwoom)

    def upsert(ticker, rows, source=None):
        state.upserts.append((ticker, len(rows), source))
        return len(rows)

    monkeypatch.setattr(universe, "upsert_daily_prices", upsert)

    def ensure():
        state.ensured += 1

    monkeypatch.setattr(universe, "ensure_daily_prices_source", ensure)

    def on(enabled=True):
        cfg = CFG_ON if enabled else CFG_OFF
        monkeypatch.setattr("apps.collector.kiwoom.daily_fallback.get_kiwoom_config", lambda: cfg)
        monkeypatch.setattr("apps.collector.kiwoom.daily_fallback.KiwoomClient", _FakeKiwoomClient)
        # DailyFallback 기본 인자는 정의 시점 값 → 팩토리를 가짜로 바꿔 끼운다
        monkeypatch.setattr(universe, "DailyFallback",
                            lambda store, ensure_column=None: DailyFallback(
                                store, client_factory=_FakeKiwoomClient, ensure_column=ensure_column))

    state.on = on
    monkeypatch.delenv("KIWOOM_FALLBACK_ENABLED", raising=False)
    return state


def test_kis_success_does_not_call_kiwoom(env):
    env.on()
    res = universe.collect_all_daily(workers=1)
    assert env.kiwoom_calls == [] and _FakeKiwoomClient.created == 0 and env.ensured == 0
    assert res["ok"] == 3 and res["kiwoom_fallback"] == 0 and res["kiwoom_failed"] == 0
    assert all(src is None for _, _, src in env.upserts)  # KIS 적재는 source 생략(DEFAULT 'kis')


def test_kis_exception_falls_back_to_kiwoom(env):
    env.on()
    env.kis["B"] = requests.HTTPError("rt_cd=1")
    res = universe.collect_all_daily(workers=1)
    assert env.kiwoom_calls == ["B"]
    assert ("B", 1, "kiwoom") in env.upserts and env.ensured == 1
    assert res["ok"] == 3 and res["failed_count"] == 0 and res["kiwoom_fallback"] == 1
    assert res["failed_sample"] == []


def test_connection_error_goes_through_kis_retry_first(env):
    env.on()
    env.kis["A"] = KISConnectionError("reset")
    res = universe.collect_all_daily(workers=1)
    # KIS 1차·2차 재시도 모두 거친 뒤에만 키움
    assert env.kis_calls.count("A") == 2
    assert env.kiwoom_calls == ["A"]
    assert res["retried_ok"] == 0 and res["ok"] == 3 and res["kiwoom_fallback"] == 1


def test_un_j_empty_falls_back_to_kiwoom(env):
    env.on()
    env.kis["C"] = []
    res = universe.collect_all_daily(workers=1)
    assert env.kiwoom_calls == ["C"]
    assert res["ok"] == 3 and res["kiwoom_fallback"] == 1 and res["kiwoom_failed"] == 0


def test_kiwoom_failure_keeps_kis_failure(env):
    env.on()
    env.kis["A"] = requests.HTTPError("rt_cd=1")
    env.kiwoom["A"] = RuntimeError("키움 오류")
    res = universe.collect_all_daily(workers=1)
    assert res["ok"] == 2 and res["failed_count"] == 1 and res["failed_sample"][0]["ticker"] == "A"
    assert res["kiwoom_fallback"] == 0 and res["kiwoom_failed"] == 1


def test_kiwoom_ip_error_stops_fallback_warns_once(env, caplog):
    env.on()
    env.kis["A"] = requests.HTTPError("x")
    env.kis["B"] = requests.HTTPError("y")
    env.kiwoom["A"] = KiwoomIpError(8010, "IP")
    res = universe.collect_all_daily(workers=1)
    assert env.kiwoom_calls == ["A"]  # 8010 뒤 나머지 키움 호출 없음
    assert res["failed_count"] == 2 and res["kiwoom_failed"] == 1
    assert caplog.text.count("키움 폴백을 끕니다") == 1


def test_disabled_without_keys_keeps_old_result_shape(env):
    env.on(enabled=False)
    env.kis["A"] = requests.HTTPError("x")
    env.kis["C"] = []
    res = universe.collect_all_daily(workers=1)
    assert env.kiwoom_calls == []
    assert list(res) == ["total", "ok", "retried_ok", "failed_count", "inserted", "elapsed_sec", "failed_sample"]


def test_disabled_by_env_flag(env, monkeypatch):
    env.on()
    monkeypatch.setenv("KIWOOM_FALLBACK_ENABLED", "false")
    env.kis["A"] = requests.HTTPError("x")
    res = universe.collect_all_daily(workers=1)
    assert env.kiwoom_calls == [] and "kiwoom_fallback" not in res


def test_result_keys_order_kiwoom_before_failed_sample(env):
    env.on()
    res = universe.collect_all_daily(workers=1)
    keys = list(res)
    assert keys.index("kiwoom_fallback") < keys.index("failed_sample")
    assert keys.index("kiwoom_failed") < keys.index("failed_sample")


def test_backfill_falls_back_with_same_range(env, monkeypatch):
    env.on()
    seen = []
    monkeypatch.setattr(universe.kiwoom_fetcher, "fetch_daily_ohlcv",
                        lambda t, s, e, *, client: seen.append((t, s, e)) or [ROW, {**ROW, "date": date(2026, 11, 14)}])
    env.kis["B"] = KISConnectionError("reset")
    res = universe.backfill_all_daily(months=1, end="20261015", workers=1)
    assert seen == [("B", "20260914", "20261015")]
    assert ("B", 2, "kiwoom") in env.upserts
    assert res["ok"] == 3 and res["kiwoom_fallback"] == 1


def test_backfill_disabled_calls_run_universe_like_before(env, monkeypatch):
    env.on(enabled=False)
    calls = []

    def fake_run(one, limit, source, rate, workers):  # 기존 시그니처(폴백 인자 없음)
        calls.append(1)
        return {"ok": 0}

    monkeypatch.setattr(universe, "_run_universe", fake_run)
    universe.backfill_all_daily(months=1, end="20261015")
    universe.collect_all_daily()
    assert calls == [1, 1]

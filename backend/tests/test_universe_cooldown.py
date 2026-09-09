"""apps.collector.tasks.universe 회귀 테스트.

전종목 수집 견고성: 연결계열(KISConnectionError) 연속 실패 시 적응형 쿨다운(에스컬레이트,
성공 시 리셋)과, 연결계열만 골라 2차 재시도하는 로직을 검증한다. 4xx·rt_cd 논리오류는
쿨다운/재시도 대상이 아님(retryable=False).
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import requests

from apps.collector.kis.client import KISConnectionError
from apps.collector.tasks import universe


class _Limiter:
    def acquire(self):
        pass


@pytest.fixture
def det_cooldown(monkeypatch):
    """쿨다운 상수를 결정적 소값으로 고정."""
    monkeypatch.setattr(universe, "_COOLDOWN_THRESHOLD", 3)
    monkeypatch.setattr(universe, "_COOLDOWN_BASE_SEC", 10)
    monkeypatch.setattr(universe, "_COOLDOWN_MAX_SEC", 40)
    sleeps = []
    monkeypatch.setattr(universe.time, "sleep", lambda s: sleeps.append(s))
    return sleeps


def test_collect_pass_classifies_and_escalates(det_cooldown):
    sleeps = det_cooldown

    def collect_one(ticker, client):
        if ticker == "LOGIC":
            raise requests.HTTPError("rt_cd=1")           # 논리오류 → 재시도 불가
        if ticker.startswith("CONN"):
            raise KISConnectionError("[Errno 24] too many open files")  # 연결계열
        return 1

    targets = [("CONN1", "a"), ("CONN2", "b"), ("CONN3", "c"),
               ("CONN4", "d"), ("CONN5", "e"), ("OK", "f"), ("LOGIC", "g")]
    ok, inserted, failed = universe._collect_pass(targets, collect_one, None, _Limiter(), "T")

    assert ok == 1 and inserted == 1
    retryable = [f for f in failed if f["retryable"]]
    nonretry = [f for f in failed if not f["retryable"]]
    assert len(retryable) == 5                     # 연결계열 5건
    assert len(nonretry) == 1 and nonretry[0]["ticker"] == "LOGIC"
    # threshold=3 → 3·4·5번째 연속 실패에서 쿨다운, base 10→20→40 에스컬레이트(상한 40)
    assert sleeps == [10, 20, 40]


def test_collect_pass_resets_on_success(det_cooldown):
    sleeps = det_cooldown
    seq = {"i": 0}

    def collect_one(ticker, client):
        # 실패 2회 → 성공 → 실패 2회 : 성공이 카운터를 리셋하므로 임계치(3) 미도달 → 쿨다운 없음
        if ticker in ("OK",):
            return 1
        raise KISConnectionError("conn")

    targets = [("C1", ""), ("C2", ""), ("OK", ""), ("C3", ""), ("C4", "")]
    ok, _, failed = universe._collect_pass(targets, collect_one, None, _Limiter(), "T")
    assert ok == 1
    assert len(failed) == 4
    assert sleeps == []                            # 연속 실패가 3에 도달 못 함


def test_run_universe_retries_only_connection_failures(monkeypatch):
    tickers = [SimpleNamespace(ticker=f"00{i}", name=f"n{i}") for i in range(4)]
    monkeypatch.setattr(universe, "load_domestic_tickers", lambda source: tickers)
    monkeypatch.setattr(universe, "KISClient", lambda: object())
    monkeypatch.setattr(universe, "RateLimiter", lambda r: _Limiter())
    monkeypatch.setattr(universe.time, "sleep", lambda s: None)

    seen = set()

    def collect_one(ticker, client):
        if ticker == "003":
            raise requests.HTTPError("rt_cd=1")        # 영구 논리오류 → 2차 재시도 안 함
        if ticker == "002" and ticker not in seen:
            seen.add(ticker)
            raise KISConnectionError("[Errno 24]")     # 1차만 실패 → 2차 회복
        return 1

    res = universe._run_universe(collect_one, None, None, None)
    assert res["total"] == 4
    assert res["ok"] == 3                 # 000,001 1차 + 002 2차 회복
    assert res["retried_ok"] == 1
    assert res["failed_count"] == 1       # 003 만 최종 실패
    assert res["failed_sample"][0]["ticker"] == "003"
    assert res["inserted"] == 3

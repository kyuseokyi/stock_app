"""공용 픽스처 — 트레이딩 게임 실시간 경로의 프로세스 전역 상태를 테스트마다 초기화.

포지션 캐시·최신 틱은 모듈 싱글턴이라 테스트 간에 남으면(같은 autoincrement id 의 다른 DB)
순서 의존 실패가 난다. 이미 import 된 경우에만 리셋한다(불필요한 import 강제 금지).
"""
from __future__ import annotations

import sys

import pytest


@pytest.fixture(autouse=True)
def _reset_game_realtime_state():
    def _reset():
        pc = sys.modules.get("apps.trading_game.services.position_cache")
        if pc is not None:
            pc.reset_cache()
        tl = sys.modules.get("apps.trading_game.services.tick_listener")
        if tl is not None:
            tl.reset_conflation_state()

    _reset()
    yield
    _reset()


@pytest.fixture(autouse=True)
def _isolate_game_redis(monkeypatch):
    """trading_game 프로세스 Redis 싱글턴을 fakeredis 로 — WS 버스 발행·캐시 dirty 알림이
    실제 로컬 Redis(db0)로 새지 않게. 개별 테스트의 get_redis monkeypatch 는 그대로 우선한다."""
    from fakeredis import aioredis as fake_aioredis

    from apps.trading_game import deps  # 가벼운 모듈(redis 클라이언트 지연 생성)

    monkeypatch.setattr(deps, "_redis", fake_aioredis.FakeRedis(decode_responses=True))
    yield


@pytest.fixture(autouse=True)
def _isolate_auth_redis(monkeypatch):
    """auth 프로세스 Redis 싱글턴도 fakeredis 로 — 로그인 시 세션 교체 알림 발행이 실제 Redis 로 새지 않게."""
    from fakeredis import aioredis as fake_aioredis

    from apps.auth import deps as auth_deps

    monkeypatch.setattr(auth_deps, "_redis", fake_aioredis.FakeRedis(decode_responses=True))
    yield


@pytest.fixture(autouse=True)
def _market_data_switch_on(monkeypatch):
    """A안 시세 스위치(MARKET_DATA)는 기본 OFF 지만, 기존 시세 테스트는 '공개 상태'의 동작을 검증한다 → 기본 ON.
    판정 지점(market_access.market_data_switch_on)만 바꿔 enabled_map 의 '행 없음·DB 오류 = OFF' 규칙은 그대로 시험된다.
    OFF 동작은 tests/test_market_access.py 가 이 함수를 다시 덮어써 검증한다."""
    from apps.stock_api.services import market_access

    monkeypatch.setattr(market_access, "market_data_switch_on", lambda: True)
    yield

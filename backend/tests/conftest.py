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

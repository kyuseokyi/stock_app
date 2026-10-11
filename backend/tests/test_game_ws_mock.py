"""Mock 틱 생성기 단위 테스트(순수 next_tick)."""
from __future__ import annotations

import random

from apps.collector.game_ws.mock_stream import next_tick

BASE = 71500


def test_next_tick_keys_and_types():
    _, tick = next_tick("005930", BASE, BASE)
    assert set(tick) == {"ticker", "price", "change_price", "change_rate", "volume", "timestamp"}
    assert tick["ticker"] == "005930"
    assert isinstance(tick["price"], int) and tick["price"] > 0
    assert isinstance(tick["change_price"], int)
    assert isinstance(tick["change_rate"], float)
    assert tick["timestamp"].endswith("+09:00")  # KST ISO8601


def test_next_tick_step_within_bound():
    random.seed(0)
    prev = float(BASE)
    for _ in range(50):
        new_price, tick = next_tick("005930", prev, BASE)
        # 한 스텝 변동은 ±0.3% 이내(소수 반올림 여유 포함)
        assert abs(new_price / prev - 1) <= 0.0031
        prev = new_price


def test_next_tick_change_relative_to_base():
    new_price, tick = next_tick("005930", 72000.0, BASE)
    assert tick["change_price"] == int(round(new_price - BASE))
    assert tick["change_rate"] == round((new_price / BASE - 1) * 100, 2)

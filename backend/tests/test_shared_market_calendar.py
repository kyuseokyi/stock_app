"""거래일 판정을 shared 로 옮김 — 게임 경로(apps.trading_game.services.market_calendar)는 같은 함수를 다시 내보낸다."""
from datetime import date

import pytest

from apps.trading_game.services import market_calendar as game_cal
from shared import market_calendar as shared_cal


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)


def test_game_path_reexports_shared_functions():
    assert game_cal.is_trading_day is shared_cal.is_trading_day
    assert game_cal.krx_year_end_closing is shared_cal.krx_year_end_closing
    assert game_cal._manual_holidays is shared_cal._manual_holidays
    assert game_cal._kr_holidays is shared_cal._kr_holidays


def test_shared_judges_weekend_and_weekday():
    assert shared_cal.is_trading_day(date(2026, 10, 17)) is False  # 토
    assert shared_cal.is_trading_day(date(2026, 10, 20)) is True   # 화

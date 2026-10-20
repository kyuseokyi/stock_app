"""하위 호환 — 거래일 판정은 shared/market_calendar.py 로 옮겼다(collector 장중 지수도 같이 쓴다).

게임 코드(market_clock 등)·테스트의 기존 import 경로를 그대로 유지하려고 같은 함수를 다시 내보낸다.
밑줄 이름도 명시적으로 내보낸다(별표 import 는 밑줄 이름을 빠뜨림).
"""
from shared.market_calendar import (  # noqa: F401
    _kr_holidays,
    _manual_holidays,
    is_trading_day,
    krx_year_end_closing,
)

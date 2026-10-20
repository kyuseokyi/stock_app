"""국내 증시 거래일 달력 — 주말·공휴일(대체공휴일 포함)·KRX 연말 휴장·수동 휴장일 제외.

- 공휴일: `holidays.KR`(설·추석 음력 연휴, 대체공휴일, 노동절, 선거일 등 법정 공휴일)
- KRX 전용: 연말 휴장(12/31, 주말이면 그 직전 평일)
- 수동: MARKET_HOLIDAYS="2026-06-03,2026-10-02" — 임시공휴일처럼 라이브러리가 아직 모르는 날
- TRADING_DAYS=ALL 이면 매일 거래일(로컬에서 주말에 게임을 검증할 때, TRADING_WINDOWS=00:00-23:59 와 함께)
"""
from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from functools import lru_cache

import holidays

log = logging.getLogger(__name__)


@lru_cache(maxsize=16)
def _kr_holidays(year: int) -> frozenset[date]:
    return frozenset(holidays.KR(years=year).keys())


def krx_year_end_closing(year: int) -> date:
    """KRX 연말 휴장일 — 12/31, 주말이면 그 직전 평일."""
    d = date(year, 12, 31)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


@lru_cache(maxsize=8)
def _manual_holidays(raw: str | None) -> frozenset[date]:
    """쉼표로 구분한 YYYY-MM-DD. 잘못된 항목은 경고 후 무시 — 설정 실수 하나로 주문 전체가 500 이 되지 않게."""
    out = set()
    for part in (raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.add(date.fromisoformat(part))
        except ValueError:
            log.warning("MARKET_HOLIDAYS 항목 무시(YYYY-MM-DD 아님): %r", part)
    return frozenset(out)


def is_trading_day(d: date, *, manual: str | None = None, days: str | None = None) -> bool:
    """d 가 국내 증시 거래일인가. manual·days 미지정이면 환경 변수(MARKET_HOLIDAYS·TRADING_DAYS)."""
    days = os.getenv("TRADING_DAYS", "") if days is None else days
    if days.strip().upper() == "ALL":
        return True
    if d.weekday() >= 5:
        return False
    if d in _kr_holidays(d.year) or d == krx_year_end_closing(d.year):
        return False
    manual = os.getenv("MARKET_HOLIDAYS") if manual is None else manual
    return d not in _manual_holidays(manual)

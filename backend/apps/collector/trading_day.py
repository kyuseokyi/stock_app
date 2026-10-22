"""마지막 확정 거래일 — 장중 미완성 봉을 백필에 넣지 않기 위한 끝 날짜.

KST 평일 20:30(일일 파이프라인 시각, NXT 애프터마켓 20:00 마감 뒤) 이후면 오늘, 아니면 직전 평일.
공휴일은 따로 거르지 않는다 — KIS 가 그날 빈 응답을 주므로 끝 날짜로 넣어도 문제없다.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

KST = timezone(timedelta(hours=9))  # intraday_indices 와 같은 방식(고정 +9, 일광절약 없음)
CONFIRM_AT = time(20, 30)


def now_kst() -> datetime:
    return datetime.now(KST)


def to_kst(now: datetime | None) -> datetime:
    """None 이면 지금. naive 는 KST 로 간주, aware 는 KST 로 변환."""
    if now is None:
        return now_kst()
    return now.replace(tzinfo=KST) if now.tzinfo is None else now.astimezone(KST)


def _prev_weekday(d: date) -> date:
    d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def last_confirmed_trading_day(now: datetime | None = None) -> date:
    now = to_kst(now)
    today = now.date()
    if today.weekday() < 5 and now.time() >= CONFIRM_AT:
        return today
    return _prev_weekday(today)

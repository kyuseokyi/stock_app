"""거래 세션 창 + 최신가 신선도 게이트.

거래시간을 코드에 하드코딩하지 않고 설정 데이터(TRADING_WINDOWS)로 둔다.
기본 = KRX 정규장(09:00-15:30) + 애프터마켓(16:00-20:00). NXT 프리마켓 제외.
거래일(주말·공휴일·대체공휴일·KRX 연말 휴장 제외)은 market_calendar 가 판정한다.
"""
from __future__ import annotations

import json
import os
import time as _time
from datetime import datetime, time, timedelta, timezone

from apps.trading_game.services import market_calendar

KST = timezone(timedelta(hours=9))
DEFAULT_WINDOWS = "09:00-15:30,16:00-20:00"


def parse_windows(raw: str | None) -> list[tuple[time, time]]:
    """'HH:MM-HH:MM,HH:MM-HH:MM' → [(time,time), ...]. None 이면 기본값."""
    spec = raw or DEFAULT_WINDOWS
    out: list[tuple[time, time]] = []
    for part in spec.split(","):
        start_s, end_s = part.strip().split("-")
        sh, sm = map(int, start_s.split(":"))
        eh, em = map(int, end_s.split(":"))
        out.append((time(sh, sm), time(eh, em)))
    return out


def load_windows() -> list[tuple[time, time]]:
    return parse_windows(os.getenv("TRADING_WINDOWS"))


def in_trading_window(now_kst: datetime, windows: list[tuple[time, time]]) -> bool:
    """거래일이고 거래 시간 창 안인가(now_kst 는 KST 시각)."""
    if not market_calendar.is_trading_day(now_kst.date()):
        return False
    t = now_kst.timetz().replace(tzinfo=None)
    return any(start <= t <= end for start, end in windows)


def is_price_fresh(latest_ts: float, now_epoch: float, stale_seconds: int) -> bool:
    return (now_epoch - latest_ts) <= stale_seconds


async def read_latest(redis, ticker: str) -> dict | None:
    """stock:latest:{ticker} → {'price':..., 'ts':...} 또는 None."""
    raw = await redis.get(f"stock:latest:{ticker}")
    if raw is None:
        return None
    return json.loads(raw)


def now_kst() -> datetime:
    return datetime.now(KST)


def now_epoch() -> float:
    return _time.time()

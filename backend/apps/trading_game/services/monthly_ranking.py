"""월간 랭킹 순수 로직(분기 시즌 전용) — 월 경계(1일 09:00 KST, 시즌 창으로 잘림)·Redis 키.

월간 ROI 는 주간과 같은 NAV 비율(weekly_ranking.weekly_roi). DB/보상 서비스를 import 하지 않는다.
"""
from __future__ import annotations

from datetime import date, datetime

from apps.trading_game.services.weekly_ranking import KST, WEEK_START, aware

MONTH_START = WEEK_START  # 09:00 KST
MONTH_TTL_SEC = 100 * 24 * 3600


def _first_of_next(d: date) -> date:
    return date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)


def month_bounds(
    now: datetime, season_start: datetime, season_end: datetime | None,
) -> tuple[date, datetime, datetime]:
    """(month_id=그 달 1일, 잘린 시작, 잘린 끝). 구간 = 1일 09:00 ~ 다음 달 1일 09:00 KST."""
    k = aware(now).astimezone(KST)
    first = date(k.year, k.month, 1)
    start = datetime.combine(first, MONTH_START, tzinfo=KST)
    if k < start:  # 1일 09:00 전 = 지난달
        first = date(k.year - 1, 12, 1) if k.month == 1 else date(k.year, k.month - 1, 1)
        start = datetime.combine(first, MONTH_START, tzinfo=KST)
    end = datetime.combine(_first_of_next(first), MONTH_START, tzinfo=KST)
    s = max(start, aware(season_start).astimezone(KST))
    e = min(end, aware(season_end).astimezone(KST)) if season_end is not None else end
    return first, s, e


def month_key(season_id: int, month_id: date) -> str:
    return f"game:season:{season_id}:month:{month_id.isoformat()}:ranking"


def base_key(season_id: int, month_id: date) -> str:
    return f"game:season:{season_id}:month:{month_id.isoformat()}:base"

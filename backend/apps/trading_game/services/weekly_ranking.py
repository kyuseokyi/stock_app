"""주간 랭킹 순수 로직 — 주 경계(월 09:00 KST, 시즌 창으로 잘림)·주간 ROI·Redis 키.

DB/보상 서비스를 import 하지 않는다(ranking_service ← reward_service 순환 방지).
주간 ROI 는 NAV 비율: grant_cash 가 ROI 를 보존하므로 (1+roi)/(1+base) 는 보상과 무관하다.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

KST = timezone(timedelta(hours=9))
WEEK_START = time(9, 0)
REWARDS: dict[int, Decimal] = {1: Decimal("500000"), 2: Decimal("300000"), 3: Decimal("200000")}
ARCHIVE_TOP = 10
WEEK_TTL_SEC = 21 * 24 * 3600
_PCT_Q = Decimal("0.0001")


def aware(dt: datetime) -> datetime:
    """naive(SQLite) 는 UTC 로 해석 — settlement 와 같은 규칙."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def week_bounds(
    now: datetime, season_start: datetime, season_end: datetime | None,
) -> tuple[date, datetime, datetime]:
    """(week_id=잘리기 전 주 시작 월요일, 잘린 시작, 잘린 끝). 반환 시각은 KST aware."""
    k = aware(now).astimezone(KST)
    monday = (k - timedelta(days=k.weekday())).date()
    start = datetime.combine(monday, WEEK_START, tzinfo=KST)
    if k < start:
        start -= timedelta(days=7)
    end = start + timedelta(days=7)
    s = max(start, aware(season_start).astimezone(KST))
    e = min(end, aware(season_end).astimezone(KST)) if season_end is not None else end
    return start.date(), s, e


def weekly_roi(roi: Decimal, base: Decimal) -> Decimal:
    """주간 ROI(%) = ((1+roi/100)/(1+base/100) − 1)×100. 분모 ≤ 0 이면 0."""
    denom = Decimal("1") + base / Decimal("100")
    if denom <= 0:
        return Decimal("0")
    val = ((Decimal("1") + roi / Decimal("100")) / denom - Decimal("1")) * Decimal("100")
    return val.quantize(_PCT_Q, rounding=ROUND_HALF_UP)


def week_key(season_id: int, week_id: date) -> str:
    return f"game:season:{season_id}:week:{week_id.isoformat()}:ranking"


def base_key(season_id: int, week_id: date) -> str:
    return f"game:season:{season_id}:week:{week_id.isoformat()}:base"

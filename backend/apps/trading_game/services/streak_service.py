"""연속 출석(Streak) — KST 날짜 기준 (Phase 5b).

하루 중 주문 1회 이상 또는 퀴즈 제출 1회 이상이면 유지. STREAK 플래그가 꺼지면 갱신하지 않는다.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import UserStreak
from apps.trading_game.services import coach_service, feature_flag_service


def next_streak(current: int, last: date | None, today: date) -> int:
    if last == today:
        return current
    if last == today - timedelta(days=1):
        return current + 1
    return 1


async def touch(db: AsyncSession, redis, user_id: int, *, today: date | None = None) -> UserStreak | None:
    """오늘 활동 기록. 꺼져 있으면 None(무변경). commit 포함."""
    if not await feature_flag_service.is_enabled(db, redis, "STREAK"):
        return None
    today = today or coach_service.kst_today()
    row = await db.get(UserStreak, user_id)
    if row is None:
        row = UserStreak(user_id=user_id, current_streak=0, highest_streak=0)
        db.add(row)
    row.current_streak = next_streak(row.current_streak, row.last_activity_date, today)
    row.highest_streak = max(row.highest_streak, row.current_streak)
    row.last_activity_date = today
    await db.commit()
    return row


async def get_streak(db: AsyncSession, user_id: int) -> UserStreak | None:
    return await db.get(UserStreak, user_id)

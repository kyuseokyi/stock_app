"""연속 출석 마일스톤 보상(백로그 ⑤-1) — 시즌마다 마일스톤별 1회, 수동 수령.

자격: 수령 시점 current_streak >= milestone 이고 마지막 활동일이 오늘·어제(KST)여서 연속이 살아 있을 것.
끊긴 연속의 current_streak 는 다음 활동 전까지 남아 있으므로 날짜로 확인한다. highest_streak 은 쓰지 않는다.
지급은 퀘스트 수령과 같은 방식 — 수령 행 기록과 reward_service.grant_cash(계좌 FOR UPDATE)를 한 트랜잭션으로.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, StreakRewardClaim, UserStreak
from apps.trading_game.services import account_service, coach_service, feature_flag_service, reward_service

STREAK_MILESTONES: tuple[tuple[int, Decimal], ...] = (
    (3, Decimal("100000")),
    (7, Decimal("300000")),
    (14, Decimal("700000")),
    (30, Decimal("2000000")),
)
_AMOUNT_BY_MILESTONE = dict(STREAK_MILESTONES)


class StreakRewardError(Exception):
    """code: UNKNOWN_MILESTONE | FEATURE_DISABLED | NO_ACTIVE_SEASON | NOT_REACHED | ALREADY_CLAIMED | PRICE_UNAVAILABLE"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class RewardStatus:
    milestone: int
    amount: Decimal
    claimed: bool
    claimable: bool


def is_eligible(row: UserStreak | None, milestone: int, today: date) -> bool:
    if row is None or row.last_activity_date is None:
        return False
    alive = row.last_activity_date in (today, today - timedelta(days=1))
    return alive and row.current_streak >= milestone


async def _claimed_milestones(db: AsyncSession, user_id: int, season_id: int) -> set[int]:
    rows = await db.execute(
        select(StreakRewardClaim.milestone).where(
            StreakRewardClaim.user_id == user_id, StreakRewardClaim.season_id == season_id
        )
    )
    return set(rows.scalars().all())


async def _already_claimed(db: AsyncSession, user_id: int, season_id: int, milestone: int) -> bool:
    return milestone in await _claimed_milestones(db, user_id, season_id)


async def _tradable_season_id(db: AsyncSession) -> int | None:
    season = await account_service.get_active_season(db)
    if season is None or not account_service.season_is_tradable(season):
        return None
    return season.id


async def reward_status(
    db: AsyncSession, redis, user_id: int, *, today: date | None = None
) -> list[RewardStatus]:
    """플래그 꺼짐·거래 가능한 활성 시즌 없음 → []."""
    if not await feature_flag_service.is_enabled(db, redis, "STREAK"):
        return []
    season_id = await _tradable_season_id(db)
    if season_id is None:
        return []
    today = today or coach_service.kst_today()
    row = await db.get(UserStreak, user_id)
    claimed = await _claimed_milestones(db, user_id, season_id)
    return [
        RewardStatus(
            milestone=m, amount=amount, claimed=m in claimed,
            claimable=m not in claimed and is_eligible(row, m, today),
        )
        for m, amount in STREAK_MILESTONES
    ]


async def claim(
    db: AsyncSession, redis, user_id: int, milestone: int, *, today: date | None = None
) -> GameAccount:
    """마일스톤 보상 수령 → 지급 후 계좌. 실패 시 StreakRewardError(수령 행은 남지 않음)."""
    amount = _AMOUNT_BY_MILESTONE.get(milestone)
    if amount is None:
        raise StreakRewardError("UNKNOWN_MILESTONE", "존재하지 않는 연속 출석 보상입니다.")
    if not await feature_flag_service.is_enabled(db, redis, "STREAK"):
        raise StreakRewardError("FEATURE_DISABLED", "연속 출석은 현재 운영하지 않습니다.")
    # 종료시각이 지난(정산 대기) ACTIVE 시즌은 거래 불가 → 보상 대상 아님
    season_id = await _tradable_season_id(db)
    if season_id is None:
        raise StreakRewardError("NO_ACTIVE_SEASON", "진행 중인 시즌이 없어 보상을 받을 수 없습니다.")
    today = today or coach_service.kst_today()
    if not is_eligible(await db.get(UserStreak, user_id), milestone, today):
        raise StreakRewardError("NOT_REACHED", "아직 연속 출석 일수가 부족합니다.")
    if await _already_claimed(db, user_id, season_id, milestone):
        raise StreakRewardError("ALREADY_CLAIMED", "이미 보상을 받았습니다.")

    # 계좌 선확보 — get_or_create_account 는 내부 commit 하므로 수령 행 삽입 전에 호출
    account = await account_service.get_or_create_account(db, user_id, season_id)
    db.add(StreakRewardClaim(user_id=user_id, season_id=season_id, milestone=milestone, amount=amount))
    try:
        await db.flush()
    except IntegrityError:
        # 선조회를 통과한 동시 요청 — 유니크 제약이 1회만 허용. 실패한 트랜잭션이라 rollback 필수
        await db.rollback()
        raise StreakRewardError("ALREADY_CLAIMED", "이미 보상을 받았습니다.")
    try:
        await reward_service.grant_cash(db, account, amount, redis=redis)
    except reward_service.RewardUnavailable:
        await db.rollback()  # 수령 행 되돌림 — 시세 회복 후 재시도 가능
        raise StreakRewardError(
            "PRICE_UNAVAILABLE", "시세를 확인할 수 없어 지금은 보상을 받을 수 없습니다. 잠시 후 다시 시도하세요."
        )
    await db.commit()
    await db.refresh(account)
    return account

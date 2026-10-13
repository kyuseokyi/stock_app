"""단계별 트레이딩 퀘스트 (Phase 5b) — 정의는 코드 상수, 진행은 user_quest_progress.

진행도는 유저 단위 영구 1회성. 현금 보상은 수령 시점 활성 시즌 계좌로 reward_service.grant_cash.
on_order_opened 는 주문 경로의 best-effort 훅 — 호출부가 예외를 흡수한다.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, UserBadge, UserQuestProgress
from apps.trading_game.services import account_service, indicators, reward_service, rsi_service

log = logging.getLogger("trading_game.quest")

GOLDEN_CROSS_TIMEOUT_SECONDS = 2.0
Q3_MAX_RATIO = Decimal("0.25")  # 소분할 기준 — 비중 25% 이하(10·20·25%) 진입만 집계

BADGE_NAMES = {"PRINCIPLED": "원칙주의자"}


@dataclass(frozen=True)
class QuestDef:
    code: str
    title: str
    description: str
    target: int
    reward_cash: Decimal | None = None
    reward_badge: str | None = None


QUESTS: tuple[QuestDef, ...] = (
    QuestDef("Q1_STOP_LOSS", "첫 손절선 걸고 거래하기",
             "손절선(Stop-Loss)을 설정하고 포지션에 진입하세요.", 1, reward_cash=Decimal("500000")),
    QuestDef("Q2_GOLDEN_CROSS", "골든크로스에 매수하기",
             "5일선이 20일선을 상향 돌파한 뒤 3거래일 이내에 LONG으로 진입하세요.", 1,
             reward_cash=Decimal("1000000")),
    QuestDef("Q3_SMALL_SIZE", "소분할 진입 3회",
             "자본금의 25% 이하 비중으로 3번 진입하세요.", 3, reward_badge="PRINCIPLED"),
)
QUEST_BY_CODE = {q.code: q for q in QUESTS}


class QuestError(Exception):
    """code: QUEST_NOT_FOUND | QUEST_NOT_COMPLETED | ALREADY_CLAIMED | NO_ACTIVE_SEASON | PRICE_UNAVAILABLE"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


async def _get_or_create(db: AsyncSession, user_id: int, code: str) -> UserQuestProgress:
    row = await db.get(UserQuestProgress, (user_id, code))
    if row is None:
        row = UserQuestProgress(user_id=user_id, quest_code=code, progress=0)
        db.add(row)
    return row


def _advance(row: UserQuestProgress, quest: QuestDef, now: datetime) -> None:
    if row.completed_at is not None:
        return
    row.progress = min(row.progress + 1, quest.target)
    if row.progress >= quest.target:
        row.completed_at = now


async def _golden_cross_now(redis, ticker: str, price: Decimal) -> bool:
    try:
        closes = await asyncio.wait_for(
            rsi_service.cached_closes(redis, ticker), timeout=GOLDEN_CROSS_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        await rsi_service.mark_closes_unavailable(redis, ticker)
        log.warning("골든크로스 종가 조회 실패/지연 — Q2 판정 생략", exc_info=True)
        return False
    except Exception:
        log.warning("골든크로스 종가 조회 실패/지연 — Q2 판정 생략", exc_info=True)
        return False
    if not closes:
        return False
    return indicators.golden_cross_within([*closes, float(price)])


async def on_order_opened(
    db: AsyncSession,
    redis,
    user_id: int,
    *,
    side: str,
    ratio: float | Decimal,
    stop_loss_price: Decimal | None,
    ticker: str,
    entry_price: Decimal,
    now: datetime | None = None,
) -> None:
    now = now or datetime.now(timezone.utc)
    if stop_loss_price is not None:
        _advance(await _get_or_create(db, user_id, "Q1_STOP_LOSS"), QUEST_BY_CODE["Q1_STOP_LOSS"], now)
    if Decimal(str(ratio)) <= Q3_MAX_RATIO:
        _advance(await _get_or_create(db, user_id, "Q3_SMALL_SIZE"), QUEST_BY_CODE["Q3_SMALL_SIZE"], now)
    if side == "LONG":
        existing = await db.get(UserQuestProgress, (user_id, "Q2_GOLDEN_CROSS"))
        if (existing is None or existing.completed_at is None) and await _golden_cross_now(
            redis, ticker, entry_price
        ):
            _advance(
                await _get_or_create(db, user_id, "Q2_GOLDEN_CROSS"), QUEST_BY_CODE["Q2_GOLDEN_CROSS"], now
            )
    await db.commit()


async def list_progress(
    db: AsyncSession, user_id: int
) -> tuple[list[tuple[QuestDef, UserQuestProgress | None]], list[UserBadge]]:
    rows = (
        await db.execute(select(UserQuestProgress).where(UserQuestProgress.user_id == user_id))
    ).scalars().all()
    by_code = {r.quest_code: r for r in rows}
    badges = (
        await db.execute(
            select(UserBadge).where(UserBadge.user_id == user_id).order_by(UserBadge.awarded_at)
        )
    ).scalars().all()
    return [(q, by_code.get(q.code)) for q in QUESTS], list(badges)


async def claim(
    db: AsyncSession, user_id: int, code: str, *, redis, now: datetime | None = None
) -> tuple[UserQuestProgress, GameAccount | None, UserBadge | None]:
    quest = QUEST_BY_CODE.get(code)
    if quest is None:
        raise QuestError("QUEST_NOT_FOUND", "존재하지 않는 퀘스트입니다.")
    row = await db.get(UserQuestProgress, (user_id, code))
    if row is None or row.completed_at is None:
        raise QuestError("QUEST_NOT_COMPLETED", "아직 달성하지 않은 퀘스트입니다.")
    if row.claimed_at is not None:
        raise QuestError("ALREADY_CLAIMED", "이미 보상을 받았습니다.")

    account = None
    if quest.reward_cash is not None:
        season = await account_service.get_active_season(db)
        # 종료시각이 지난(정산 대기) ACTIVE 시즌은 거래 불가 → 보상 대상 아님
        if season is None or not account_service.season_is_tradable(season):
            raise QuestError("NO_ACTIVE_SEASON", "진행 중인 시즌이 없어 보상을 받을 수 없습니다.")
        account = await account_service.get_or_create_account(db, user_id, season.id)

    now = now or datetime.now(timezone.utc)
    # 조건부 갱신 — 연타·동시 요청에도 1회만 성공
    res = await db.execute(
        update(UserQuestProgress)
        .where(
            UserQuestProgress.user_id == user_id,
            UserQuestProgress.quest_code == code,
            UserQuestProgress.claimed_at.is_(None),
            UserQuestProgress.completed_at.is_not(None),
        )
        .values(claimed_at=now)
    )
    if res.rowcount != 1:
        # 0행 갱신 — 변경 없음, rollback 불필요(세션 객체 expire 방지)
        raise QuestError("ALREADY_CLAIMED", "이미 보상을 받았습니다.")
    if account is not None:
        try:
            await reward_service.grant_cash(db, account, quest.reward_cash, redis=redis)
        except reward_service.RewardUnavailable:
            await db.rollback()  # 수령 표시(claimed_at) 되돌림 — 시세 회복 후 재시도 가능
            raise QuestError(
                "PRICE_UNAVAILABLE", "시세를 확인할 수 없어 지금은 보상을 받을 수 없습니다. 잠시 후 다시 시도하세요."
            )
    badge = None
    if quest.reward_badge is not None:
        badge = await db.get(UserBadge, (user_id, quest.reward_badge))
        if badge is None:
            badge = UserBadge(user_id=user_id, badge_code=quest.reward_badge, awarded_at=now)
            db.add(badge)
    await db.commit()
    await db.refresh(row)
    if account is not None:
        await db.refresh(account)
    if badge is not None:
        await db.refresh(badge)
    return row, account, badge

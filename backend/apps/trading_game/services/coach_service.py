"""데일리 스마트 코치 서비스 — 슬롯 upsert(초안/발행), 오늘 코칭 조회 (Phase 5a).

슬롯 키 = (season_id, target_date, coach_type). 발행된 슬롯을 초안으로 되돌리는 것은 금지
(실수로 발행 취소 방지) — 발행본 수정은 다시 publish.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import case, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameCoachMessage, GameSeason
from apps.trading_game.schemas.game_dtos import CoachMessageResponse, CoachUpsertRequest
from apps.trading_game.services import account_service

KST = ZoneInfo("Asia/Seoul")
_SLOT_ORDER = case({"MORNING": 0, "EVENING": 1, "IN_PLAY": 2}, value=GameCoachMessage.coach_type, else_=9)


class CoachError(Exception):
    """code: SEASON_NOT_FOUND | ALREADY_PUBLISHED | SLOT_CONFLICT"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def kst_today(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(KST).date()


async def _get_slot(db: AsyncSession, season_id: int, target_date: date, coach_type: str) -> GameCoachMessage | None:
    row = await db.execute(
        select(GameCoachMessage).where(
            GameCoachMessage.season_id == season_id,
            GameCoachMessage.target_date == target_date,
            GameCoachMessage.coach_type == coach_type,
        )
    )
    return row.scalar_one_or_none()


async def upsert_coach_message(
    db: AsyncSession, *, req: CoachUpsertRequest, author_id: int
) -> GameCoachMessage:
    if await db.get(GameSeason, req.season_id) is None:
        raise CoachError("SEASON_NOT_FOUND", "시즌을 찾을 수 없습니다.")

    msg = await _get_slot(db, req.season_id, req.target_date, req.coach_type)
    if msg is not None and msg.status == "PUBLISHED" and req.action == "draft":
        raise CoachError("ALREADY_PUBLISHED", "이미 발행된 브리핑입니다. 수정하려면 다시 발행하세요.")
    if msg is None:
        msg = GameCoachMessage(
            season_id=req.season_id, target_date=req.target_date, coach_type=req.coach_type,
        )
        db.add(msg)

    msg.title = req.title
    msg.summary_nudge = req.summary_nudge
    msg.content_md = req.content_md
    msg.support_price = req.support_price
    msg.resistance_price = req.resistance_price
    msg.author_id = author_id
    if req.action == "publish":
        msg.status = "PUBLISHED"
        msg.published_at = datetime.now(timezone.utc)
    else:
        msg.status = "DRAFT"
        msg.published_at = None

    try:
        await db.commit()
    except IntegrityError:  # 동시 최초 저장 경합(같은 슬롯 INSERT 2건)
        await db.rollback()
        raise CoachError("SLOT_CONFLICT", "동시에 저장되었습니다. 새로고침 후 다시 시도하세요.")
    await db.refresh(msg)
    return msg


async def list_slot_messages(db: AsyncSession, season_id: int, target_date: date) -> list[GameCoachMessage]:
    rows = await db.execute(
        select(GameCoachMessage)
        .where(GameCoachMessage.season_id == season_id, GameCoachMessage.target_date == target_date)
        .order_by(_SLOT_ORDER)  # MORNING, EVENING 순
    )
    return list(rows.scalars().all())


async def today_coach(
    db: AsyncSession, today: date
) -> tuple[int | None, GameCoachMessage | None, GameCoachMessage | None]:
    """(활성 시즌 id, 발행된 모닝, 발행된 이브닝). 활성 시즌 없으면 (None, None, None)."""
    season = await account_service.get_active_season(db)
    if season is None:
        return None, None, None
    rows = await db.execute(
        select(GameCoachMessage).where(
            GameCoachMessage.season_id == season.id,
            GameCoachMessage.target_date == today,
            GameCoachMessage.status == "PUBLISHED",
        )
    )
    by_type = {m.coach_type: m for m in rows.scalars().all()}
    return season.id, by_type.get("MORNING"), by_type.get("EVENING")


async def list_seasons(db: AsyncSession) -> list[GameSeason]:
    rows = await db.execute(select(GameSeason).order_by(GameSeason.id.desc()))
    return list(rows.scalars().all())


def to_dto(msg: GameCoachMessage) -> CoachMessageResponse:
    return CoachMessageResponse(
        id=msg.id, season_id=msg.season_id, target_date=msg.target_date,
        coach_type=msg.coach_type, title=msg.title, summary_nudge=msg.summary_nudge,
        content_md=msg.content_md, support_price=msg.support_price,
        resistance_price=msg.resistance_price, status=msg.status, published_at=msg.published_at,
    )


def _dec_str(v: Decimal | None) -> str | None:
    return None if v is None else str(v)


def coach_push_payload(msg: GameCoachMessage) -> dict:
    """발행 시 WS broadcast 페이로드(JSON 직렬화 가능)."""
    return {
        "type": "coach",
        "season_id": msg.season_id,
        "coach_type": msg.coach_type,
        "target_date": msg.target_date.isoformat(),
        "title": msg.title,
        "summary_nudge": msg.summary_nudge,
        "support_price": _dec_str(msg.support_price),
        "resistance_price": _dec_str(msg.resistance_price),
    }

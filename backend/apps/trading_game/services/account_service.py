"""가상 계좌 조회/자동생성 + ACTIVE 시즌 조회."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, GameSeason


async def get_active_season(db: AsyncSession) -> GameSeason | None:
    row = await db.execute(
        select(GameSeason).where(GameSeason.status == "ACTIVE").order_by(GameSeason.id.desc())
    )
    return row.scalars().first()


def season_is_tradable(season: GameSeason) -> bool:
    if season.status != "ACTIVE":
        return False
    if season.end_at is None:
        return True
    end_at = season.end_at
    if end_at.tzinfo is None:  # sqlite 등에서 naive 로 올 수 있음
        end_at = end_at.replace(tzinfo=timezone.utc)
    return end_at > datetime.now(timezone.utc)


async def get_or_create_account(db: AsyncSession, user_id: int, season_id: int) -> GameAccount:
    row = await db.execute(
        select(GameAccount).where(
            GameAccount.user_id == user_id, GameAccount.season_id == season_id
        )
    )
    acc = row.scalar_one_or_none()
    if acc is not None:
        return acc
    acc = GameAccount(user_id=user_id, season_id=season_id)  # 기본값 INITIAL_CASH
    db.add(acc)
    try:
        await db.commit()
    except IntegrityError:  # 동시 최초요청 레이스 → 상대가 먼저 생성
        await db.rollback()
        row = await db.execute(
            select(GameAccount).where(
                GameAccount.user_id == user_id, GameAccount.season_id == season_id
            )
        )
        return row.scalar_one()
    await db.refresh(acc)
    return acc

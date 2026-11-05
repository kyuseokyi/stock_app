"""ad_configs DB 접근(async). 커밋까지 여기서 한다(push_repo 관례)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import AdConfig


async def get(db: AsyncSession, slot_key: str) -> AdConfig | None:
    return await db.get(AdConfig, slot_key)


async def list_all(db: AsyncSession) -> list[AdConfig]:
    return list((await db.execute(select(AdConfig))).scalars())


async def save(db: AsyncSession, row: AdConfig) -> AdConfig:
    """신규면 추가, 기존이면 변경분을 커밋한다."""
    db.add(row)
    await db.commit()
    return row

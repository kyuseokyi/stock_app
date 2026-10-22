"""app_version_configs DB 접근(async). 커밋까지 여기서 한다(push_repo 관례)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import AppVersionConfig


async def get_by_platform(db: AsyncSession, platform: str) -> AppVersionConfig | None:
    stmt = select(AppVersionConfig).where(AppVersionConfig.platform == platform)
    return (await db.execute(stmt)).scalar_one_or_none()


async def list_all(db: AsyncSession) -> list[AppVersionConfig]:
    return list((await db.execute(select(AppVersionConfig))).scalars())


async def save(db: AsyncSession, row: AppVersionConfig) -> AppVersionConfig:
    """신규면 추가, 기존이면 변경분을 커밋한다."""
    db.add(row)
    await db.commit()
    return row

"""기기 푸시 토큰 등록·해제."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from ..push_schemas import PushDeviceIn
from ..repositories import push_repo


async def register(db: AsyncSession, *, user_id: int, payload: PushDeviceIn) -> None:
    await push_repo.upsert_device(
        db,
        token=payload.token,
        user_id=user_id,
        platform=payload.platform,
        fund_notice=payload.fund_notice,
        post_notice=payload.post_notice,
    )


async def unregister(db: AsyncSession, *, user_id: int, token: str) -> None:
    await push_repo.delete_device(db, token=token, user_id=user_id)

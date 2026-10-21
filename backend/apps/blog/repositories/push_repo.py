"""push_devices·push_sends·push_templates DB 접근(async). 커밋까지 여기서 한다(crud.py 관례)."""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import PushDevice


async def upsert_device(
    db: AsyncSession, *, token: str, user_id: int, platform: str, fund_notice: bool
) -> PushDevice:
    """token 기준 upsert — 다른 사용자 토큰이면 소유자를 바꾼다(같은 기기에서 계정을 바꾼 경우)."""
    dev = (await db.execute(select(PushDevice).where(PushDevice.token == token))).scalar_one_or_none()
    if dev is None:
        dev = PushDevice(token=token, user_id=user_id, platform=platform, fund_notice=fund_notice)
        db.add(dev)
    else:
        dev.user_id = user_id
        dev.platform = platform
        dev.fund_notice = fund_notice
    await db.commit()
    await db.refresh(dev)
    return dev


async def delete_device(db: AsyncSession, *, token: str, user_id: int) -> None:
    """본인 토큰만 지운다. 없으면 아무 일 없음."""
    await db.execute(delete(PushDevice).where(PushDevice.token == token, PushDevice.user_id == user_id))
    await db.commit()

"""push_devices·push_sends·push_templates DB 접근(async). 커밋까지 여기서 한다(crud.py 관례)."""
from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import PushDevice


async def _find_by_token(db: AsyncSession, token: str) -> PushDevice | None:
    return (await db.execute(select(PushDevice).where(PushDevice.token == token))).scalar_one_or_none()


def _apply(dev: PushDevice, *, user_id: int, platform: str, fund_notice: bool) -> None:
    dev.user_id = user_id
    dev.platform = platform
    dev.fund_notice = fund_notice
    dev.updated_at = func.now()  # 값이 같아도 마지막 등록 시각 갱신(오래된 토큰 정리용)


async def upsert_device(
    db: AsyncSession, *, token: str, user_id: int, platform: str, fund_notice: bool
) -> PushDevice:
    """token 기준 upsert — 다른 사용자 토큰이면 소유자를 바꾼다(같은 기기에서 계정을 바꾼 경우).

    같은 token 의 PUT 이 겹쳐 insert 가 UNIQUE 위반이 나면 롤백 후 기존 행을 갱신한다(1회 재시도).
    """
    dev = await _find_by_token(db, token)
    if dev is None:
        db.add(PushDevice(token=token, user_id=user_id, platform=platform, fund_notice=fund_notice))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            dev = await _find_by_token(db, token)
            if dev is None:
                raise
            _apply(dev, user_id=user_id, platform=platform, fund_notice=fund_notice)
            await db.commit()
    else:
        _apply(dev, user_id=user_id, platform=platform, fund_notice=fund_notice)
        await db.commit()
    dev = await _find_by_token(db, token)
    assert dev is not None
    await db.refresh(dev)
    return dev


async def delete_device(db: AsyncSession, *, token: str, user_id: int) -> None:
    """본인 토큰만 지운다. 없으면 아무 일 없음."""
    await db.execute(delete(PushDevice).where(PushDevice.token == token, PushDevice.user_id == user_id))
    await db.commit()

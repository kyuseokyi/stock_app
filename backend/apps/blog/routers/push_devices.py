"""기기 푸시 토큰 — 로그인 사용자 본인 기기만."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User

from ..push_schemas import PushDeviceIn
from ..services import push_devices

router = APIRouter(prefix="/api/v1/push-devices", tags=["push"])


@router.put("", status_code=status.HTTP_204_NO_CONTENT)
async def put_device(
    payload: PushDeviceIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> Response:
    await push_devices.register(db, user_id=user.id, payload=payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    token: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> Response:
    await push_devices.unregister(db, user_id=user.id, token=token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

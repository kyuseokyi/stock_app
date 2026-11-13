"""내 차단 목록(/me/blocks) REST 라우터 — 차단한 사용자의 댓글은 내 댓글 목록에서 빠진다."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User

from .. import moderation_schemas as ms
from ..services import moderation

router = APIRouter(prefix="/api/v1/me/blocks", tags=["blocks"])


def _http(e: moderation.ModerationError) -> HTTPException:
    return HTTPException(e.status_code, detail={"code": e.code, "message": e.message})


@router.get("", response_model=list[ms.BlockedUserOut])
async def list_blocks(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """차단한 사용자 최신순."""
    return await moderation.list_blocks(db, user)


@router.post("/{user_id}", status_code=status.HTTP_201_CREATED)
async def block_user(
    user_id: int,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """새로 차단 201, 이미 차단 200(멱등). 자기 자신·운영자 400, 없는 사용자 404."""
    try:
        created = await moderation.block_user(db, user, user_id)
    except moderation.ModerationError as e:
        raise _http(e) from e
    if not created:
        response.status_code = status.HTTP_200_OK
    return {"ok": True, "user_id": user_id}


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unblock_user(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """차단 해제 — 차단한 적이 없어도 204."""
    await moderation.unblock_user(db, user, user_id)

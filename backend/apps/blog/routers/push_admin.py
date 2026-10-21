"""관리자 — 펀드 리포트 알림 발송·이력·템플릿."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User

from ..push_schemas import (
    FundNoticeIn,
    FundNoticePreviewOut,
    PushSendListOut,
    PushSendOut,
    PushTemplateIn,
    PushTemplateOut,
)
from ..repositories import push_repo
from ..services import fund_notice
from ..services.fund_notice import NoticeError

router = APIRouter(prefix="/api/v1/admin", tags=["push-admin"])


def _http(e: NoticeError) -> HTTPException:
    return HTTPException(e.status, detail={"code": e.code, "message": e.message})


@router.get("/fund-notices/preview", response_model=FundNoticePreviewOut)
async def preview(
    date_: date = Query(alias="date"), db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)
):
    return await fund_notice.preview(db, admin_id=admin.id, ref_date=date_)


@router.post("/fund-notices", response_model=PushSendOut, status_code=status.HTTP_201_CREATED)
async def create_notice(
    payload: FundNoticeIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)
):
    try:
        return await fund_notice.create_notice(db, admin=admin, payload=payload)
    except NoticeError as e:
        raise _http(e) from e


@router.post("/push-sends/{send_id}/cancel", response_model=PushSendOut)
async def cancel_send(send_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    try:
        return await fund_notice.cancel(db, send_id)
    except NoticeError as e:
        raise _http(e) from e


@router.get("/push-sends", response_model=PushSendListOut)
async def list_sends(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return await fund_notice.history(db, limit=limit, offset=offset)


@router.get("/push-templates", response_model=list[PushTemplateOut])
async def list_templates(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    return await push_repo.list_templates(db)


@router.post("/push-templates", response_model=PushTemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(
    payload: PushTemplateIn, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)
):
    return await fund_notice.save_template(db, payload)


@router.put("/push-templates/{template_id}", response_model=PushTemplateOut)
async def update_template(
    template_id: int, payload: PushTemplateIn, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)
):
    try:
        return await fund_notice.save_template(db, payload, template_id)
    except NoticeError as e:
        raise _http(e) from e


@router.delete("/push-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    try:
        tpl = await fund_notice.get_template_or_404(db, template_id)
    except NoticeError as e:
        raise _http(e) from e
    await push_repo.delete_template(db, tpl)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

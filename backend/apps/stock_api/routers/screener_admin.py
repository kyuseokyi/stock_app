"""스크리너 탭 보이기 스위치 관리자 REST — 조건검색(FINDER)·차트 패턴(PATTERNS). 관리자 JWT 만."""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from apps.stock_api.services import screener_features as svc
from shared.auth import require_admin
from shared.database import get_db
from shared.models import User

log = logging.getLogger("stock_api.screener_admin")
router = APIRouter(prefix="/api/v1/admin/screener", tags=["screener-admin"])


class FeatureOut(BaseModel):
    key: str
    enabled: bool
    updated_at: datetime | None


class FeatureUpdate(BaseModel):
    enabled: bool


def _dto(f) -> FeatureOut:
    return FeatureOut(key=f.key, enabled=bool(f.enabled), updated_at=f.updated_at)


@router.get("/features", response_model=list[FeatureOut])
async def list_features(_admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return [_dto(f) for f in await svc.list_features(db)]


@router.put("/features/{key}", response_model=FeatureOut)
async def update_feature(
    key: str, body: FeatureUpdate, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    try:
        row = await svc.set_feature(db, key, body.enabled)
    except svc.UnknownFeature:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "FEATURE_NOT_FOUND", "message": "없는 스위치입니다."})
    log.info("스크리너 탭 스위치 변경 key=%s enabled=%s admin=%s", key, body.enabled, admin.id)
    return _dto(row)

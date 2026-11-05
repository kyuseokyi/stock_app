"""광고 원격 설정 — 공개 조회 + 관리자 슬롯 설정(명세 docs/ad_monetization_spec_and_plan.md §3-2)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User

from ..ad_config_schemas import AdConfigIn, AdConfigOut, PublicAdConfigOut
from ..services import ad_config
from ..services.ad_config import AdConfigError

public_router = APIRouter(prefix="/api/v1/ads", tags=["ads"])
admin_router = APIRouter(prefix="/api/v1/admin/ads", tags=["ads-admin"])


@public_router.get("/config", response_model=PublicAdConfigOut)
async def read_public_config(response: Response, db: AsyncSession = Depends(get_db)):
    """인증 없음. no-store — 프록시·CDN 이 붙잡으면 긴급 끄기가 늦게 반영된다(캐시는 클라이언트 몫)."""
    response.headers["Cache-Control"] = "no-store"
    return await ad_config.public_config(db)


@admin_router.get("/config", response_model=list[AdConfigOut])
async def list_ad_configs(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    return await ad_config.list_configs(db)


@admin_router.put("/config/{slot_key}", response_model=AdConfigOut)
async def update_ad_config(
    slot_key: str, payload: AdConfigIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)
):
    try:
        return await ad_config.update_config(db, slot_key=slot_key, payload=payload, admin=admin)
    except AdConfigError as e:
        raise HTTPException(e.status, detail={"code": e.code, "message": e.message}) from e

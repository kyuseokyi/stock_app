"""앱 업데이트 관리 — 공개 버전 체크 + 관리자 플랫폼별 설정(명세 docs/app_update_management_spec.md §3)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User

from ..app_version_schemas import AppVersionIn, AppVersionOut, VersionCheckOut
from ..services import app_version
from ..services.app_version import AppVersionError

public_router = APIRouter(prefix="/api/v1/app", tags=["app-version"])
admin_router = APIRouter(prefix="/api/v1/admin", tags=["app-version-admin"])


def _http(e: AppVersionError) -> HTTPException:
    return HTTPException(e.status, detail={"code": e.code, "message": e.message})


@public_router.get("/version-check", response_model=VersionCheckOut)
async def version_check(
    platform: str = Query(...),
    # 형식 검증을 걸지 않는다 — 틀린 값·누락이어도 422 대신 update_type NONE(앱이 막히지 않게)
    current_version: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    """인증 없음. 매 앱 실행마다 호출(단순 조회). 점검 모드여도 200."""
    try:
        return await app_version.version_check(db, platform=platform, current_version=current_version)
    except AppVersionError as e:
        raise _http(e) from e


@admin_router.get("/app-versions", response_model=list[AppVersionOut])
async def list_app_versions(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    return await app_version.list_configs(db)


@admin_router.put("/app-versions/{platform}", response_model=AppVersionOut)
async def update_app_version(
    platform: str, payload: AppVersionIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)
):
    try:
        return await app_version.update_config(db, platform=platform, payload=payload, admin=admin)
    except AppVersionError as e:
        raise _http(e) from e

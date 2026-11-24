"""관리자 계정·등급 관리 REST — 목록·생성·비밀번호 초기화·활성 전환·등급 변경, 등급별 권한 표.

계정·등급 변경은 슈퍼 관리자 전용(require_super_admin). 권한 표 조회는 모든 관리자(내 권한 확인용).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin, require_super_admin
from shared.database import get_db
from shared.models import User

from .. import schemas
from ..deps import get_redis
from ..services import admin_accounts as svc

router = APIRouter(prefix="/api/v1/auth/admin/accounts", tags=["auth-admin-accounts"])


def _http(e: svc.AdminAccountError) -> HTTPException:
    return HTTPException(e.status, {"code": e.code, "message": e.message})


@router.get("", response_model=list[schemas.AdminAccountOut])
async def list_accounts(_super: User = Depends(require_super_admin), db: AsyncSession = Depends(get_db)):
    return await svc.list_admins(db)


@router.post("", response_model=schemas.AdminAccountOut, status_code=201)
async def create_account(
    body: schemas.AdminCreateRequest,
    _super: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await svc.create_admin(
            db, login_id=body.login_id, nickname=body.nickname, password=body.password,
            admin_tier=body.admin_tier, custom_permissions=body.custom_permissions,
        )
    except svc.AdminAccountError as e:
        raise _http(e) from e


@router.post("/{admin_id}/password", response_model=schemas.AdminAccountOut)
async def reset_password(
    admin_id: int,
    body: schemas.AdminPasswordResetRequest,
    _super: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    try:
        return await svc.reset_password(db, redis, admin_id, body.new_password)
    except svc.AdminAccountError as e:
        raise _http(e) from e


@router.patch("/{admin_id}/active", response_model=schemas.AdminAccountOut)
async def set_active(
    admin_id: int,
    body: schemas.AdminActiveRequest,
    _super: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    try:
        return await svc.set_active(db, redis, admin_id, body.is_active)
    except svc.AdminAccountError as e:
        raise _http(e) from e


@router.patch("/{admin_id}/tier", response_model=schemas.AdminAccountOut)
async def set_tier(
    admin_id: int,
    body: schemas.AdminTierUpdateRequest,
    _super: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await svc.set_tier(db, admin_id, body.admin_tier, body.custom_permissions)
    except svc.AdminAccountError as e:
        raise _http(e) from e


policies_router = APIRouter(prefix="/api/v1/auth/admin/role-policies", tags=["auth-admin-accounts"])


@policies_router.get("", response_model=schemas.RolePoliciesOut)
async def get_role_policies(_admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return await svc.role_policies(db)


@policies_router.put("/{tier}", response_model=schemas.RolePoliciesOut)
async def put_role_policy(
    tier: str,
    body: schemas.TierPolicyUpdateRequest,
    _super: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await svc.update_tier_policy(db, tier, body.permissions)
    except svc.AdminAccountError as e:
        raise _http(e) from e

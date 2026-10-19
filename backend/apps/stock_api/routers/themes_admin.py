"""테마 관리자 보정 REST — 주달 화면(스크리너 프로젝트 3)의 관리자 UI 가 쓴다. 관리자 JWT 만."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User
from apps.stock_api.services import theme_admin as svc
from apps.stock_api.services import theme_metrics

log = logging.getLogger("stock_api.themes_admin")
router = APIRouter(prefix="/api/v1/admin/themes", tags=["themes-admin"])


class ThemeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None


class ThemeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    is_hidden: bool | None = None


class StockAdd(BaseModel):
    ticker: str = Field(min_length=6, max_length=20)
    reason: str | None = None


def _404() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "THEME_NOT_FOUND", "message": "테마가 없습니다."})


@router.get("")
async def list_themes(_admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return await svc.list_themes(db)


@router.get("/metrics")
async def theme_metrics_(_admin: User = Depends(require_admin)):
    """테마별 최신 기준일 시장 지표 — 목록 응답(기존 형태)과 따로 받아 화면에서 합친다."""
    return await run_in_threadpool(theme_metrics.theme_metrics)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_theme(body: ThemeCreate, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    out = await svc.create_theme(db, body.name, body.description)
    log.info("테마 생성 id=%s admin=%s", out["id"], admin.id)
    return out


@router.patch("/{theme_id}")
async def update_theme(theme_id: int, body: ThemeUpdate, admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    try:
        out = await svc.update_theme(db, theme_id, body.model_dump(exclude_unset=True))
    except svc.ThemeNotFound:
        raise _404()
    log.info("테마 수정 id=%s admin=%s", theme_id, admin.id)
    return out


@router.get("/{theme_id}/stocks")
async def list_stocks(theme_id: int, _admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    try:
        rows = await svc.list_stocks(db, theme_id)
    except svc.ThemeNotFound:
        raise _404()
    return await run_in_threadpool(theme_metrics.attach_stock_metrics, rows)


@router.post("/{theme_id}/stocks", status_code=status.HTTP_201_CREATED)
async def add_stock(theme_id: int, body: StockAdd, admin: User = Depends(require_admin),
                    db: AsyncSession = Depends(get_db)):
    try:
        await svc.add_stock(db, theme_id, body.ticker.strip(), body.reason)
    except svc.ThemeNotFound:
        raise _404()
    log.info("테마 종목 추가 theme=%s ticker=%s admin=%s", theme_id, body.ticker, admin.id)
    return {"ok": True}


@router.delete("/{theme_id}/stocks/{ticker}", status_code=status.HTTP_204_NO_CONTENT)
async def exclude_stock(theme_id: int, ticker: str, admin: User = Depends(require_admin),
                        db: AsyncSession = Depends(get_db)):
    try:
        await svc.exclude_stock(db, theme_id, ticker)
    except svc.ThemeNotFound:
        raise _404()
    log.info("테마 종목 제외 theme=%s ticker=%s admin=%s", theme_id, ticker, admin.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

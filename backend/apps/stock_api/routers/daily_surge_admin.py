"""급등락·테마 분석 관리자 REST — 관리자 웹 '급등락·테마 분석'(/market/daily-surge) 화면이 쓴다.

권한: 조회·메모·뉴스 = SCREENER_VIEW, 재집계 = DATA_PIPELINE.
설계: docs/superpowers/specs/2026-11-26-daily-surge-theme-analyzer-design.md 4·5절
"""
from __future__ import annotations

from datetime import date as Date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from apps.collector.celery_app import celery_app
from apps.collector.tasks.daily_surge import TASK_NAME, lock_key
from apps.stock_api.services import daily_surge_news as news
from apps.stock_api.services import daily_surge_query as svc
from shared import admin_permissions as P
from shared.auth import require_permission
from shared.database import get_db
from shared.models import User
from shared.sync_redis import get_sync_redis

router = APIRouter(prefix="/api/v1/admin/market/daily-surge", tags=["daily-surge-admin"])

_view = require_permission(P.SCREENER_VIEW)
Mode = Literal["surge", "plunge", "value", "surge_value", "plunge_value"]
Band = Literal["all", "10_15", "15_25", "25_30"]
Sort = Literal["change_rate", "trading_value", "volume", "change_price", "volume_ratio"]
Direction = Literal["up", "down"]


def _404() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND", "message": "자료가 없습니다."})


class NoteIn(BaseModel):
    date: Date
    scope: Literal["theme", "stock"]
    target: str = Field(min_length=1, max_length=20)
    note: str = Field(max_length=300)

    @field_validator("note")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("메모가 비어 있습니다.")
        return v


@router.get("/dates")
async def list_dates(limit: int = Query(60, ge=1, le=250), _a: User = Depends(_view),
                     db: AsyncSession = Depends(get_db)):
    return await svc.dates(db, limit)


@router.get("")
async def list_stocks(date: Date, mode: Mode = "surge", band: Band = "all",
                      market: Literal["ALL", "KOSPI", "KOSDAQ"] = "ALL", dart_only: bool = False,
                      sort: Sort | None = None, order: Literal["asc", "desc"] | None = None,
                      _a: User = Depends(_view), db: AsyncSession = Depends(get_db)):
    return await svc.list_stocks(db, date, mode=mode, band=band, market=market, dart_only=dart_only,
                                 sort=sort, order=order)


@router.get("/groups")
async def list_groups(date: Date, direction: Direction | None = None, _a: User = Depends(_view),
                      db: AsyncSession = Depends(get_db)):
    return await svc.groups(db, date, direction)


@router.get("/news")
async def news_search(kind: Literal["stock", "theme"], date: Date, target: str = Query(min_length=1, max_length=20),
                      _a: User = Depends(_view), db: AsyncSession = Depends(get_db)):
    name = await svc.name_for(db, date, kind, target)
    if not name:
        raise _404()
    return await run_in_threadpool(news.fetch, kind, name, date)


@router.put("/notes")
async def put_note(body: NoteIn, admin: User = Depends(_view), db: AsyncSession = Depends(get_db)):
    return await svc.put_note(db, body.date, body.scope, body.target, body.note, getattr(admin, "id", None))


@router.delete("/notes", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(date: Date, scope: Literal["theme", "stock"], target: str = Query(min_length=1, max_length=20),
                      _a: User = Depends(_view), db: AsyncSession = Depends(get_db)):
    await svc.delete_note(db, date, scope, target)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/rebuild", status_code=status.HTTP_202_ACCEPTED)
async def rebuild(date: Date, _a: User = Depends(require_permission(P.DATA_PIPELINE))):
    day = date.isoformat()
    running = await run_in_threadpool(lambda: bool(get_sync_redis().exists(lock_key(day))))
    if running:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail={"code": "ALREADY_RUNNING", "message": "이 날짜를 집계하는 중입니다."})
    res = celery_app.send_task(TASK_NAME, kwargs={"date": day})
    return {"task_id": res.id, "date": day}


@router.get("/{date}/stocks/{ticker}")
async def stock_detail(date: Date, ticker: str, _a: User = Depends(_view), db: AsyncSession = Depends(get_db)):
    out = await svc.stock_detail(db, date, ticker)
    if out is None:
        raise _404()
    return out


@router.get("/{date}/themes/{theme_id}")
async def theme_detail(date: Date, theme_id: int, direction: Direction, _a: User = Depends(_view),
                       db: AsyncSession = Depends(get_db)):
    out = await svc.theme_detail(db, date, theme_id, direction)
    if out is None:
        raise _404()
    return out

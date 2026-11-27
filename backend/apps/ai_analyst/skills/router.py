"""AI Lab 관리자 REST(A단계) — 스킬 카탈로그 열람·정량 미리 보기. 외부 AI 호출 없음.

권한: SCREENER_VIEW. 설계: docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md 2절
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool

from apps.ai_analyst.skills import service as svc
from apps.ai_analyst.skills import skill_loader
from shared import admin_permissions as P
from shared.auth import require_permission
from shared.models import User

router = APIRouter(prefix="/api/v1/admin/ai-skills", tags=["ai-skills-admin"])

_view = require_permission(P.SCREENER_VIEW)


def _404() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND", "message": "자료가 없습니다."})


@router.get("/catalog")
async def list_catalog(_a: User = Depends(_view)):
    return skill_loader.list_installed_skills()


@router.get("/catalog/{skill_id}")
async def get_catalog(skill_id: str, _a: User = Depends(_view)):
    skill = skill_loader.get_skill(skill_id)
    if skill is None:
        raise _404()
    return skill


@router.get("/quant-preview/{ticker}")
async def quant_preview(ticker: str, capital: float = Query(10_000_000, ge=1e5, le=1e11),
                        risk_pct: float = Query(1.0, ge=0.1, le=5.0), _a: User = Depends(_view)):
    result = await run_in_threadpool(svc.quant_preview, ticker, capital, risk_pct)
    if result is None:
        raise _404()
    return result

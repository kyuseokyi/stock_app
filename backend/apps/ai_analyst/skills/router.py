"""AI Lab 관리자 REST — A단계(스킬 카탈로그·정량 미리 보기, 외부 AI 호출 없음) + B단계(구조화 추론·저장·조회·일괄 분석).

권한: SCREENER_VIEW, 일괄 분석만 DATA_PIPELINE. 설계: docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md 2·3절
"""
from __future__ import annotations

from datetime import date as Date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool

from apps.ai_analyst.skills import report_service as reports
from apps.ai_analyst.skills import service as svc
from apps.ai_analyst.skills import skill_loader
from apps.collector.celery_app import celery_app
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


# ---------------------------------------------------------------- B단계: 구조화 추론·저장·조회·일괄 분석
BATCH_TASK_NAME = "ai.skills_batch_top"
_ERROR_STATUS = {
    "NOT_FOUND": status.HTTP_404_NOT_FOUND,
    "ANALYZING": status.HTTP_409_CONFLICT,
    "GEMINI_UNAVAILABLE": status.HTTP_503_SERVICE_UNAVAILABLE,
    "AI_RESPONSE_INVALID": status.HTTP_502_BAD_GATEWAY,
}


def _parse_skills(raw: str | None) -> list[str] | None:
    """쉼표로 구분한 스킬 id → 목록(없으면 None = 전부). 모르는 id 는 422."""
    if raw is None or not raw.strip():
        return None
    ids = list(dict.fromkeys(x.strip() for x in raw.split(",") if x.strip()))
    known = {s["id"] for s in skill_loader.list_installed_skills()}
    unknown = [x for x in ids if x not in known]
    if unknown:
        raise HTTPException(422,
                            detail={"code": "UNKNOWN_SKILL", "message": f"알 수 없는 스킬: {', '.join(unknown)}"})
    return ids or None


@router.post("/analyze/{ticker}")
async def analyze(ticker: str, force: bool = False, skills: str | None = Query(None, max_length=300),
                  _a: User = Depends(_view)):
    ids = _parse_skills(skills)
    try:
        return await run_in_threadpool(lambda: reports.analyze(ticker, force=force, skills=ids))
    except reports.AnalyzeError as e:
        detail = {"code": e.code, "message": e.message}
        if e.reason:
            detail["reason"] = e.reason
        raise HTTPException(_ERROR_STATUS.get(e.code, status.HTTP_500_INTERNAL_SERVER_ERROR), detail=detail) from None


@router.get("/reports")
async def list_reports(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                       ticker: str | None = Query(None, max_length=20), _a: User = Depends(_view)):
    return await run_in_threadpool(reports.list_reports, page, page_size, ticker)


@router.get("/reports/{ticker}")
async def get_report(ticker: str, as_of: Date | None = None, _a: User = Depends(_view)):
    out = await run_in_threadpool(reports.get_report, ticker, as_of)
    if out is None:
        raise _404()
    return out


@router.post("/batch-top", status_code=status.HTTP_202_ACCEPTED)
async def batch_top(source: Literal["surge", "leaders"] = "surge", limit: int = Query(5, ge=1, le=reports.BATCH_MAX),
                    _a: User = Depends(require_permission(P.DATA_PIPELINE))):
    if await run_in_threadpool(reports.batch_running):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail={"code": "ALREADY_RUNNING", "message": "일괄 분석이 이미 진행 중입니다."})
    res = celery_app.send_task(BATCH_TASK_NAME, kwargs={"source": source, "limit": limit})
    return {"task_id": res.id, "source": source, "limit": limit}

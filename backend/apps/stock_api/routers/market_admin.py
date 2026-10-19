"""관리자 시장 데이터 REST — 데이터 현황, 계산 수동 실행(관리자 JWT 만). 서비스는 동기라 스레드풀에서 돈다."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from apps.stock_api.services import admin_jobs, data_status
from shared.auth import require_admin
from shared.models import User

router = APIRouter(prefix="/api/v1/admin/market", tags=["market-admin"])
_QUEUE_DOWN = {"code": "QUEUE_UNAVAILABLE", "message": "작업 큐에 연결할 수 없어요. 잠시 뒤 다시 시도하세요."}


@router.get("/status")
async def market_status(_admin: User = Depends(require_admin)):
    return await run_in_threadpool(data_status.build_status)


@router.get("/jobs")
async def list_jobs(_admin: User = Depends(require_admin)):
    try:
        return await run_in_threadpool(admin_jobs.overview)
    except admin_jobs.QueueUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_QUEUE_DOWN)


@router.post("/jobs/{job}", status_code=status.HTTP_202_ACCEPTED)
async def run_job(job: str, admin: User = Depends(require_admin)):
    actor = admin.nickname or admin.email or f"#{admin.id}"
    try:
        return await run_in_threadpool(admin_jobs.run, job, actor)
    except admin_jobs.UnknownJob:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "JOB_NOT_FOUND", "message": "없는 작업입니다."})
    except admin_jobs.JobRunning as e:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "JOB_RUNNING", "message": "이미 실행 중이에요", "task_id": e.info.get("task_id"),
            "actor": e.info.get("actor"), "requested_at": e.info.get("requested_at")})
    except admin_jobs.QueueUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_QUEUE_DOWN)

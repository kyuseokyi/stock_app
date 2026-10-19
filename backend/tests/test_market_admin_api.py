"""관리자 시장 REST — 관리자만, 현황·작업 목록, 실행 결과 코드(202·404·409·503)."""
from __future__ import annotations

import httpx
import pytest

from apps.stock_api.main import app
from apps.stock_api.services import admin_jobs, data_status
from shared.auth import get_current_user
from shared.models import User, UserRole


@pytest.fixture
async def api():
    state: dict = {}

    async def _user():
        return state["user"]

    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, state
    app.dependency_overrides.clear()


ADMIN = User(id=1, nickname="관리자", role=UserRole.ADMIN, is_active=True)
FREE = User(id=2, nickname="일반", role=UserRole.FREE, is_active=True)


async def test_non_admin_forbidden(api):
    client, state = api
    state["user"] = FREE
    assert (await client.get("/api/v1/admin/market/status")).status_code == 403
    assert (await client.get("/api/v1/admin/market/jobs")).status_code == 403
    assert (await client.post("/api/v1/admin/market/jobs/canslim")).status_code == 403


async def test_status_and_jobs(api, monkeypatch):
    client, state = api
    state["user"] = ADMIN
    monkeypatch.setattr(data_status, "build_status", lambda: {"ref_date": "2026-10-16"})
    monkeypatch.setattr(admin_jobs, "overview", lambda: {"jobs": [], "history": []})
    assert (await client.get("/api/v1/admin/market/status")).json() == {"ref_date": "2026-10-16"}
    assert (await client.get("/api/v1/admin/market/jobs")).json() == {"jobs": [], "history": []}


async def test_run_job_status_codes(api, monkeypatch):
    client, state = api
    state["user"] = ADMIN
    calls = []

    def ok(job, actor):
        calls.append((job, actor))
        return {"task_id": "t1", "requested_at": "2026-10-16T12:00:00+00:00"}

    monkeypatch.setattr(admin_jobs, "run", ok)
    r = await client.post("/api/v1/admin/market/jobs/canslim")
    assert r.status_code == 202 and r.json()["task_id"] == "t1"
    assert calls == [("canslim", "관리자")]

    def unknown(job, actor):
        raise admin_jobs.UnknownJob(job)

    monkeypatch.setattr(admin_jobs, "run", unknown)
    r = await client.post("/api/v1/admin/market/jobs/nope")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "JOB_NOT_FOUND"

    def running(job, actor):
        raise admin_jobs.JobRunning({"task_id": "t0", "actor": "다른 관리자", "requested_at": "2026-10-16T11:59:00+00:00"})

    monkeypatch.setattr(admin_jobs, "run", running)
    r = await client.post("/api/v1/admin/market/jobs/canslim")
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "JOB_RUNNING", "message": "이미 실행 중이에요", "task_id": "t0",
                                  "actor": "다른 관리자", "requested_at": "2026-10-16T11:59:00+00:00"}

    def down(job, actor):
        raise admin_jobs.QueueUnavailable("broker down")

    monkeypatch.setattr(admin_jobs, "run", down)
    r = await client.post("/api/v1/admin/market/jobs/canslim")
    assert r.status_code == 503 and r.json()["detail"]["code"] == "QUEUE_UNAVAILABLE"

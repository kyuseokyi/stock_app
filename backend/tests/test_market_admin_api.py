"""관리자 시장 REST — 관리자만, 현황·작업 목록, 실행 결과 코드(202·404·409·503)."""
from __future__ import annotations

import httpx
import pytest

from apps.stock_api.main import app
from apps.stock_api.services import admin_jobs, data_status, verify_ticker
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


async def test_jobs_overview_queue_down_is_503(api, monkeypatch):
    client, state = api
    state["user"] = ADMIN

    def down():
        raise admin_jobs.QueueUnavailable("redis down")

    monkeypatch.setattr(admin_jobs, "overview", down)
    r = await client.get("/api/v1/admin/market/jobs")
    assert r.status_code == 503 and r.json()["detail"]["code"] == "QUEUE_UNAVAILABLE"


async def test_verify_admin_only_and_passes_params(api, monkeypatch):
    client, state = api
    state["user"] = FREE
    assert (await client.get("/api/v1/admin/market/verify", params={"ticker": "005930"})).status_code == 403
    state["user"] = ADMIN
    calls = []

    def ok(ticker, date):
        calls.append((ticker, date))
        return {"ticker": "005930", "date": "2026-10-16"}

    monkeypatch.setattr(verify_ticker, "build", ok)
    r = await client.get("/api/v1/admin/market/verify", params={"ticker": "005930", "date": "2026-10-16"})
    assert r.status_code == 200 and r.json() == {"ticker": "005930", "date": "2026-10-16"}
    await client.get("/api/v1/admin/market/verify", params={"ticker": "005930"})
    assert calls == [("005930", "2026-10-16"), ("005930", None)]


async def test_verify_error_codes(api, monkeypatch):
    client, state = api
    state["user"] = ADMIN
    # 실제 서비스: ticker 가 없으면 DB 에 닿기 전에 형식 오류 → FastAPI 기본 배열이 아닌 {code, message}
    r = await client.get("/api/v1/admin/market/verify")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "INVALID_TICKER"
    for exc, code, key in ((verify_ticker.InvalidTicker("x"), 422, "INVALID_TICKER"),
                           (verify_ticker.InvalidDate("x"), 422, "INVALID_DATE"),
                           (verify_ticker.StockNotFound("x"), 404, "STOCK_NOT_FOUND")):
        def raiser(ticker, date, exc=exc):
            raise exc

        monkeypatch.setattr(verify_ticker, "build", raiser)
        r = await client.get("/api/v1/admin/market/verify", params={"ticker": "005930"})
        detail = r.json()["detail"]
        assert r.status_code == code and detail["code"] == key and detail["message"]

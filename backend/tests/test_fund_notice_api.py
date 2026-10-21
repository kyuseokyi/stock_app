"""관리자 펀드 알림 API — 권한·검증·중복 409·force·test·예약·취소·이력·템플릿·SSE."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog import push_dispatch
from apps.blog.main import app
from apps.blog.services import fund_notice
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, PushDevice, PushSend, PushTemplate, User, UserRole

TODAY = date(2026, 10, 21)


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
def spies(monkeypatch):
    calls = {"dispatched": [], "published": []}
    monkeypatch.setattr(
        push_dispatch.celery_app, "send_task", lambda name, args=None, **kw: calls["dispatched"].append((name, args))
    )

    async def _publish(ev):
        calls["published"].append(ev)

    monkeypatch.setattr(fund_notice, "publish_event", _publish)
    return calls


@pytest.fixture
async def api(maker, spies):
    state: dict = {}

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return state["user"]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, state
    app.dependency_overrides.clear()


async def _seed(maker, *, admin_devices: int = 1, fans: int = 2) -> tuple[User, User]:
    async with maker() as s:
        admin = User(nickname="관리자", role=UserRole.ADMIN, is_active=True)
        user = User(nickname="일반", role=UserRole.FREE, is_active=True)
        s.add_all([admin, user])
        await s.flush()
        for i in range(admin_devices):
            s.add(PushDevice(token=f"ExponentPushToken[a{i}]", user_id=admin.id, platform="android", fund_notice=False))
        for i in range(fans):
            s.add(PushDevice(token=f"ExponentPushToken[u{i}]", user_id=user.id, platform="android", fund_notice=True))
        await s.commit()
        return admin, user


def _body(**kw) -> dict:
    return {"date": TODAY.isoformat(), "title": "수익률 리포트 업데이트", "body": "{date} 리포트", "mode": "now", **kw}


async def _sends(maker) -> list[PushSend]:
    async with maker() as s:
        return list((await s.execute(select(PushSend).order_by(PushSend.id))).scalars())


async def test_non_admin_forbidden(api, maker):
    client, state = api
    _, user = await _seed(maker)
    state["user"] = user
    assert (await client.post("/api/v1/admin/fund-notices", json=_body())).status_code == 403
    assert (await client.get("/api/v1/admin/push-sends")).status_code == 403
    assert (await client.get("/api/v1/admin/fund-notices/preview", params={"date": TODAY.isoformat()})).status_code == 403
    assert (await client.post("/api/v1/admin/push-sends/1/cancel")).status_code == 403
    assert (await client.get("/api/v1/admin/push-templates")).status_code == 403
    assert (await client.post("/api/v1/admin/push-templates", json={"title": "t", "body": "b"})).status_code == 403


async def test_no_auth_returns_401(maker):
    # get_current_user 를 덮어쓰지 않고 토큰 없이 호출 — HTTPBearer(auto_error=False) 후 직접 401
    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.post("/api/v1/admin/fund-notices", json=_body())).status_code == 401
            assert (await client.get("/api/v1/admin/push-sends")).status_code == 401
    finally:
        app.dependency_overrides.clear()


async def test_blank_title_rejected(api, maker):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    assert (await client.post("/api/v1/admin/fund-notices", json=_body(title="   "))).status_code == 422


async def test_now_creates_sending_publishes_and_dispatches(api, maker, spies):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    r = await client.post("/api/v1/admin/fund-notices", json=_body())
    assert r.status_code == 201
    assert r.json()["status"] == "sending" and r.json()["mode"] == "now"
    assert spies["published"] == [{"type": "fund_report_updated", "date": "2026-10-21"}]
    assert spies["dispatched"] == [("collector.send_fund_notice", [r.json()["id"]])]


async def test_now_twice_is_409_unless_force(api, maker, spies):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    await client.post("/api/v1/admin/fund-notices", json=_body())
    r = await client.post("/api/v1/admin/fund-notices", json=_body())
    assert r.status_code == 409 and r.json()["detail"]["code"] == "already_sent"
    assert (await client.post("/api/v1/admin/fund-notices", json=_body(force=True))).status_code == 201


async def test_test_mode_no_dup_check_no_sse(api, maker, spies):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    await client.post("/api/v1/admin/fund-notices", json=_body())
    spies["published"].clear()
    r = await client.post("/api/v1/admin/fund-notices", json=_body(mode="test"))
    assert r.status_code == 201 and r.json()["mode"] == "test"
    assert spies["published"] == []


async def test_test_mode_without_device_400(api, maker):
    client, state = api
    admin, _ = await _seed(maker, admin_devices=0)
    state["user"] = admin
    r = await client.post("/api/v1/admin/fund-notices", json=_body(mode="test"))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "no_device"


async def test_scheduled_past_rejected_future_saved(api, maker, spies):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    soon = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
    r = await client.post("/api/v1/admin/fund-notices", json=_body(mode="scheduled", scheduled_at=soon))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "scheduled_too_soon"
    future = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    r = await client.post("/api/v1/admin/fund-notices", json=_body(mode="scheduled", scheduled_at=future))
    assert r.status_code == 201 and r.json()["status"] == "scheduled"
    assert spies["published"] == [] and spies["dispatched"] == []
    # 예약도 같은 날 중복으로 센다
    assert (await client.post("/api/v1/admin/fund-notices", json=_body())).status_code == 409


async def test_cancel_only_scheduled(api, maker):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    future = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    sid = (await client.post("/api/v1/admin/fund-notices", json=_body(mode="scheduled", scheduled_at=future))).json()["id"]
    assert (await client.post(f"/api/v1/admin/push-sends/{sid}/cancel")).status_code == 200
    r = await client.post(f"/api/v1/admin/push-sends/{sid}/cancel")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_scheduled"
    assert (await client.post("/api/v1/admin/push-sends/999/cancel")).status_code == 404
    assert (await _sends(maker))[0].status == "cancelled"


async def test_preview_counts(api, maker):
    client, state = api
    admin, _ = await _seed(maker, admin_devices=1, fans=3)
    state["user"] = admin
    r = await client.get("/api/v1/admin/fund-notices/preview", params={"date": TODAY.isoformat()})
    assert r.json() == {"target_count": 3, "my_device_count": 1, "already_sent": False, "last_send": None}
    await client.post("/api/v1/admin/fund-notices", json=_body())
    r = await client.get("/api/v1/admin/fund-notices/preview", params={"date": TODAY.isoformat()})
    assert r.json()["already_sent"] is True and r.json()["last_send"]["status"] == "sending"


async def test_history_newest_first_with_sender(api, maker):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    await client.post("/api/v1/admin/fund-notices", json=_body(mode="test"))
    await client.post("/api/v1/admin/fund-notices", json=_body())
    r = (await client.get("/api/v1/admin/push-sends", params={"limit": 10})).json()
    assert r["total"] == 2
    assert [i["mode"] for i in r["items"]] == ["now", "test"]
    assert r["items"][0]["created_by_nickname"] == "관리자"


async def test_templates_crud_and_unknown_template_rejected(api, maker):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    t = (await client.post("/api/v1/admin/push-templates", json={"title": "제목", "body": "{date} 본문"})).json()
    r = await client.put(f"/api/v1/admin/push-templates/{t['id']}", json={"title": "새 제목", "body": "본문"})
    assert r.json()["title"] == "새 제목"
    assert [x["id"] for x in (await client.get("/api/v1/admin/push-templates")).json()] == [t["id"]]
    r = await client.post("/api/v1/admin/fund-notices", json=_body(template_id=999))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "template_not_found"
    assert (await client.delete(f"/api/v1/admin/push-templates/{t['id']}")).status_code == 204
    async with maker() as s:
        assert (await s.execute(select(PushTemplate))).scalars().all() == []


async def test_sse_failure_does_not_block_dispatch(api, maker, spies, monkeypatch):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin

    async def _boom(ev):
        raise RuntimeError("redis down")

    monkeypatch.setattr(fund_notice, "publish_event", _boom)
    r = await client.post("/api/v1/admin/fund-notices", json=_body())
    assert r.status_code == 201
    assert len(spies["dispatched"]) == 1

"""글 작성 — notify 가 참일 때만 앱 알림(Celery) 위임, 웹 SSE new_post 는 항상 발행."""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog.main import app
from apps.blog.routers import blogs as blogs_router
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, BlogPost, Board, User, UserRole


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def api(maker, monkeypatch):
    notified: list[int] = []
    events: list[dict] = []

    # blogs.py 가 이름으로 import 하므로 라우터 모듈의 이름을 바꿔 끼운다(실제 Celery·Redis 접근 없음)
    monkeypatch.setattr(blogs_router, "notify_new_post", lambda post_id: notified.append(post_id))

    async def _publish(event: dict) -> None:
        events.append(event)

    monkeypatch.setattr(blogs_router, "publish_event", _publish)

    async with maker() as s:
        admin = User(nickname="관리자", role=UserRole.ADMIN, is_active=True)
        board = Board(name="공지", order_index=0)
        s.add_all([admin, board])
        await s.commit()

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return admin  # ADMIN 이므로 require_admin 도 통과

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, board.id, notified, events
    app.dependency_overrides.clear()


def _body(board_id: int, **extra) -> dict:
    return {"board_id": board_id, "title": "새 글 제목", "content": "<p>본문</p>", **extra}


async def test_notify_omitted_does_not_delegate_but_publishes_sse(api):
    client, board_id, notified, events = api
    r = await client.post("/api/v1/blogs", json=_body(board_id))
    assert r.status_code == 201
    assert notified == []
    assert [e["type"] for e in events] == ["new_post"] and events[0]["post_id"] == r.json()["id"]


async def test_notify_false_does_not_delegate(api):
    client, board_id, notified, events = api
    r = await client.post("/api/v1/blogs", json=_body(board_id, notify=False))
    assert r.status_code == 201
    assert notified == []
    assert len(events) == 1


async def test_notify_true_delegates_and_publishes(api, maker):
    client, board_id, notified, events = api
    r = await client.post("/api/v1/blogs", json=_body(board_id, notify=True))
    assert r.status_code == 201
    post_id = r.json()["id"]
    assert notified == [post_id]
    assert len(events) == 1
    async with maker() as s:  # notify 는 컬럼이 아니다 — 글은 정상 저장
        post = (await s.execute(select(BlogPost).where(BlogPost.id == post_id))).scalar_one()
        assert post.title == "새 글 제목"


async def test_response_has_no_notify_field(api):
    client, board_id, _, _ = api
    r = await client.post("/api/v1/blogs", json=_body(board_id, notify=True))
    assert "notify" not in r.json()

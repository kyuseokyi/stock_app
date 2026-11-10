# 10단계. 자동 테스트 — 9단계를 매번 손으로 하지 않기

> 목표: 9단계에서 손으로 확인한 것을 pytest 코드로 만든다. 이후 누가 코드를 고쳐도 `uv run pytest` 한 번으로 북마크가 망가지지 않았는지 알 수 있다.

## 10-1. 이 프로젝트의 API 테스트 방식

- **진짜 PostgreSQL 없이** 메모리 SQLite 에 테이블을 만들어 테스트한다 → 빠르고, 아무 데서나 돈다.
- **진짜 로그인 없이** `get_current_user` 를 테스트 사용자로 바꿔 끼운다(`app.dependency_overrides`).
- **진짜 서버를 띄우지 않고** `httpx.ASGITransport` 로 FastAPI 앱에 직접 요청한다.
- 같은 방식의 기존 테스트: `backend/tests/test_push_devices_api.py`

## 10-2. 파일

`backend/tests/test_bookmarks_api.py` (파일 이름은 `test_` 로 시작해야 pytest 가 찾는다)

```python
"""게시글 북마크 API — 저장·중복 저장·목록·해제·없는 글·로그인 필요."""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog.main import app
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, BlogBookmark, BlogPost, Board, User, UserRole


@pytest.fixture
async def maker():
    # 테스트마다 메모리 SQLite 에 테이블을 새로 만든다(실제 PostgreSQL 불필요)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")  # SQLite 는 FK 검사를 켜야 한다

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def seeded(maker):
    """사용자 1명 + 게시판 1개 + 글 1개."""
    async with maker() as s:
        user = User(nickname="테스터", role=UserRole.FREE, is_active=True)
        board = Board(name="자유")
        s.add_all([user, board])
        await s.flush()  # id 를 먼저 받아 온다
        post = BlogPost(board_id=board.id, title="첫 글", content="<p>본문</p>")
        s.add(post)
        await s.commit()
        return user, post


@pytest.fixture
async def client(maker, seeded):
    user, _ = seeded

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return user  # 로그인 검사 대신 테스트 사용자를 넣는다

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _count(maker) -> int:
    async with maker() as s:
        return (await s.execute(select(func.count()).select_from(BlogBookmark))).scalar_one()


async def test_add_and_list(client, seeded, maker):
    _, post = seeded
    r = await client.put(f"/api/v1/blogs/{post.id}/bookmark")
    assert r.status_code == 200
    assert r.json()["post_title"] == "첫 글"

    r = await client.get("/api/v1/me/bookmarks")
    assert r.status_code == 200
    assert [b["post_id"] for b in r.json()] == [post.id]
    assert await _count(maker) == 1


async def test_add_twice_keeps_one_row(client, seeded, maker):
    _, post = seeded
    first = await client.put(f"/api/v1/blogs/{post.id}/bookmark")
    second = await client.put(f"/api/v1/blogs/{post.id}/bookmark")
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert await _count(maker) == 1


async def test_remove(client, seeded, maker):
    _, post = seeded
    await client.put(f"/api/v1/blogs/{post.id}/bookmark")
    r = await client.delete(f"/api/v1/blogs/{post.id}/bookmark")
    assert r.status_code == 204
    assert await _count(maker) == 0
    # 없는 북마크를 다시 해제해도 204
    assert (await client.delete(f"/api/v1/blogs/{post.id}/bookmark")).status_code == 204


async def test_missing_post_returns_404(client):
    r = await client.put("/api/v1/blogs/9999/bookmark")
    assert r.status_code == 404


async def test_login_required(maker):
    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/api/v1/me/bookmarks")  # 토큰 없음
            assert r.status_code == 401
    finally:
        app.dependency_overrides.clear()
```

## 10-3. 구조 이해

| 이름 | 종류 | 하는 일 |
|---|---|---|
| `maker` | fixture | 빈 메모리 DB + 테이블 생성 (테스트마다 새로 → 서로 영향 없음) |
| `seeded` | fixture | 사용자·게시판·글 준비 (`maker` 를 받아 씀) |
| `client` | fixture | 가짜 로그인 + DB 를 끼운 HTTP 클라이언트 |
| `test_...` | 테스트 | `assert` 가 하나라도 틀리면 실패 |

- **fixture** 는 테스트 함수의 인자 이름으로 요청하면 pytest 가 준비해서 넣어 준다(FastAPI 의 `Depends` 와 비슷한 발상).
- `async def test_...` 를 그냥 써도 되는 건 `pyproject.toml` 의 `asyncio_mode = "auto"` 덕분이다.
- 요구사항 → 테스트 대응: 1·4번 `test_add_and_list`, 2번 `test_add_twice_keeps_one_row`, 3번 `test_remove`, 5번 `test_missing_post_returns_404`, 6번 `test_login_required`.

## 10-4. 실행

```bash
cd backend
uv run pytest tests/test_bookmarks_api.py -v
```
기대 결과:
```
tests/test_bookmarks_api.py::test_add_and_list PASSED
tests/test_bookmarks_api.py::test_add_twice_keeps_one_row PASSED
tests/test_bookmarks_api.py::test_remove PASSED
tests/test_bookmarks_api.py::test_missing_post_returns_404 PASSED
tests/test_bookmarks_api.py::test_login_required PASSED
5 passed
```

## 10-5. 일부러 깨뜨려 보기 (중요)

테스트가 **정말 지켜 주는지** 확인하는 방법이다. 하나씩 해 보고 원래대로 돌린다.

| 코드를 이렇게 망가뜨리면 | 실패해야 하는 테스트 |
|---|---|
| 서비스 `add()` 에서 `find` 확인을 지우고 항상 `create` | `test_add_twice_keeps_one_row` (UNIQUE 위반 `IntegrityError`) |
| 레포지토리 `remove` 의 `user_id` 조건 삭제 | (지금 테스트로는 안 잡힘!) → 사용자 2명 테스트를 추가해 볼 것 |
| 라우터 `except PostNotFound` 삭제 | `test_missing_post_returns_404` (처리 안 된 예외로 에러 — 실제 서버라면 500) |
| 라우터에서 `Depends(get_current_user)` 삭제 | `test_login_required` |

두 번째 줄처럼 **안 잡히는 구멍**을 찾으면 테스트를 추가한다. 이게 테스트를 쓰는 실력이다(11단계 과제 3).

## 10-6. 실패 메시지 읽는 법

```
>       assert r.status_code == 200
E       assert 401 == 200
```
`E` 줄이 핵심: "기대는 200 인데 실제는 401". 에러(예외)로 끝난 테스트는 `FAILED` 대신 맨 아래에 파이썬 에러 이름(`IntegrityError` 등)과 우리 파일의 줄 번호가 찍힌다 — 그 줄부터 본다.

## 체크

- [ ] 5개 테스트가 통과했다.
- [ ] 10-5 표 중 2개 이상을 직접 깨뜨려 실패를 확인했다.
- [ ] 전체 테스트 `uv run pytest` 도 돌려 봤다.

> 참고(2026-11-09 확인): 전체 테스트를 돌리면 게임 시즌 정산 관련 3개(`test_ranking_and_settlement.py::test_settlement_next_season_dates`, `test_settlement_rehearsal.py` 2개)가 **북마크와 상관없이 원래부터** 실패한다(날짜에 따라 결과가 달라지는 테스트로 보인다). 북마크 작업 전후로 실패 목록이 같으면 내 변경 때문이 아니다.

← [9. 실행하고 확인](./09-run-and-check.md) · 다음: [11. 마무리 →](./11-wrap-up.md)

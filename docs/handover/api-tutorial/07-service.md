# 7단계. Service — 업무 규칙을 한곳에

> 목표: 1단계 요구사항(없는 글 금지, 중복 저장 허용, 해제는 항상 성공)을 코드로 옮긴다. 규칙을 라우터가 아닌 서비스에 두는 이유를 안다.

## 7-1. 파일

`backend/apps/blog/services/bookmarks.py` (새 파일)

```python
"""게시글 북마크 업무 규칙.

- 없는 글은 저장할 수 없다(404).
- 이미 저장한 글을 다시 저장해도 에러가 아니다(같은 결과 = 멱등).
- 저장하지 않은 글을 해제해도 에러가 아니다.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud
from ..bookmark_schemas import BookmarkOut
from ..repositories import bookmark_repo


class PostNotFound(Exception):
    """북마크하려는 글이 없다."""


async def add(db: AsyncSession, *, user_id: int, post_id: int) -> BookmarkOut:
    post = await crud.get_blog(db, post_id)
    if post is None:
        raise PostNotFound
    bookmark = await bookmark_repo.find(db, user_id=user_id, post_id=post_id)
    if bookmark is None:
        bookmark = await bookmark_repo.create(db, user_id=user_id, post_id=post_id)
    return BookmarkOut(
        id=bookmark.id, post_id=post.id, post_title=post.title, created_at=bookmark.created_at
    )


async def remove(db: AsyncSession, *, user_id: int, post_id: int) -> None:
    await bookmark_repo.remove(db, user_id=user_id, post_id=post_id)


async def list_mine(db: AsyncSession, *, user_id: int) -> list[BookmarkOut]:
    rows = await bookmark_repo.list_with_title(db, user_id=user_id)
    return [
        BookmarkOut(id=b.id, post_id=b.post_id, post_title=title, created_at=b.created_at)
        for b, title in rows
    ]
```

## 7-2. 요구사항 → 코드 대응

| 요구사항 (1단계) | 코드 |
|---|---|
| 5. 없는 글은 저장 불가 | `crud.get_blog` 가 `None` 이면 `raise PostNotFound` |
| 2. 두 번 저장해도 하나 | `find` 로 먼저 찾고, 없을 때만 `create` |
| 3. 해제 | `bookmark_repo.remove` (없어도 에러 없음) |
| 4. 목록에 제목 | `list_with_title` 결과를 `BookmarkOut` 으로 변환 |
| 6. 로그인 필요 | 여기 없음 — 라우터의 `Depends(get_current_user)` 가 담당 (8단계) |

> **기존 코드 재사용**: 글 조회는 이미 있는 `crud.get_blog` 를 그대로 쓴다. 같은 일을 하는 함수를 새로 만들지 않는다.

## 7-3. 왜 `HTTPException` 이 아니라 `PostNotFound` 를 던지나

- 서비스는 "HTTP" 를 모르는 층이다. 같은 `add()` 를 나중에 Celery 작업이나 관리자 스크립트에서 부를 수도 있는데, 거기엔 404 라는 개념이 없다.
- 그래서 서비스는 **"무슨 일이 일어났는지"(글이 없다)** 만 알리고, **"HTTP 로 어떻게 응답할지"(404)** 는 라우터가 정한다(8단계).
- 이 프로젝트에도 같은 방식이 있다: `apps/auth/services/` 의 예외들을 라우터가 401/403 으로 바꾼다.

## 7-4. 동시에 두 번 누르면? (조금 깊게)

`find` → 없음 → `create` 사이에 같은 사용자의 두 번째 요청이 끼어들면, 두 요청 모두 `create` 를 시도할 수 있다.
- 이때 2단계에서 건 **UNIQUE 제약조건**이 두 번째 INSERT 를 DB 에서 막는다(IntegrityError). 데이터는 절대 두 줄이 되지 않는다.
- 두 번째 요청은 500 에러가 날 수 있는데, 화면 버튼 연타 정도에서는 거의 일어나지 않아 실습에서는 여기까지만 한다.
- 더 단단하게 하려면 `IntegrityError` 를 잡아서 다시 `find` 하거나, PostgreSQL 의 `INSERT ... ON CONFLICT DO NOTHING` 을 쓴다. `apps/blog/repositories/push_repo.py` 의 `upsert_device` 가 IntegrityError 를 다루는 실제 예다 — 11단계 연습 과제로 남겨 둔다.

## 7-5. 이 층의 규칙

| 한다 | 하지 않는다 |
|---|---|
| 요구사항 판단 (있나? 중복인가?) | SQL 직접 작성 (repository 에 맡김) |
| 여러 repository 함수 조합 | HTTP 상태 코드·헤더 다루기 |
| 응답 스키마로 변환 | 토큰 검사 |

## 체크

- [ ] 1단계 요구사항 표의 각 줄이 어느 층(라우터/서비스/레포지토리/DB)에서 지켜지는지 말할 수 있다.
- [ ] 서비스가 HTTPException 을 던지지 않는 이유를 안다.

← [6. Repository](./06-repository.md) · 다음: [8. Router →](./08-router.md)

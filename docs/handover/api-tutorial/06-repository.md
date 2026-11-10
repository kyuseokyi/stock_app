# 6단계. Repository — DB 읽기/쓰기만 하는 함수들

> 목표: SQLAlchemy 로 조회·추가·삭제·조인을 하는 함수 4개를 만든다. "DB 와 대화하는 코드는 여기에만" 이라는 원칙을 몸에 익힌다.

## 6-1. 파일

`backend/apps/blog/repositories/bookmark_repo.py` (새 파일, 옆에 `push_repo.py` 가 같은 역할)

```python
"""blog_bookmarks DB 읽기/쓰기. 커밋까지 여기서 한다(crud.py·push_repo.py 관례)."""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import BlogBookmark, BlogPost


async def find(db: AsyncSession, *, user_id: int, post_id: int) -> BlogBookmark | None:
    stmt = select(BlogBookmark).where(
        BlogBookmark.user_id == user_id, BlogBookmark.post_id == post_id
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def create(db: AsyncSession, *, user_id: int, post_id: int) -> BlogBookmark:
    bookmark = BlogBookmark(user_id=user_id, post_id=post_id)
    db.add(bookmark)
    await db.commit()
    await db.refresh(bookmark)  # DB 가 채운 id·created_at 을 다시 읽어 온다
    return bookmark


async def remove(db: AsyncSession, *, user_id: int, post_id: int) -> None:
    await db.execute(
        delete(BlogBookmark).where(
            BlogBookmark.user_id == user_id, BlogBookmark.post_id == post_id
        )
    )
    await db.commit()


async def list_with_title(db: AsyncSession, *, user_id: int) -> list[tuple[BlogBookmark, str]]:
    stmt = (
        select(BlogBookmark, BlogPost.title)
        .join(BlogPost, BlogPost.id == BlogBookmark.post_id)
        .where(BlogBookmark.user_id == user_id)
        .order_by(BlogBookmark.created_at.desc(), BlogBookmark.id.desc())
    )
    return [(row[0], row[1]) for row in (await db.execute(stmt)).all()]
```

## 6-2. 함수별로 SQL 과 나란히 보기

### `find` — 하나 찾기
```sql
SELECT * FROM blog_bookmarks WHERE user_id = :user_id AND post_id = :post_id;
```
- `select(...).where(조건1, 조건2)` : 쉼표로 나열하면 AND.
- `.scalar_one_or_none()` : 결과가 0개면 `None`, 1개면 그 객체, **2개 이상이면 에러** (UNIQUE 가 있으니 2개일 수 없다).

### `create` — 추가
```sql
INSERT INTO blog_bookmarks (user_id, post_id) VALUES (:user_id, :post_id) RETURNING id, created_at;
```
- `db.add()` 는 "저장 예정 목록에 올리기"일 뿐이다. **`commit()` 해야 실제 저장**된다.
- `refresh()` : `id` 와 `created_at` 은 DB 가 만든 값이라, 다시 읽어 와야 객체에 채워진다.

### `remove` — 삭제
```sql
DELETE FROM blog_bookmarks WHERE user_id = :user_id AND post_id = :post_id;
```
- 지울 행이 없어도 에러가 나지 않는다(0행 삭제). 그래서 "저장 안 된 글 해제 → 204" 요구사항이 자연스럽게 지켜진다.
- 조건에 `user_id` 가 **반드시** 들어간다. 빠지면 그 글을 저장한 **모든 사람의** 북마크가 지워진다. 삭제 쿼리는 WHERE 를 두 번 확인한다.

### `list_with_title` — 조인 조회
```sql
SELECT blog_bookmarks.*, blog_posts.title
FROM blog_bookmarks
JOIN blog_posts ON blog_posts.id = blog_bookmarks.post_id
WHERE blog_bookmarks.user_id = :user_id
ORDER BY blog_bookmarks.created_at DESC, blog_bookmarks.id DESC;
```
- 2단계에서 "제목은 저장하지 않고 조인으로 가져온다" 고 정한 것을 여기서 실현한다.
- `select(BlogBookmark, BlogPost.title)` : 한 줄에 (북마크 객체, 제목 문자열) 두 개가 나온다.
- 정렬에 `id DESC` 를 한 번 더 넣은 이유: 같은 초에 저장된 두 건의 순서가 매번 달라지지 않게(결과가 항상 같게).

## 6-3. 이 층의 규칙

| 한다 | 하지 않는다 |
|---|---|
| SQL 조회·추가·삭제, commit | HTTP 상태 코드(404 등) 판단 |
| 쿼리에 필요한 인자만 받기 (`user_id`, `post_id`) | `User` 객체·요청(Request)을 통째로 받기 |
| 결과를 그대로 돌려주기 | "글이 있어야 저장 가능" 같은 업무 규칙 |

이렇게 나눠 두면 같은 함수를 Celery 작업이나 다른 서비스에서도 그대로 쓸 수 있다.

## 6-4. `*` 는 뭔가

`def find(db, *, user_id, post_id)` 의 `*` 뒤 인자는 **반드시 이름을 붙여서** 넘겨야 한다: `find(db, user_id=1, post_id=12)`.
`find(db, 12, 1)` 처럼 순서를 헷갈려 user 와 post 가 뒤바뀌는 사고를 막는다.

## 확인 (파이썬 대화형)

DB 와 마이그레이션이 적용된 상태에서:
```bash
cd backend
uv run python
```
```python
import asyncio
from shared.database import AsyncSessionLocal
from apps.blog.repositories import bookmark_repo

async def main():
    async with AsyncSessionLocal() as db:
        print(await bookmark_repo.list_with_title(db, user_id=1))

asyncio.run(main())
```
처음엔 `[]`. 9단계에서 API 로 저장한 뒤 다시 실행해 본다.

## 체크

- [ ] 함수 4개 각각에 해당하는 SQL 을 직접 쓸 수 있다.
- [ ] `add()` 만 하고 `commit()` 을 빼먹으면 어떻게 되는지 안다.
- [ ] 삭제 쿼리에서 `user_id` 조건이 빠지면 생기는 사고를 설명할 수 있다.

← [5. 스키마](./05-schema.md) · 다음: [7. Service →](./07-service.md)

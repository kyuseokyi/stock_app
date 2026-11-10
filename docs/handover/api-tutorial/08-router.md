# 8단계. Router — API 입구 만들고 서버에 등록하기

> 목표: 1단계에서 정한 주소 3개를 실제로 연다. 로그인 확인과 상태 코드를 여기서 처리하고, `main.py` 에 등록한다.

## 8-1. 파일

`backend/apps/blog/routers/bookmarks.py` (새 파일)

```python
"""게시글 북마크 REST 라우터 — 로그인 사용자 본인 것만."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User

from ..bookmark_schemas import BookmarkOut
from ..services import bookmarks

router = APIRouter(prefix="/api/v1", tags=["bookmarks"])


@router.put("/blogs/{blog_id}/bookmark", response_model=BookmarkOut)
async def add_bookmark(
    blog_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        return await bookmarks.add(db, user_id=user.id, post_id=blog_id)
    except bookmarks.PostNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시글을 찾을 수 없습니다.")


@router.delete("/blogs/{blog_id}/bookmark", status_code=status.HTTP_204_NO_CONTENT)
async def remove_bookmark(
    blog_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    await bookmarks.remove(db, user_id=user.id, post_id=blog_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/bookmarks", response_model=list[BookmarkOut])
async def my_bookmarks(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await bookmarks.list_mine(db, user_id=user.id)
```

## 8-2. 한 줄씩

| 코드 | 의미 |
|---|---|
| `APIRouter(prefix="/api/v1", tags=["bookmarks"])` | 이 파일의 주소 앞에 `/api/v1` 을 붙인다. `tags` 는 Swagger 화면의 묶음 이름 |
| `@router.put("/blogs/{blog_id}/bookmark", ...)` | `PUT /api/v1/blogs/{blog_id}/bookmark` 를 이 함수에 연결 |
| `blog_id: int` | 주소의 `{blog_id}` 를 정수로 받는다. 숫자가 아니면 FastAPI 가 422 |
| `Depends(get_db)` | 요청마다 DB 세션을 받아 오고 끝나면 닫는다 |
| `Depends(get_current_user)` | 토큰 검사 → `User`. 실패하면 함수 본문 실행 전에 401 |
| `response_model=BookmarkOut` | 반환값을 5단계 스키마 모양으로 JSON 변환 |
| `try ... except bookmarks.PostNotFound` | 서비스의 "글 없음"을 HTTP 404 로 바꾼다 (7-3) |
| `status_code=204` + `Response(...)` | 성공했지만 돌려줄 내용이 없음 |
| `user.id` | **토큰에서 나온** 사용자 번호만 쓴다 — 클라이언트가 보낸 값이 아니다 (1-3) |

## 8-3. 서버에 등록 — `apps/blog/main.py`

라우터 파일을 만들어도 **등록하지 않으면 주소가 열리지 않는다.** 두 줄을 고친다.

```python
# import 줄에 bookmarks 추가
from .routers import app_versions, blogs, bookmarks, boards, comments, notifications, push_admin, push_devices

# 라우터 등록 (comments 아래에)
app.include_router(comments.router)
app.include_router(bookmarks.router)
```

## 8-4. 라우터가 얇은지 점검

라우터 함수 본문이 **"서비스 호출 + 상태 코드 변환"** 뿐인지 본다. `select(...)` 같은 DB 코드나 `if post is None` 같은 규칙이 라우터에 있으면 6·7단계로 옮긴다. (프로젝트 규칙 — `CLAUDE.md` "Router → Service → Repository")

## 8-5. 주소 충돌 확인

같은 서비스 안에 같은 메서드+주소가 두 개면 먼저 등록된 쪽만 동작한다. 새 주소를 열기 전에 검색해 본다.
```bash
grep -rn '"/me/bookmarks"\|/bookmark"' backend/apps/blog/routers/
```

## 체크

- [ ] `main.py` 등록을 빼먹으면 어떤 응답(404 Not Found)이 오는지 예상할 수 있다.
- [ ] 로그인 검사 코드가 라우터 본문에 없는데도 401 이 나는 이유를 안다.
- [ ] 8-2 표를 보지 않고 각 줄을 설명할 수 있다.

← [7. Service](./07-service.md) · 다음: [9. 실행하고 확인 →](./09-run-and-check.md)

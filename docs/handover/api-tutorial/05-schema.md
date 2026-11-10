# 5단계. 응답 스키마 — JSON 모양을 pydantic 으로 정하기

> 목표: 1단계에서 써 둔 응답 예시를 pydantic 클래스로 만든다. DB 모델과 API 응답을 왜 따로 두는지 이해한다.

## 5-1. 파일

`backend/apps/blog/bookmark_schemas.py` (새 파일 — `push_schemas.py`, `app_version_schemas.py` 처럼 기능별로 나눈 관례)

```python
"""게시글 북마크 — 요청/응답 모양(pydantic)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class BookmarkOut(BaseModel):
    id: int
    post_id: int
    post_title: str
    created_at: datetime
```

1단계 응답 예시와 한 칸씩 대조해 본다:
```json
{ "id": 3, "post_id": 12, "post_title": "11월 시장 정리", "created_at": "2026-11-09T14:40:00+09:00" }
```

## 5-2. 이 클래스가 하는 일

1. **응답 모양 고정**: 라우터에 `response_model=BookmarkOut` 을 붙이면 FastAPI 가 반환값을 이 모양으로 맞춰서 JSON 으로 바꾼다. 클래스에 없는 필드는 응답에 나가지 않는다(실수로 비밀 정보가 새는 것을 막는다).
2. **타입 변환**: `datetime` 은 자동으로 `"2026-11-09T14:40:00+09:00"` 같은 문자열이 된다.
3. **문서화**: `/docs` (Swagger) 화면에 응답 예시로 자동 표시된다.

## 5-3. 왜 DB 모델(BlogBookmark)을 그대로 돌려주지 않나

| | DB 모델 `BlogBookmark` | 응답 스키마 `BookmarkOut` |
|---|---|---|
| 목적 | 저장 구조 | 화면이 필요한 모양 |
| `user_id` | 있음 | **없음** — 내 것만 보이니 필요 없다 |
| `post_title` | **없음** (다른 테이블에 있음) | 있음 — 화면에 제목이 필요 |

둘은 목적이 달라서 모양도 다르다. 분리해 두면 DB 구조를 바꿔도 API 응답(=웹·앱과의 약속)은 그대로 유지할 수 있다.

## 5-4. 요청 스키마는 왜 없나

- 저장(`PUT`)은 주소의 `{blog_id}` 와 토큰만 있으면 된다. 보낼 본문이 없다.
- 만약 "메모"를 같이 받고 싶다면 요청 스키마가 생긴다 (11단계 연습 과제):
  ```python
  class BookmarkIn(BaseModel):
      memo: str | None = Field(None, max_length=200)
  ```
  이렇게 쓰면 200자를 넘는 메모는 FastAPI 가 자동으로 422 로 거절한다.

## 5-5. 응답 필드 이름 규칙

- 서버는 `snake_case`(`post_id`) — 백엔드 전체 관례.
- 웹은 그대로 `post_id` 를 쓰고(`web_client/src/types/`), 앱은 받은 뒤 `postId` 로 바꿔 쓴다(`mobile/src/features/blog/comments-api.ts` 참고).
- **한 번 공개한 필드 이름은 바꾸지 않는다.** 설치된 앱이 그 이름을 믿고 있다. 추가는 안전, 변경·삭제는 위험.

## 확인

```bash
cd backend
uv run python -c "
from datetime import datetime
from apps.blog.bookmark_schemas import BookmarkOut
print(BookmarkOut(id=1, post_id=12, post_title='제목', created_at=datetime.now()).model_dump_json())
"
```
`post_title` 을 빼고 실행해 보면 어떤 에러가 나는지도 본다.

## 체크

- [ ] `response_model` 이 하는 일 3가지를 말할 수 있다.
- [ ] DB 모델과 응답 스키마를 나누는 이유를 안다.

← [4. 마이그레이션](./04-migration.md) · 다음: [6. Repository →](./06-repository.md)

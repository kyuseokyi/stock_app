# 추천 글(Featured Posts) 큐레이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 게시글을 "홈 추천"으로 켜면 모바일 홈 화면에 최근에 켠 순으로 노출된다.

**Architecture:** `blog_posts`에 `featured_at TIMESTAMP NULL` 컬럼 하나를 추가(additive). 기존 REST `GET /api/v1/blogs`에 `featured` 필터만 얹고(새 엔드포인트 없음), 토글은 기존 PUT 경로 재사용. 관리자 목록에서 ⭐ 토글, 모바일 빈 홈을 추천 글 리스트로 교체하며 `BlogCard`를 blog 탭과 공유하도록 추출한다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Alembic + PostgreSQL(백엔드), React+Vite+axios(admin_web), React Native/Expo + Unistyles(mobile). 백엔드 테스트는 pytest + aiosqlite.

**Spec:** `docs/superpowers/specs/2026-09-14-featured-posts-design.md`

**참고 — 검증 전략:** 백엔드 filter/ordering만 자동 테스트(aiosqlite)로 잠근다. admin_web·mobile은 JS 테스트 하니스가 없으므로 빌드 통과 + 수동 클릭 검증으로 확인한다(이번 단위에 JS 테스트 인프라 신설은 YAGNI).

**커밋 규칙:** 모든 커밋 전 브랜치 가드 실행 — `b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q`. 커밋은 stock_app 루트에서 전체 폴더 대상. 커밋 메시지 말미에:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
```

---

## File Structure

| 레이어 | 파일 | 책임 |
|---|---|---|
| model | `backend/shared/models.py` | `BlogPost.featured_at` 컬럼 |
| migration | `backend/alembic/versions/f1e2d3c4b5a6_blog_posts_featured_at.py` (신규) | 컬럼 additive 추가/제거 |
| schema | `backend/apps/blog/schemas.py` | `BlogOut.featured_at`(응답), `BlogUpdate.featured`(쓰기) |
| repo | `backend/apps/blog/crud.py` | `list_blogs` featured 필터/정렬, `update_blog` featured→featured_at 번역 |
| router | `backend/apps/blog/routers/blogs.py` | `featured` 쿼리 파라미터 |
| test | `backend/tests/test_blog_featured.py` (신규) | crud 필터/정렬/토글 잠금 |
| test cfg | `backend/pyproject.toml` | pytest-asyncio + aiosqlite dev dep, asyncio_mode |
| admin | `admin_web/src/pages/BlogListPage.jsx` | 행별 ⭐ 추천 토글(낙관적 업데이트) |
| admin | `admin_web/src/api/blogs.js` | (변경 없음 — `updateBlog` 재사용) |
| mobile | `mobile/src/features/blog/blog-card.tsx` (신규) | `BlogCard`·`stripHtml`·`fmtDate` 추출 |
| mobile | `mobile/src/features/blog/api.ts` | `featured` 파라미터 + `featured_at` 매핑 |
| mobile | `mobile/src/features/blog/types.ts` | `featuredAt` 타입 |
| mobile | `mobile/src/features/blog/use-featured-posts.ts` (신규) | 추천 글 조회 훅 |
| mobile | `mobile/src/app/(tabs)/blog.tsx` | 추출한 `BlogCard` 사용 |
| mobile | `mobile/src/app/(tabs)/index.tsx` | 홈 = 추천 글 리스트 |
| docs | `README.md` | 추천 글 기능/필드 반영 |

---

## Task 1: 백엔드 모델 + Alembic 마이그레이션

**Files:**
- Modify: `backend/shared/models.py` (BlogPost, `view_count` 아래)
- Create: `backend/alembic/versions/f1e2d3c4b5a6_blog_posts_featured_at.py`

- [ ] **Step 1: 모델에 컬럼 추가**

`backend/shared/models.py` 의 `BlogPost` 에서 `view_count` 정의 바로 아래에 추가:

```python
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 홈 추천(큐레이션): 켠 시각. NULL=추천 아님. 홈은 featured_at DESC 로 노출.
    featured_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
```

> `DateTime`·`datetime` 은 이미 `models.py` 상단에 import 되어 있다(TimestampMixin에서 사용). 추가 import 불필요.

- [ ] **Step 2: 마이그레이션 파일 작성**

`backend/alembic/versions/f1e2d3c4b5a6_blog_posts_featured_at.py`:

```python
"""blog_posts.featured_at 추가 (홈 추천 큐레이션)

Revision ID: f1e2d3c4b5a6
Revises: cf0877c663a1
Create Date: 2026-09-14

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1e2d3c4b5a6"
down_revision: Union[str, Sequence[str], None] = "cf0877c663a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "blog_posts",
        sa.Column("featured_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_blog_posts_featured_at", "blog_posts", ["featured_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_blog_posts_featured_at", table_name="blog_posts")
    op.drop_column("blog_posts", "featured_at")
```

- [ ] **Step 3: 로컬 DB에 적용 (⚠️ 개발서버 터널 아닌 로컬 DB)**

먼저 로컬 DB가 떠 있는지/터널이 아닌지 확인 후:

```bash
cd backend
docker compose -f ../docker-compose.dev.yml up -d   # 로컬 DB (터널 세션이면 종료 먼저)
uv run alembic upgrade head
```
Expected: `Running upgrade cf0877c663a1 -> f1e2d3c4b5a6`

> ⚠️ `.env.development` 이 개발서버 터널(15432/18123)을 가리키면 공유 스키마가 바뀐다. 로컬 검증은 로컬 DB로. develop 반영은 서버 배포 시 별도(Task 8 §배포 노트).

- [ ] **Step 4: 롤백 왕복 확인**

```bash
uv run alembic downgrade -1 && uv run alembic upgrade head
```
Expected: 에러 없이 down→up 성공.

- [ ] **Step 5: 커밋**

```bash
cd ..
b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add backend/shared/models.py backend/alembic/versions/f1e2d3c4b5a6_blog_posts_featured_at.py
git commit -m "$(cat <<'EOF'
feat(blog): BlogPost.featured_at 컬럼 + 마이그레이션 (홈 추천)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 2: 백엔드 스키마 (featured 입출력 필드)

**Files:**
- Modify: `backend/apps/blog/schemas.py` (`BlogUpdate`, `BlogOut`)

- [ ] **Step 1: `BlogUpdate` 에 쓰기 필드 추가**

`BlogUpdate` 클래스에 필드 추가:

```python
class BlogUpdate(BaseModel):
    board_id: int | None = None
    title: str | None = Field(None, max_length=255)
    content: str | None = None
    thumbnail_url: str | None = Field(None, max_length=512)
    featured: bool | None = Field(None, description="홈 추천 on/off")
```

- [ ] **Step 2: `BlogOut` 에 응답 필드 추가**

`BlogOut` 클래스에 `view_count` 아래로 추가:

```python
class BlogOut(BlogBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    author_id: int | None
    view_count: int
    featured_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
```

> `featured_at` 만 노출하면 충분하다. 클라이언트는 `featured_at != null` 로 추천 여부를 판단한다(admin 토글 상태 표시).

- [ ] **Step 3: import 로 문법 확인**

```bash
cd backend && uv run python -c "from apps.blog import schemas; print(schemas.BlogUpdate.model_fields.keys()); print('featured_at' in schemas.BlogOut.model_fields)"
```
Expected: `dict_keys([... 'featured'])` 와 `True`

- [ ] **Step 4: 커밋**

```bash
cd .. && b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add backend/apps/blog/schemas.py
git commit -m "$(cat <<'EOF'
feat(blog): BlogUpdate.featured / BlogOut.featured_at 스키마

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 3: 백엔드 crud (필터/정렬 + featured 번역) — TDD

**Files:**
- Modify: `backend/pyproject.toml` (dev deps + asyncio_mode)
- Create: `backend/tests/test_blog_featured.py`
- Modify: `backend/apps/blog/crud.py` (`list_blogs`, `update_blog`)

- [ ] **Step 1: 테스트 의존성 추가**

`backend/pyproject.toml` 의 dev 의존성 그룹(기존 `pytest>=9.1.1` 이 있는 배열)에 두 줄 추가:

```toml
    "pytest>=9.1.1",
    "pytest-asyncio>=0.24.0",
    "aiosqlite>=0.20.0",
```

그리고 `[tool.pytest.ini_options]` 에 `asyncio_mode` 추가:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "-q"
asyncio_mode = "auto"
```

설치:
```bash
cd backend && uv sync
```

- [ ] **Step 2: 실패하는 테스트 작성**

`backend/tests/test_blog_featured.py`:

```python
"""홈 추천(featured) 필터·정렬·토글 crud 회귀 테스트.

공유 DB 하니스가 없어 self-contained aiosqlite 인메모리 세션을 쓴다.
"""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog import crud, schemas
from shared.models import Base, BlogPost, Board


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _seed(session, n: int = 3) -> tuple[Board, list[BlogPost]]:
    board = Board(name="테스트", order_index=0)
    session.add(board)
    await session.commit()
    await session.refresh(board)
    posts = []
    for i in range(n):
        p = BlogPost(board_id=board.id, title=f"글{i}", content="<p>x</p>")
        session.add(p)
        posts.append(p)
    await session.commit()
    for p in posts:
        await session.refresh(p)
    return board, posts


async def test_featured_none_returns_all(session):
    _, posts = await _seed(session)
    total, items = await crud.list_blogs(session)
    assert total == 3
    assert len(items) == 3


async def test_featured_filter_and_order(session):
    _, posts = await _seed(session)
    # posts[0] 먼저 추천, posts[2] 나중에 추천 → featured_at DESC 로 posts[2] 가 위
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    await crud.update_blog(session, posts[2], schemas.BlogUpdate(featured=True))

    total, items = await crud.list_blogs(session, featured=True)
    assert total == 2
    assert [p.id for p in items] == [posts[2].id, posts[0].id]


async def test_unfeature_removes_from_list(session):
    _, posts = await _seed(session)
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=False))
    total, items = await crud.list_blogs(session, featured=True)
    assert total == 0
    assert items == []


async def test_update_other_field_keeps_featured(session):
    """featured 를 안 보낸 수정은 featured_at 을 건드리지 않는다(회귀 방지)."""
    _, posts = await _seed(session)
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(title="수정됨"))
    total, _ = await crud.list_blogs(session, featured=True)
    assert total == 1
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

```bash
cd backend && uv run pytest tests/test_blog_featured.py -v
```
Expected: FAIL — `list_blogs()` 에 `featured` 인자 없음(TypeError) / `update_blog` 이 `featured` 를 컬럼으로 setattr 시도해 에러.

- [ ] **Step 4: `list_blogs` 에 featured 필터/정렬 추가**

`backend/apps/blog/crud.py` 의 `list_blogs` 를 아래로 교체:

```python
async def list_blogs(
    db: AsyncSession,
    *,
    board_id: int | None = None,
    featured: bool | None = None,
    page: int = 1,
    size: int = 20,
) -> tuple[int, list[BlogPost]]:
    """(total, items) 페이지네이션 결과.

    featured=True 면 추천(featured_at IS NOT NULL)만 최근에 켠 순으로 반환.
    """
    base = select(BlogPost)
    count_stmt = select(func.count()).select_from(BlogPost)
    if board_id is not None:
        base = base.where(BlogPost.board_id == board_id)
        count_stmt = count_stmt.where(BlogPost.board_id == board_id)
    if featured is True:
        base = base.where(BlogPost.featured_at.is_not(None))
        count_stmt = count_stmt.where(BlogPost.featured_at.is_not(None))
        order = (BlogPost.featured_at.desc(), BlogPost.id.desc())
    else:
        order = (BlogPost.created_at.desc(), BlogPost.id.desc())

    total = (await db.execute(count_stmt)).scalar_one()
    stmt = base.order_by(*order).offset((page - 1) * size).limit(size)
    items = list((await db.execute(stmt)).scalars().all())
    return total, items
```

- [ ] **Step 5: `update_blog` 에 featured→featured_at 번역 추가**

같은 파일의 `update_blog` 를 아래로 교체(상단에 `datetime` import 추가):

```python
from datetime import datetime, timezone
```

```python
async def update_blog(
    db: AsyncSession, post: BlogPost, data: schemas.BlogUpdate
) -> BlogPost:
    values = data.model_dump(exclude_unset=True)
    # featured(불리언) 은 컬럼이 아니라 featured_at(타임스탬프)으로 번역한다.
    if "featured" in values:
        featured = values.pop("featured")
        post.featured_at = datetime.now(timezone.utc) if featured else None
    for key, value in values.items():
        setattr(post, key, value)
    await db.commit()
    await db.refresh(post)
    return post
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

```bash
cd backend && uv run pytest tests/test_blog_featured.py -v
```
Expected: 4 passed. 이어서 기존 테스트 회귀 확인:
```bash
uv run pytest -q
```
Expected: 기존 15개 + 신규 4개 전부 pass.

- [ ] **Step 7: 커밋**

```bash
cd .. && b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add backend/apps/blog/crud.py backend/tests/test_blog_featured.py backend/pyproject.toml backend/uv.lock
git commit -m "$(cat <<'EOF'
feat(blog): list_blogs featured 필터/정렬 + update_blog featured 번역 (+테스트)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 4: 백엔드 라우터 (featured 쿼리 파라미터)

**Files:**
- Modify: `backend/apps/blog/routers/blogs.py` (`read_blogs`)

- [ ] **Step 1: `read_blogs` 에 featured 파라미터 추가**

`read_blogs` 를 아래로 교체:

```python
@router.get("", response_model=schemas.BlogListOut)
async def read_blogs(
    board_id: int | None = Query(None, description="게시판 ID로 필터"),
    featured: bool | None = Query(None, description="true면 홈 추천글만"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    total, items = await crud.list_blogs(
        db, board_id=board_id, featured=featured, page=page, size=size
    )
    return schemas.BlogListOut(total=total, page=page, size=size, items=items)
```

- [ ] **Step 2: 로컬 서버로 수동 검증**

blog 서버 기동 후:
```bash
cd backend && uv run uvicorn apps.blog.main:app --port 8000 &
sleep 2
curl -s "http://localhost:8000/api/v1/blogs?featured=true&size=5" | head -c 300
```
Expected: `{"total":...,"items":[...]}` (초기엔 total 0). 기존 `curl "http://localhost:8000/api/v1/blogs"` 도 여전히 전체 반환.

- [ ] **Step 3: 커밋**

```bash
b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add backend/apps/blog/routers/blogs.py
git commit -m "$(cat <<'EOF'
feat(blog): GET /blogs featured 쿼리 파라미터

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 5: admin_web 추천 토글

**Files:**
- Modify: `admin_web/src/pages/BlogListPage.jsx`

- [ ] **Step 1: import 에 `updateBlog` 추가**

`BlogListPage.jsx` 상단 import 를 교체:

```jsx
import { deleteBlog, listBlogs, updateBlog } from '../api/blogs'
```

- [ ] **Step 2: 토글 핸들러 추가**

`onDelete` 함수 바로 아래에 추가(같은 낙관적 업데이트+롤백 패턴):

```jsx
  const onToggleFeatured = async (post) => {
    const next = !post.featured_at
    const prev = data
    // 낙관적 반영: 해당 행만 즉시 갱신(깜빡임 방지)
    setData((d) => ({
      ...d,
      items: d.items.map((i) =>
        i.id === post.id
          ? { ...i, featured_at: next ? new Date().toISOString() : null }
          : i,
      ),
    }))
    try {
      await updateBlog(post.id, { featured: next })
      showToast(next ? '홈 추천으로 설정했습니다.' : '홈 추천을 해제했습니다.', {
        icon: next ? '⭐' : '🔕',
      })
    } catch {
      setData(prev) // 실패 시 롤백
      showToast('추천 설정에 실패했습니다.', { icon: '⚠️' })
    }
  }
```

- [ ] **Step 3: 테이블에 "추천" 컬럼 추가**

`<thead>` 의 `<tr>` 에서 "제목" `<th>` 다음에 추가:

```jsx
              <th className="px-4 py-3 font-medium">제목</th>
              <th className="px-4 py-3 text-center font-medium">추천</th>
              <th className="px-4 py-3 font-medium">게시판</th>
```

`<tbody>` 의 각 행에서 제목 `<td>` 다음에 추가:

```jsx
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => onToggleFeatured(p)}
                      title={p.featured_at ? '홈 추천 해제' : '홈 추천 설정'}
                      className="text-lg leading-none"
                    >
                      {p.featured_at ? '⭐' : '☆'}
                    </button>
                  </td>
```

그리고 로딩/빈 상태 행의 `colSpan={5}` 을 두 곳 모두 **`colSpan={6}`** 으로 변경(컬럼이 하나 늘었으므로).

- [ ] **Step 4: 빌드 검증**

```bash
cd admin_web && npm run build
```
Expected: 빌드 성공(에러 0).

- [ ] **Step 5: 수동 클릭 검증**

`npm run dev` 후 게시글 관리 화면에서: ☆ 클릭 → ⭐ 로 바뀌고 "홈 추천으로 설정했습니다" 토스트. 다시 클릭 → ☆ + 해제 토스트. 새로고침해도 상태 유지(서버 반영 확인).

- [ ] **Step 6: 커밋**

```bash
cd .. && b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add admin_web/src/pages/BlogListPage.jsx
git commit -m "$(cat <<'EOF'
feat(admin): 게시글 목록 행별 홈 추천 토글(⭐)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 6: mobile API·타입·훅

**Files:**
- Modify: `mobile/src/features/blog/types.ts`
- Modify: `mobile/src/features/blog/api.ts`
- Create: `mobile/src/features/blog/use-featured-posts.ts`

- [ ] **Step 1: 타입에 `featuredAt` 추가**

`types.ts` 의 `BlogPost` 에 `viewCount` 아래로 추가:

```typescript
  viewCount: number;
  featuredAt: string | null; // ISO, null이면 추천 아님
  createdAt: string; // ISO
```

- [ ] **Step 2: api.ts 매핑 + featured 파라미터**

`api.ts` 의 `RawBlog` 타입에 `view_count` 아래로 추가:

```typescript
  view_count: number;
  featured_at: string | null;
  created_at: string;
```

`toBlogPost` 의 `viewCount` 아래로 추가:

```typescript
    viewCount: r.view_count,
    featuredAt: r.featured_at,
    createdAt: r.created_at,
```

`fetchBlogList` 시그니처와 쿼리에 `featured` 추가:

```typescript
export async function fetchBlogList(params?: {
  boardId?: number;
  featured?: boolean;
  page?: number;
  size?: number;
}): Promise<BlogListResponse> {
  const raw = await blogApi.get<RawBlogList>('/api/v1/blogs', {
    board_id: params?.boardId,
    featured: params?.featured,
    page: params?.page,
    size: params?.size ?? 20,
  });
  return {
    total: raw.total,
    page: raw.page,
    size: raw.size,
    items: raw.items.map(toBlogPost),
  };
}
```

- [ ] **Step 3: 추천 글 훅 작성**

`mobile/src/features/blog/use-featured-posts.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';

import { fetchBlogList } from './api';
import type { BlogPost } from './types';

type State = {
  data: BlogPost[];
  loading: boolean;
  error: string | null;
};

/** 홈 추천 글(featured_at DESC)을 불러온다. */
export function useFeaturedPosts(size = 20) {
  const [state, setState] = useState<State>({ data: [], loading: true, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetchBlogList({ featured: true, size });
      setState({ data: res.items, loading: false, error: null });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `서버 오류 (${e.status})`
          : '네트워크 오류 — blog 서비스(:8000)가 실행 중인지 확인하세요';
      setState({ data: [], loading: false, error: msg });
    }
  }, [size]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}
```

- [ ] **Step 4: 타입체크**

```bash
cd mobile && npx tsc --noEmit
```
Expected: 에러 0.

- [ ] **Step 5: 커밋**

```bash
cd .. && b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add mobile/src/features/blog/types.ts mobile/src/features/blog/api.ts mobile/src/features/blog/use-featured-posts.ts
git commit -m "$(cat <<'EOF'
feat(mobile): featured 파라미터/매핑 + useFeaturedPosts 훅

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 7: mobile BlogCard 추출 + 홈 화면

**Files:**
- Create: `mobile/src/features/blog/blog-card.tsx`
- Modify: `mobile/src/app/(tabs)/blog.tsx`
- Modify: `mobile/src/app/(tabs)/index.tsx`

- [ ] **Step 1: `BlogCard` 를 공용 컴포넌트로 추출**

`mobile/src/features/blog/blog-card.tsx`:

```tsx
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { BlogPost } from './types';

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {post.title}
      </Text>
      <Text style={styles.cardSnippet} numberOfLines={2}>
        {stripHtml(post.content)}
      </Text>
      <Text style={styles.cardMeta}>
        조회 {post.viewCount} · {fmtDate(post.createdAt)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.gap(2),
    gap: theme.gap(0.5),
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  cardSnippet: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
  },
  cardMeta: {
    marginTop: theme.gap(0.5),
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
}));
```

- [ ] **Step 2: `blog.tsx` 를 추출본 사용으로 교체**

`blog.tsx` 에서 로컬 `stripHtml`·`fmtDate`·`BlogCard` 정의와 그 `card*` 스타일을 제거하고, 상단 import 에 추가:

```tsx
import { BlogCard } from '@/features/blog/blog-card';
```

`styles` 객체에서 `card`, `cardTitle`, `cardSnippet`, `cardMeta` 항목을 삭제한다(나머지 `center/hint/errorTitle/retry/retryText/list/listContent/sep` 는 유지). `renderItem` 은 그대로 `<BlogCard post={item} />` 를 쓴다.

- [ ] **Step 3: 홈 화면 = 추천 글 리스트**

`mobile/src/app/(tabs)/index.tsx` 전체 교체:

```tsx
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { BlogCard } from '@/features/blog/blog-card';
import { useFeaturedPosts } from '@/features/blog/use-featured-posts';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { data, loading, error, reload } = useFeaturedPosts();

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator />
        <Text style={styles.hint}>불러오는 중…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorTitle}>추천 글을 불러오지 못했습니다</Text>
        <Text style={styles.hint}>{error}</Text>
        <Pressable style={styles.retry} onPress={reload}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>📌 추천 글</Text>
        <Text style={styles.hint}>아직 추천 글이 없습니다</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={[styles.listContent, { paddingTop: insets.top + 16 }]}
      data={data}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={<Text style={styles.title}>📌 추천 글</Text>}
      renderItem={({ item }) => <BlogCard post={item} />}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    gap: theme.gap(1),
    padding: theme.gap(3),
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.colors.text,
    marginBottom: theme.gap(1.5),
  },
  hint: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  retry: {
    marginTop: theme.gap(1),
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(2),
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  retryText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  list: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  listContent: {
    padding: theme.gap(2),
  },
  sep: {
    height: theme.gap(1.5),
  },
}));
```

- [ ] **Step 4: 타입체크 + 회귀 확인**

```bash
cd mobile && npx tsc --noEmit
```
Expected: 에러 0. blog 탭 카드가 추출 후에도 동일하게 보이는지(수동) + 홈에 추천 글 노출/빈 상태 확인.

- [ ] **Step 5: 커밋**

```bash
cd .. && b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add mobile/src/features/blog/blog-card.tsx "mobile/src/app/(tabs)/blog.tsx" "mobile/src/app/(tabs)/index.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): 홈을 추천 글 리스트로 교체 + BlogCard 공용 추출

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 8: 문서 업데이트 + 배포 노트

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 에 추천 글 기능 반영**

`README.md` 에서 블로그/기능 설명 섹션에 한 항목 추가(정확한 위치는 기존 목차에 맞춰):

```markdown
- **홈 추천 글(큐레이션)**: 관리자 게시글 목록에서 ⭐ 토글로 "홈 추천"을 켜면(`blog_posts.featured_at`),
  모바일 홈 탭에 최근에 켠 순으로 노출된다. API: `GET /api/v1/blogs?featured=true`.
```

- [ ] **Step 2: 배포 노트 확인(마이그레이션 실행 시점)**

`docs/run_and_deploy.md` §B-4 "배포 시 주의" 에 이미 "최초 배포 후 스키마 부트스트랩 1회" 항목이 있다. featured_at 마이그레이션은 이 경로(서버 배포 시 컨테이너에서 `alembic upgrade head`)로 develop 에 반영된다 — 추가 문서 변경이 필요하면 한 줄 보강, 아니면 생략.

- [ ] **Step 3: 전체 테스트 최종 확인**

```bash
cd backend && uv run pytest -q && cd ..
```
Expected: 전부 pass.

- [ ] **Step 4: 커밋**

```bash
b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add README.md docs/run_and_deploy.md
git commit -m "$(cat <<'EOF'
docs: 홈 추천 글 기능 README 반영

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## 배포 (사용자 확인 후)

- `dev` → `main` 병합 push 시:
  - `backend/**` 변경 → **Deploy Server** 워크플로가 blog API 재빌드 + 컨테이너에서 마이그레이션 반영.
  - `admin_web/**` 변경 → **Deploy Web**.
  - mobile 은 EAS 별도(자동 배포 대상 아님).
- 수집 시간(20:30) 회피. 마이그레이션은 additive 라 무중단.

---

## Self-Review 결과

- **Spec 커버리지:** 데이터(§2)=Task1, 백엔드 필터/토글(§3)=Task2·3·4, 관리자(§4)=Task5, 모바일 홈(§5)=Task6·7, 문서/배포=Task8. 후속 단위(§7 web_client/상세)는 의도적으로 제외 — 계획에 미포함이 맞음.
- **Placeholder 스캔:** 모든 코드 스텝에 실제 코드 포함. "적절히/나중에" 없음.
- **타입 일관성:** `featured`(API 입력, 불리언) ↔ `featured_at`(컬럼/응답, 타임스탬프) 구분 일관. mobile `featuredAt`(camel) ↔ `featured_at`(raw) 매핑 명시. `colSpan` 5→6 반영. `useFeaturedPosts` 시그니처 훅↔홈 일치.

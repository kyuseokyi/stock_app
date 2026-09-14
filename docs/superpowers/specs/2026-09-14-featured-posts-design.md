# 추천 글(Featured Posts) 큐레이션 — 설계

- 날짜: 2026-09-14
- 상태: 설계 확정 (구현 대기)
- 범위(이번 단위): 관리자가 게시글을 "홈 노출(추천)"로 켜면, **모바일 홈 화면**에 최근에 켠 순으로 노출된다.

## 1. 배경 / 목적

모바일 홈 탭(`mobile/src/app/(tabs)/index.tsx`)은 현재 빈 `ScreenPlaceholder`다. 첫 진입 화면을
관리자가 직접 편성한 **추천 글**로 채워 앱의 첫인상을 만든다.

- **종목 추천은 하지 않는다**(사용자 결정). 큐레이션 대상은 "글"이다.
- 기존 `blog_posts`를 재사용하므로 새 테이블/새 백엔드 스택이 없다(회귀 위험 최소).
- 정렬은 **자동(최근에 켠 순)**. 관리자가 순서를 수동 지정하지 않는다.

## 2. 데이터 모델

`BlogPost`(`backend/shared/models.py:139`)에 컬럼 하나 추가:

```python
featured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

- "추천 켬" = `featured_at = now()`, "끔" = `NULL`.
- `is_featured`라는 개념은 곧 `featured_at IS NOT NULL`.
- 홈 정렬 = `ORDER BY featured_at DESC` → **최근에 켠 글이 맨 위**.

> **왜 불리언이 아니라 타임스탬프인가**: 불리언 하나면 정렬이 `created_at`으로 밀려
> "오래된 글을 위로 고정"이 불가능하다. 타임스탬프 한 컬럼이면 비용은 동일하면서
> "최근에 켠 순"을 정확히 구현한다.

### 마이그레이션 (Alembic)

- **additive & backward-compatible**: `nullable=True`(기본 `NULL`)로만 추가.
  현재 배포된 blog API는 이 컬럼을 몰라도 계속 동작 → **배포 순서 무관**.
- ⚠️ **실행 대상 DB 주의(Regression Prevention, CLAUDE.md §6)**:
  `alembic upgrade head`를 **개발서버 DB에 터널로 붙은 상태**로 돌리면
  공유 develop 스키마가 바뀐다(`docs/db_access.md`, `run_and_deploy.md` §3 참고).
  - 로컬 검증은 로컬 DB(`docker-compose.dev.yml`)에서.
  - develop 반영은 **서버 배포 파이프라인이 컨테이너에서 1회 실행**하도록 한다
    (수동 실행 시 조용한 시간, 수집 20:30 회피).

## 3. 백엔드 (blog 서비스, 새 엔드포인트 없음)

기존 `GET /api/v1/blogs`에 필터만 추가한다.

- `apps/blog/routers/blogs.py`: 목록 엔드포인트에 `featured: bool | None = None` 쿼리 파라미터.
- `apps/blog/crud.py`: `featured is True`면 `WHERE featured_at IS NOT NULL ORDER BY featured_at DESC`.
  (기존 필터/정렬은 그대로 — 회귀 없음)
- `apps/blog/schemas.py`:
  - 응답 스키마에 `featured_at`(또는 파생 `is_featured`) 노출.
  - 글 수정(PATCH) 스키마에 `featured: bool | None` 쓰기 필드 추가(관리자 토글용).
- 토글은 기존 글 수정 경로를 재사용: `featured=true` → `featured_at=now()`, `featured=false` → `NULL`.

## 4. 관리자 화면 (admin_web)

`admin_web/src/pages/BlogListPage.jsx` 각 행에 **⭐ 추천 토글 버튼** 추가.

- 클릭 시 추천 on/off 를 PATCH 로 전송.
- 같은 파일 `onDelete`에 이미 있는 **낙관적 업데이트 + 롤백 + `showToast`** 패턴 재사용
  (깜빡임 없이 즉시 반영, 실패 시 롤백 & 토스트).
- 별도 큐레이션 페이지 없이 글 목록에서 바로 편성(가장 적은 클릭).

## 5. 모바일 홈 화면 (client, 이번 단위의 최종 산출)

`mobile/src/app/(tabs)/index.tsx` 를 추천 글 리스트로 교체.

```
┌─ 홈 ───────────────────────┐
│  📌 추천 글                 │  ← 섹션 헤더
│  ┌───────────────────────┐ │
│  │ [썸네일] 제목            │ │  ← BlogCard (blog 탭과 공유)
│  │ 본문 요약 두 줄…        │ │
│  │ 조회 n · 2026.09.10    │ │
│  └───────────────────────┘ │
│  … (featured_at DESC, 최대 N개)
└────────────────────────────┘
```

- 조회: `GET /api/v1/blogs?featured=true&size=N` (기존 모바일 REST 경로 그대로).
- **`BlogCard` 컴포넌트를 `blog.tsx`에서 `mobile/src/features/blog/`로 추출**해
  홈·블로그 탭이 한 카드를 공유(중복 렌더 방지 = 회귀 방지).
- 로딩/에러/빈 상태는 blog 탭 패턴 재사용.
- 빈 상태(추천 글 0개): "아직 추천 글이 없습니다" 안내.

### 탭 동작 (확정: A — 탭 이동 없음)

- 이번 단위는 카드 탭 시 이동 없음. 모바일엔 글 상세 화면이 없고, 블로그 탭도 동일하다.
- 본문 HTML은 TipTap 차트 삽입으로 **base64 PNG data URL**을 포함 → 텍스트 렌더 부적절.
  카드는 `stripHtml` 요약만 표시.
- 상세 보기는 별도 다음 단위(§7)로 둔다.

## 6. 파일 터치 리스트

| 레이어 | 파일 | 변경 |
|---|---|---|
| model | `backend/shared/models.py` (BlogPost) | `featured_at` 컬럼 |
| migration | `backend/alembic/versions/*` | additive nullable 컬럼 추가 |
| schema | `backend/apps/blog/schemas.py` | 응답 필드 + PATCH 쓰기 필드 |
| repo/service | `backend/apps/blog/crud.py` | `featured` 필터 + 정렬 |
| router | `backend/apps/blog/routers/blogs.py` | `featured` 쿼리 파라미터 |
| admin | `admin_web/src/pages/BlogListPage.jsx` | 행별 추천 토글(낙관적 업데이트 재사용) |
| mobile | `mobile/src/features/blog/api.ts` | `featured` 파라미터 + `RawBlog`/`toBlogPost`에 `featured_at` |
| mobile | `mobile/src/features/blog/types.ts` | `featuredAt` 타입 |
| mobile | `mobile/src/features/blog/*` | 추천 글 조회 훅(기존 `use-blog-list` 확장/신규) |
| mobile | `mobile/src/features/blog/blog-card.tsx` (신규) | `BlogCard` 추출 |
| mobile | `mobile/src/app/(tabs)/blog.tsx` | 추출한 `BlogCard` 사용으로 교체 |
| mobile | `mobile/src/app/(tabs)/index.tsx` | 홈 = 추천 글 리스트 |

## 7. 이번 단위에서 제외 (후속 단위 후보)

- **모바일 글 상세 화면**: `mobile/src/app/blog/[id].tsx` + WebView로 HTML(차트 포함) 렌더.
  → 이게 생기면 홈/블로그 카드 탭을 상세로 연결.
- **web_client 추천 섹션**: `web_client/src/pages/HomePage.jsx`는 현재 첫 게시판으로
  리다이렉트만 한다. 웹은 이미 글 상세(`PostDetailPage`, `/posts/:id`)와 `listBlogs`가
  있어, 홈에 추천 섹션을 얹는 것은 저비용 후속 단위.
- 추천 개수 상한/수동 정렬/테마(컬렉션) 그룹핑 — 필요해지면 확장.

## 8. 검증 관점

- 백엔드: `featured=true` 필터가 `featured_at IS NOT NULL`만 반환하고 `featured_at DESC` 정렬.
  기존 `?board_id=` / 페이지네이션 동작 불변(회귀 테스트).
- 마이그레이션: 로컬 DB에서 upgrade/downgrade 왕복 확인.
- admin: 토글 켜고 → 모바일 홈에 즉시 반영(순서 맨 위), 끄면 사라짐.
- 기존 blog 탭 카드 렌더가 추출 후에도 동일(시각 회귀 없음).

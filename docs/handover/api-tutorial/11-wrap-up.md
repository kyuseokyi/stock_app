# 11단계. 마무리 — 화면 연결, 반영 흐름, 되돌리기, 연습 과제

> 목표: 만든 API 가 실제 서비스가 되려면 무엇이 더 필요한지 알고, 실습을 깨끗이 정리하고, 혼자서 비슷한 기능을 하나 더 만들어 본다.

## 11-1. 지금까지 만든 것 (전체 지도)

| 층 | 파일 | 단계 |
|---|---|---|
| DB 테이블 | PostgreSQL `blog_bookmarks` | 2 |
| 모델 | `backend/shared/models.py` → `BlogBookmark` | 3 |
| 마이그레이션 | `backend/alembic/versions/a9b8c7d6e5f4_blog_bookmarks.py` | 4 |
| 응답 스키마 | `backend/apps/blog/bookmark_schemas.py` | 5 |
| Repository | `backend/apps/blog/repositories/bookmark_repo.py` | 6 |
| Service | `backend/apps/blog/services/bookmarks.py` | 7 |
| Router + 등록 | `backend/apps/blog/routers/bookmarks.py`, `apps/blog/main.py` | 8 |
| 테스트 | `backend/tests/test_bookmarks_api.py` | 10 |

`git status` 로 위 파일들이 모두 보이는지 확인한다(새 파일 6개 + 수정 2개).

## 11-2. 화면(웹)에 연결한다면

서버만으로는 사용자가 쓸 수 없다. web_client 기준으로 필요한 것 (실습에서는 읽기만):

1. **타입** — `web_client/src/types/api.ts` 에 5단계 스키마와 같은 모양:
   ```ts
   export interface BookmarkOut {
     id: number
     post_id: number
     post_title: string
     created_at: string
   }
   ```
2. **API 함수** — `web_client/src/api/blog.ts` (`client` 가 토큰을 자동으로 붙인다):
   ```ts
   export const addBookmark = async (blogId: Id): Promise<BookmarkOut> => {
     const { data } = await client.put<BookmarkOut>(`/blogs/${blogId}/bookmark`)
     return data
   }
   export const removeBookmark = async (blogId: Id): Promise<void> => {
     await client.delete(`/blogs/${blogId}/bookmark`)
   }
   export const listMyBookmarks = async (): Promise<BookmarkOut[]> => {
     const { data } = await client.get<BookmarkOut[]>('/me/bookmarks')
     return data
   }
   ```
   (`client` 의 baseURL 이 이미 `…/api/v1` 이라 주소 앞부분은 빠진다.)
3. **화면** — `PostDetailPage.tsx` 에 저장 버튼, `MyPage.tsx` 에 목록.
4. 앱이라면 `mobile/src/features/blog/` 에 같은 방식으로 (`comments-api.ts` 참고).

> 실제로 넣는다면, "지금 이 글을 내가 저장했는지"를 글 상세에서 알아야 버튼 상태를 그릴 수 있다. 그러려면 API 가 하나 더 필요하다 — 연습 과제 2.

## 11-3. 실제 기능으로 반영한다면 (흐름)

1. `practice/…` 가 아닌 `feature/blog-bookmarks` 브랜치에서 작업
2. `uv run pytest` 통과
3. 루트 `README.md` 스키마 요약 표에 `blog_bookmarks` 한 줄 추가 (프로젝트 규칙)
4. `dev` 에 머지 → `main` 으로 반영 ([`docs/git_workflow.md`](../../git_workflow.md))
5. `backend/**` 가 바뀌었으므로 **Deploy Server** 워크플로가 자동 실행 → 그 안에서 `alembic upgrade head` 로 개발 서버 DB 에 테이블 생성
6. `https://blog.haezean.com/docs` 에서 새 주소 확인
7. 웹 변경은 **Deploy Web**, 앱 변경은 OTA 또는 새 빌드 ([가이드 9장](../09-mobile.md))

> 서버(5)를 먼저 배포하고 화면(7)을 나중에 배포해도 안전하다. 화면이 아직 안 부르는 주소가 늘어날 뿐이다. 반대 순서는 화면이 없는 주소를 불러 404 가 난다.

## 11-4. 실습 정리 (되돌리기)

로컬 DB 에서 테이블을 지우고, 브랜치를 버린다.
```bash
cd backend
uv run alembic downgrade 8e2b4c6d1f30     # blog_bookmarks 삭제, alembic_version 되돌림
uv run alembic current                    # 8e2b4c6d1f30 확인

cd ..
git switch dev
git branch -D practice/bookmark-api       # 커밋했다면 브랜치째 삭제
# 커밋하지 않았다면 대신: git restore . && git clean -fd backend/  (새 파일 삭제 — 지울 목록을 먼저 git clean -nd 로 확인)
```
⚠️ 순서 중요: **downgrade 를 먼저** 한다. 마이그레이션 파일을 먼저 지우면 Alembic 이 "a9b8c7d6e5f4 가 뭔지 모른다"며 되돌리지 못한다.

## 11-5. 연습 과제 (혼자 해 보기)

난이도 순. 각 과제마다 1~10단계를 다시 밟는다.

**과제 1. 메모 추가 — "컬럼 추가" 마이그레이션 연습**
- 북마크에 메모(최대 200자, 선택)를 저장한다.
- 할 일: 모델에 `memo: Mapped[str | None] = mapped_column(String(200))` → **새** 마이그레이션 파일(`op.add_column`) → 요청 스키마 `BookmarkIn` (5-4) → `PUT` 이 본문을 받도록 → 응답에 `memo` 추가 → 테스트.
- 포인트: 기존 마이그레이션 파일을 고치지 않고 새 파일을 만든다. `nullable` 이라 `server_default` 없이도 된다 — 왜 그런지 설명해 본다.

**과제 2. 저장 여부 확인 API**
- `GET /api/v1/blogs/{blog_id}/bookmark` → 저장했으면 `200` + BookmarkOut, 안 했으면 `404`.
- 포인트: repository `find` 를 재사용. 서비스에 새 예외 `NotBookmarked` 를 만들지, `None` 을 돌려줄지 스스로 정하고 이유를 적는다.

**과제 3. 남의 북마크를 못 지우는지 테스트**
- 사용자 A, B 가 같은 글을 저장 → B 로 해제 → A 의 북마크는 남아 있어야 한다.
- 포인트: 10-5 에서 발견한 구멍을 메우는 테스트. `state` 로 로그인 사용자를 바꾸는 방법은 `tests/test_push_devices_api.py` 의 `api` fixture 참고.

**과제 4. 글 목록에 북마크 수 보여 주기**
- `GET /api/v1/blogs` 응답 각 글에 `bookmark_count` 추가.
- 포인트: `func.count()` + `group_by` 또는 서브쿼리. **기존 응답에 필드를 "추가"만** 하므로 웹·앱이 깨지지 않는다(5-5). 기존 테스트도 모두 통과해야 한다.

**과제 5. 동시 요청에도 500 이 안 나게**
- 7-4 의 경쟁 상황을 `IntegrityError` 처리로 막는다(`push_repo.upsert_device` 참고).

## 11-6. 다 했다면

이제 기존 코드를 읽을 때 "이건 몇 단계 층이지?" 가 바로 보일 것이다. 다음으로 읽어 볼 만한 실제 기능:
- 같은 구조의 작은 기능: `apps/blog/routers/push_devices.py` → `services/push_devices.py` → `repositories/push_repo.py`
- 더 큰 기능: `apps/blog/routers/app_versions.py` (관리자 API + 공개 API 가 함께)
- 다른 DB: 주식 데이터는 ClickHouse 라 Alembic 대신 `CREATE TABLE IF NOT EXISTS` 로 만든다 → `apps/collector/repositories/clickhouse_screener.py`

← [10. 자동 테스트](./10-test.md) · [실습 목차](./README.md) · [인수인계 가이드](../README.md)

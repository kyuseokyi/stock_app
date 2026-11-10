# 실습: API 하나를 DB 까지 직접 만들어 보기

> [인수인계 가이드](../README.md) 4장(서버)·5장(DB)·6장(API)을 읽은 뒤에 하는 **손으로 따라 하는 실습**이다.
> 이미 있는 코드를 읽는 것과, 빈 화면에서 하나를 만들어 보는 것은 이해도가 완전히 다르다.

## 무엇을 만드나 — "게시글 북마크(저장)"

로그인한 사용자가 마음에 드는 글을 **저장**해 두고, 나중에 **내가 저장한 글 목록**을 보는 기능이다.

```
PUT    /api/v1/blogs/{blog_id}/bookmark   글 저장       → 200 + 저장 정보
DELETE /api/v1/blogs/{blog_id}/bookmark   저장 해제     → 204
GET    /api/v1/me/bookmarks               내 저장 목록   → 200 + 목록
```

이 기능 하나에 실무에서 쓰는 거의 모든 층이 들어 있다: 테이블 설계, 외래키, 중복 방지, 마이그레이션, 로그인 확인, 404 처리, 조인 조회, 테스트.

## 완성되면 이렇게 연결된다

```
요청 PUT /api/v1/blogs/12/bookmark  (Authorization: Bearer 토큰)
 │
 ├─ ⑧ routers/bookmarks.py         입구: 주소·로그인 확인·HTTP 상태 코드
 ├─ ⑦ services/bookmarks.py        규칙: 글이 있나? 이미 저장했나?
 ├─ ⑥ repositories/bookmark_repo.py DB 읽기/쓰기
 ├─ ⑤ bookmark_schemas.py           응답 JSON 모양
 ├─ ③ shared/models.py BlogBookmark  파이썬으로 본 테이블
 ├─ ④ alembic/versions/…_blog_bookmarks.py   테이블을 실제로 만드는 변경 이력
 └─ ② PostgreSQL blog_bookmarks 테이블
```

**만드는 순서는 아래(DB)에서 위(입구)로** 올라간다. 아래층이 있어야 위층이 그것을 쓸 수 있기 때문이다.

## 단계

| 단계 | 문서 | 만드는 파일 | 배우는 것 |
|---|---|---|---|
| 1 | [요구사항과 API 설계](./01-design.md) | (종이 설계) | 주소·메서드·상태 코드 정하는 법 |
| 2 | [테이블 설계](./02-table-design.md) | (종이 설계) | 컬럼·타입·PK·FK·UNIQUE·인덱스 |
| 3 | [SQLAlchemy 모델](./03-model.md) | `shared/models.py` | 파이썬 클래스 = 테이블 |
| 4 | [Alembic 마이그레이션](./04-migration.md) | `alembic/versions/…_blog_bookmarks.py` | DB 에 테이블 만들기·되돌리기 |
| 5 | [응답 스키마](./05-schema.md) | `apps/blog/bookmark_schemas.py` | pydantic 으로 JSON 모양 정하기 |
| 6 | [Repository (DB 함수)](./06-repository.md) | `apps/blog/repositories/bookmark_repo.py` | select·where·join·delete·commit |
| 7 | [Service (업무 규칙)](./07-service.md) | `apps/blog/services/bookmarks.py` | 규칙을 한곳에 모으는 이유 |
| 8 | [Router (API 입구)](./08-router.md) | `apps/blog/routers/bookmarks.py`, `main.py` | 주소 등록·Depends·상태 코드 |
| 9 | [실행하고 눈으로 확인](./09-run-and-check.md) | — | Swagger·curl·DB 직접 조회 |
| 10 | [자동 테스트](./10-test.md) | `tests/test_bookmarks_api.py` | pytest 로 매번 확인하기 |
| 11 | [마무리 · 되돌리기 · 연습 과제](./11-wrap-up.md) | — | 화면 연결, 커밋·배포 흐름, 혼자 해 볼 과제 |

## 시작 전 준비

1. [가이드 2장](../02-local-setup.md) 대로 Docker DB 와 auth(8001)·blog(8000) 를 띄울 수 있는 상태.
2. **연습용 브랜치**를 만든다. 실습 코드는 실제 서비스에 넣지 않는다.
   ```bash
   git switch dev
   git switch -c practice/bookmark-api
   ```
3. `backend/.env.development` 가 **로컬 DB(5432)** 를 가리키는지 확인한다. 개발서버 터널(15432)을 가리키면 4단계 마이그레이션이 **개발서버 DB 를 바꾼다.**

## 이 실습 코드는 검증되었나

이 문서의 코드는 2026-11-09 `dev` 기준으로 실제로 파일을 만들어 테스트 5개(저장·중복 저장·해제·없는 글 404·로그인 필요 401)가 모두 통과하는 것을 확인했고, 마이그레이션은 `alembic upgrade --sql` 로 생성되는 SQL 까지 확인했다. 다만 **저장소에는 넣지 않았다**(연습용). 문서대로 따라 치면 같은 결과가 나와야 한다. 다르면 그게 공부거리다 — 에러 메시지를 읽고 원인을 찾아본다.

> 팁: 코드를 복사·붙여넣기 하지 말고 **직접 타이핑**한다. 오타로 생기는 에러를 고치는 과정이 가장 많이 배우는 시간이다.

시작: [1. 요구사항과 API 설계 →](./01-design.md)

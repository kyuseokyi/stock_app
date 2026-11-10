# 4. 서버(FastAPI) 구조 — 요청 하나가 서버 안에서 처리되는 과정

> 목표: "댓글 달기" 요청이 blog 서버 안에서 어떤 파일을 어떤 순서로 지나가는지 설명할 수 있고, 같은 방식으로 새 API 를 하나 추가할 수 있다.

## 4-1. FastAPI 란

파이썬으로 **웹 API 서버**를 만드는 프레임워크다. 함수에 `@router.get("/주소")` 를 붙이면 그 주소로 들어온 요청을 그 함수가 처리한다.
`uvicorn` 은 FastAPI 앱을 실제로 네트워크에 띄워 주는 실행기다.

```bash
uv run uvicorn apps.blog.main:app --reload --port 8000
#              └ apps/blog/main.py 의 app 변수   └ 8000 번 포트에서 대기
```

## 4-2. 서비스 하나의 폴더 구조 (blog 예시)

```
backend/apps/blog/
├── main.py            ① 시작점: FastAPI 앱 생성, CORS 설정, 라우터 등록
├── routers/           ② 주소(URL)별 입구 — 요청 받기, 권한 확인, 응답 만들기
│   ├── boards.py
│   ├── blogs.py
│   ├── comments.py
│   └── push_devices.py …
├── schemas.py         ③ 요청/응답 JSON 모양 (pydantic)
├── services/          ④ 업무 규칙(비즈니스 로직) — "이럴 땐 이렇게 한다"
├── repositories/      ⑤ DB 읽기/쓰기 전담
├── crud.py            ⑤' 초기에 만든 DB 함수 모음 (게시판·글·댓글) — repositories 와 같은 역할
└── events.py 등       기타 (Redis 알림 발행 등)

backend/shared/        모든 서비스가 같이 쓰는 것
├── models.py          DB 테이블 정의 (SQLAlchemy)
├── database.py        DB 연결(get_db)
├── auth.py            로그인 사용자 확인(get_current_user, require_admin)
├── security.py        JWT 토큰 만들기/검증
├── cors.py            어떤 웹 주소에서 호출을 허용할지
└── env.py             .env 파일 읽기
```

### 레이어 규칙 (프로젝트 규칙 — `CLAUDE.md`)

```
Router(입구)  →  Service(업무 규칙)  →  Repository(DB)
```
- **Router 에는 업무 규칙을 몰아넣지 않는다.** 요청을 받고, 서비스 함수를 부르고, 결과를 돌려주는 일만 한다.
- 좋은 예: `routers/push_devices.py` → `services/push_devices.py` → `repositories/push_repo.py`
- 오래된 게시판/댓글 코드는 `routers/` → `crud.py` 두 단계로 되어 있다(업무 규칙이 단순해서). 새로 만드는 기능은 3단계로 나눈다.

## 4-3. 실제 코드로 따라가기 — 댓글 달기

### ① `main.py` — 라우터 등록
```python
app = FastAPI(title="Stock App - Blog Service")
app.add_middleware(CORSMiddleware, allow_origins=build_allowed_origins(), ...)
app.include_router(comments.router)        # comments.py 의 주소들을 앱에 붙인다
```

### ② `routers/comments.py` — 입구
```python
router = APIRouter(prefix="/api/v1", tags=["comments"])

@router.post("/blogs/{blog_id}/comments", response_model=schemas.CommentOut, status_code=201)
async def create_comment(
    blog_id: int,                                  # URL 의 {blog_id}
    payload: schemas.CommentCreate,                # 요청 본문 JSON {"content": "..."}
    db: AsyncSession = Depends(get_db),            # DB 연결
    user: User = Depends(get_current_user),        # 로그인 사용자 (없으면 401)
):
    post = await crud.get_blog(db, blog_id)
    if post is None:
        raise HTTPException(404, "게시글을 찾을 수 없습니다.")
    board = await crud.get_board(db, post.board_id)
    if board is not None and not board.comments_enabled:
        raise HTTPException(403, "댓글이 비활성화된 게시판입니다.")
    comment = await crud.create_comment(db, post_id=blog_id, author_id=user.id, content=payload.content)
    return _to_out(comment)                        # CommentOut 모양으로 변환해 응답
```

### ③ `crud.py` — DB 저장
```python
async def create_comment(db, *, post_id, author_id, content):
    comment = BlogComment(post_id=post_id, author_id=author_id, content=content)
    db.add(comment)          # 저장할 목록에 추가
    await db.commit()        # 실제로 DB 에 반영 (commit 전엔 저장 안 됨)
    return await get_comment(db, comment.id)
```

### 정리: 요청 1건의 여정
```
POST /api/v1/blogs/12/comments  {"content":"좋은 글이네요"}  + Authorization: Bearer <토큰>
  │
  ├─ CORS 검사 (shared/cors.py)            ─ 허용 안 된 웹 주소면 브라우저가 차단
  ├─ Depends(get_db)                       ─ DB 세션 준비
  ├─ Depends(get_current_user)             ─ 토큰 검증 → User. 실패하면 여기서 401 끝
  ├─ pydantic CommentCreate 검사            ─ content 없으면 여기서 422 끝
  ├─ create_comment() 본문                  ─ 게시글 존재 404 / 댓글 허용 403 검사
  ├─ crud.create_comment()                 ─ INSERT INTO blog_comments ...
  └─ 201 Created + CommentOut JSON
```

## 4-4. 서비스별 주요 파일

| 서비스 | 시작점 | 먼저 읽을 파일 |
|---|---|---|
| auth | `apps/auth/main.py` | `routers/auth.py`(로그인·게스트·refresh·logout·me), `routers/social.py`(카카오·네이버), `services/session_login.py` |
| blog | `apps/blog/main.py` | `routers/blogs.py`, `routers/comments.py`, `routers/notifications.py`(SSE), `routers/push_admin.py` |
| stock_api | `apps/stock_api/main.py` | `graphql/schema.py`(모든 GraphQL 쿼리), `services/clickhouse_source.py`, `routers/market_admin.py` |
| trading_game | `apps/trading_game/main.py` | `routers/orders.py`, `services/order_engine.py`, `routers/ws_gateway.py`, `services/tick_listener.py` |
| ai_analyst | (stock_api 에 붙어서 실행) | `router.py`, `tasks.py`, `services/` |
| collector | `apps/collector/celery_app.py` | `tasks/market_data.py`(일일 파이프라인), `kis/fetcher.py` — [7장](./07-batch-celery.md) |

## 4-5. 헬스 체크 — 서버가 살아 있나

모든 FastAPI 서비스에 있다(`shared/health.py`).

| 주소 | 의미 |
|---|---|
| `GET /health` | 프로세스가 살아 있다 (DB 는 안 봄) |
| `GET /ready` | DB(+Redis) 까지 연결된다. 실패하면 503 |

운영에서 "사이트가 안 돼요" 하면 제일 먼저 `https://blog.haezean.com/ready` 같은 주소를 열어 본다.

## 4-6. 새 API 를 추가하는 순서 (체크리스트)

> 이 순서를 "게시글 북마크" 예제로 한 단계씩 직접 따라 하는 실습: [API 하나를 DB 까지 직접 만들기](./api-tutorial/README.md)

1. **DB 가 바뀌나?** → `shared/models.py` 수정 + Alembic 마이그레이션 ([5장](./05-database.md))
2. `schemas.py` 에 요청/응답 모양 추가
3. `repositories/` 에 DB 함수 추가
4. `services/` 에 업무 규칙 함수 추가
5. `routers/` 에 주소 추가 (새 파일이면 `main.py` 에 `include_router`)
6. `backend/tests/` 에 테스트 추가 → `uv run pytest`
7. `http://localhost:8000/docs` 에서 직접 호출해 보기
8. 웹·앱 타입(`web_client/src/types/`, `admin_web/src/types/`, `mobile/src/features/...`) 갱신
9. 루트 `README.md` 에 실행법·환경변수가 바뀌었으면 기록

> ⚠️ **기존 응답 모양을 바꾸지 않는다.** 웹·앱(특히 이미 설치된 구버전 앱)이 그 모양을 믿고 있다. 필드를 추가하는 건 안전하지만, 이름 변경·삭제는 클라이언트를 깨뜨린다.

## 4-7. 테스트

```bash
cd backend
uv run pytest                                  # 전체 (DB·네트워크 없이 돈다: sqlite·fakeredis 사용)
uv run pytest tests/test_blog_featured.py -v   # 한 파일, 자세히
uv run pytest -k comment                       # 이름에 comment 가 들어간 테스트만
```
테스트 공통 준비물은 `tests/conftest.py` 에 있다.

## 직접 해보기

1. blog 와 auth 를 켜고 `http://localhost:8000/docs` 를 연다.
2. `GET /api/v1/boards` 를 **Try it out → Execute** 해서 응답을 본다.
3. `POST /api/v1/blogs/{blog_id}/comments` 를 토큰 없이 실행 → 401 이 나오는지 확인한다. (토큰을 붙여 성공시키는 건 [6장](./06-api.md)에서.)
4. `routers/comments.py` 의 404 메시지를 바꿔 저장 → `--reload` 로 서버가 다시 뜨는지, 없는 글 번호로 호출하면 바뀐 메시지가 나오는지 확인한다(확인 후 원래대로 되돌린다).

이전: [3. 파이썬 기초](./03-python-basics.md) · 다음: [5. 데이터베이스](./05-database.md)

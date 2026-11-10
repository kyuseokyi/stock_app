# 3. 파이썬 기초 — 이 프로젝트 코드를 읽는 데 필요한 것만

> 목표: `backend/apps/blog/routers/comments.py` 를 열었을 때 모든 줄이 무슨 뜻인지 읽을 수 있다.
> 파이썬 문법 전체를 배우는 문서가 아니다. **이 프로젝트에 실제로 나오는 문법만** 실제 코드로 설명한다.

## 3-1. 파일·폴더 = 모듈·패키지

```
backend/apps/blog/routers/comments.py   →   import 할 때 이름: apps.blog.routers.comments
```
- 파이썬 파일 하나 = **모듈**, `__init__.py` 가 있는 폴더 = **패키지**.
- 그래서 실행 명령이 `uvicorn apps.blog.main:app` 이다. "`apps/blog/main.py` 안의 `app` 변수를 실행해라" 라는 뜻.
- `from .. import crud` 의 `..` 은 "한 단계 위 폴더(apps/blog)" 라는 상대 경로다.

```python
from shared.database import get_db          # backend/shared/database.py 의 get_db 함수를 가져온다
from .. import crud, schemas                 # apps/blog/crud.py, apps/blog/schemas.py
```

## 3-2. 타입 힌트 — "이 변수엔 이런 값이 들어간다" 는 메모

```python
async def list_comments(blog_id: int, db: AsyncSession = Depends(get_db)):
#                       ^^^^^^^^^^^^  blog_id 는 정수
def get_blog(db: AsyncSession, blog_id: int) -> BlogPost | None:
#                                          ^^^^^^^^^^^^^^^^^^^ 반환값은 BlogPost 이거나 None(없음)
```
- 파이썬은 타입 힌트를 지키지 않아도 실행은 된다. 하지만 **FastAPI 는 이 힌트를 읽어서** 요청 값을 검사하고 변환한다(예: URL 의 `"12"` → 정수 `12`, 숫자가 아니면 자동으로 422 에러).
- `str | None` = 문자열 또는 없음. `list[int]` = 정수 리스트. `dict` = 키-값 묶음(JSON 객체와 같다).

## 3-3. `async` / `await` — 기다리는 동안 다른 일 하기

```python
async def list_comments(blog_id: int, db: AsyncSession = Depends(get_db)):
    if await crud.get_blog(db, blog_id) is None:     # DB 응답을 기다린다
        ...
```
- DB·네트워크 응답을 기다리는 동안 서버가 멈추지 않고 **다른 요청을 처리**하도록 하는 문법이다.
- 규칙 두 가지만 기억한다.
  1. `async def` 로 만든 함수는 부를 때 앞에 **`await`** 를 붙인다.
  2. `await` 는 `async def` 함수 안에서만 쓸 수 있다.
- 이 프로젝트에서: **FastAPI 서버는 async**(`shared/database.py` 의 `AsyncSession`), **Celery 워커는 일반 동기 함수**(`SyncSessionLocal`). 같은 DB 라도 연결 방식이 두 가지인 이유다.

## 3-4. 데코레이터 `@` — 함수에 "역할"을 붙이는 스티커

```python
@router.post("/blogs/{blog_id}/comments", status_code=201)
async def create_comment(...):
```
- "이 함수는 `POST /blogs/{blog_id}/comments` 요청이 오면 실행된다" 고 등록하는 것.
- 같은 방식으로 Celery 는 `@celery_app.task(name="collector.collect_daily_ohlcv")` 로 "이 함수는 백그라운드 작업이다" 라고 등록한다.

## 3-5. `Depends` — 필요한 재료를 FastAPI 가 대신 준비

```python
async def create_comment(
    blog_id: int,
    payload: schemas.CommentCreate,
    db: AsyncSession = Depends(get_db),               # DB 연결을 하나 받아 온다
    user: User = Depends(get_current_user),           # 로그인한 사용자를 받아 온다(아니면 401)
):
```
- 함수를 직접 부르는 게 아니라, **FastAPI 가 요청마다 `get_db()`·`get_current_user()` 를 먼저 실행해서 결과를 넣어 준다.** 이것을 "의존성 주입"이라 부른다.
- `get_current_user` (`shared/auth.py`) 는 헤더의 토큰을 검사하고, 실패하면 함수 본문에 들어가기도 전에 401 에러를 돌려준다. 그래서 라우터 코드에는 로그인 검사 코드가 따로 없다.
- 관리자 전용 API 는 `Depends(require_admin)` 을 쓴다.

## 3-6. `yield` 와 `async with` — 쓰고 나면 자동으로 정리

```python
# shared/database.py
async def get_db():
    async with AsyncSessionLocal() as session:   # DB 세션을 연다
        yield session                            # 요청 처리하는 동안 빌려준다
                                                  # 요청이 끝나면 with 블록을 빠져나가며 자동으로 닫힌다
```
- `with` = "빌리고, 다 쓰면 자동 반납". 파일·DB 연결처럼 꼭 닫아야 하는 것에 쓴다.

## 3-7. pydantic — 요청/응답 모양(스키마) 정의

```python
# apps/blog/schemas.py
class CommentCreate(BaseModel):
    content: str = Field(..., description="댓글 내용")   # ... = 필수

class CommentOut(BaseModel):
    id: int
    post_id: int
    author_name: str | None = None
    content: str
    created_at: datetime
```
- `CommentCreate` = 클라이언트가 **보내야 하는** JSON 모양. `{"content": "..."}` 가 아니면 FastAPI 가 자동으로 422 에러.
- `CommentOut` = 서버가 **돌려주는** JSON 모양. 웹·앱의 타입 정의(`web_client/src/types/`, `mobile/src/features/blog/comments-api.ts`)가 이 모양과 맞아야 한다.

## 3-8. 클래스와 SQLAlchemy 모델

```python
# shared/models.py
class BlogComment(Base, TimestampMixin):         # Base·TimestampMixin 을 물려받는다(상속)
    __tablename__ = "blog_comments"              # DB 테이블 이름
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
```
- 파이썬 클래스 하나 = DB 테이블 하나, 속성 하나 = 컬럼 하나. 자세한 내용은 [5장](./05-database.md).
- `TimestampMixin` 을 물려받으면 `created_at`·`updated_at` 컬럼이 자동으로 붙는다.

## 3-9. 예외(에러) 던지기

```python
if post is None:
    raise HTTPException(status.HTTP_404_NOT_FOUND, "게시글을 찾을 수 없습니다.")
```
- `raise` 하면 함수가 그 자리에서 멈추고, FastAPI 가 `{"detail": "게시글을 찾을 수 없습니다."}` 와 404 상태로 응답한다.
- `try: ... except 에러종류: ...` 는 "에러가 나면 이렇게 처리해라" 라는 뜻이다(`shared/auth.py` 에서 토큰 만료를 잡는 부분 참고).

## 3-10. 환경변수 읽기

```python
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://stock_user:...@localhost:5432/stock_db")
#                         ↑ 이 이름의 환경변수가 있으면 그 값, 없으면 ↑ 기본값
```
- 비밀번호·API 키·서버 주소는 코드에 박지 않고 환경변수로 받는다. 로컬은 `backend/.env.development`, 운영은 서버의 `.env.production` 에서 자동으로 읽는다(`shared/env.py`).

## 3-11. 자주 쓰는 명령

```bash
cd backend
uv sync                          # pyproject.toml 기준으로 패키지 설치
uv add httpx                     # 새 패키지 추가 (pyproject.toml·uv.lock 이 같이 바뀜 → 커밋)
uv run python -m apps.auth.seed_admin   # 모듈 실행 (-m = 모듈 이름으로 실행)
uv run pytest                    # 테스트 전체 실행
uv run pytest tests/test_cors.py # 파일 하나만
```

## 직접 해보기

1. `backend/apps/blog/routers/comments.py` 를 열고, 3-2~3-9 에서 배운 문법을 각각 한 군데씩 찾아 표시한다.
2. `uv run pytest tests/test_cors.py` 를 실행해 본다. 초록 `passed` 가 나오면 개발 환경이 정상이다.
3. `uv run python` 으로 대화형 파이썬을 열고 아래를 입력해 본다.
   ```python
   from apps.blog.schemas import CommentCreate
   CommentCreate(content="안녕")          # 정상
   CommentCreate()                       # 에러 — content 는 필수
   ```

이전: [2. 로컬 실행](./02-local-setup.md) · 다음: [4. 서버(FastAPI) 구조](./04-server-fastapi.md)

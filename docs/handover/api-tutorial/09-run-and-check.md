# 9단계. 실행하고 눈으로 확인하기 — Swagger · curl · DB

> 목표: 만든 API 를 실제로 호출하고, 그 결과가 DB 에 어떻게 남는지 직접 본다. 성공뿐 아니라 실패 응답(401·404·422)도 일부러 만들어 본다.

## 9-1. 띄우기

```bash
docker compose -f docker-compose.dev.yml up -d     # DB
cd backend
uv run alembic upgrade head                        # 4단계를 아직 안 했다면
uv run uvicorn apps.auth.main:app --reload --port 8001   # 터미널 1: 로그인
uv run uvicorn apps.blog.main:app --reload --port 8000   # 터미널 2: 북마크가 있는 blog
```
blog 서버 터미널에 에러 없이 `Application startup complete.` 가 나오면 된다. import 오타가 있으면 여기서 바로 빨간 에러가 난다 — 맨 아래 줄부터 읽는다.

글이 하나도 없다면 관리자 웹(`http://localhost:5173`)에서 게시판과 글을 하나 만들거나, `uv run python -m apps.blog.seed_dev_posts` 로 예시 글을 넣는다.

## 9-2. Swagger 로 확인

1. `http://localhost:8000/docs` 를 연다. **bookmarks** 묶음에 주소 3개가 보이면 8단계 등록 성공.
2. 토큰 넣기: 같은 화면 오른쪽 위 **Authorize** → 아래 9-3 의 1)에서 받은 토큰 붙여넣기.
3. `PUT /api/v1/blogs/{blog_id}/bookmark` → Try it out → `blog_id` 에 실제 글 번호 → Execute.

## 9-3. curl 로 확인 (시나리오 전체)

```bash
# 1) 관리자 로그인 → 토큰
curl -s -X POST http://localhost:8001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@stock.app","password":"admin1234"}'
TOKEN=복사한_access_token

# 2) 글 번호 확인
curl -s "http://localhost:8000/api/v1/blogs?size=3"
POST_ID=1    # 실제 번호로

# 3) 저장 → 200 + {"id":..., "post_id":1, "post_title":"...", "created_at":"..."}
curl -s -i -X PUT http://localhost:8000/api/v1/blogs/$POST_ID/bookmark -H "Authorization: Bearer $TOKEN"

# 4) 한 번 더 저장 → 200, id 가 3)과 같아야 함 (중복 없음)
curl -s -X PUT http://localhost:8000/api/v1/blogs/$POST_ID/bookmark -H "Authorization: Bearer $TOKEN"

# 5) 내 목록
curl -s http://localhost:8000/api/v1/me/bookmarks -H "Authorization: Bearer $TOKEN"

# 6) 해제 → 204,  다시 해제 → 또 204
curl -s -i -X DELETE http://localhost:8000/api/v1/blogs/$POST_ID/bookmark -H "Authorization: Bearer $TOKEN"
```
`-i` 를 붙이면 첫 줄에 `HTTP/1.1 200 OK` 처럼 상태 코드가 보인다.

## 9-4. 실패 응답 일부러 만들기

| 시도 | 기대 응답 | 어디서 막혔나 |
|---|---|---|
| 토큰 없이 `GET /api/v1/me/bookmarks` | `401` | `get_current_user` (8단계 Depends) |
| `PUT /api/v1/blogs/999999/bookmark` | `404 {"detail":"게시글을 찾을 수 없습니다."}` | 서비스 `PostNotFound` → 라우터 변환 |
| `PUT /api/v1/blogs/abc/bookmark` | `422` | FastAPI 타입 검사 (`blog_id: int`) |
| `GET /api/v1/bookmarks` (me 빠뜨림) | `404 {"detail":"Not Found"}` | 그런 주소 없음 |

> 404 가 두 종류다. `"게시글을 찾을 수 없습니다."` 는 **우리 코드**가 낸 것, `"Not Found"` 는 **주소 자체가 없어서** FastAPI 가 낸 것이다. 에러를 볼 때 `detail` 문구로 구분한다.

## 9-5. DB 에서 직접 보기

저장한 상태에서 DataGrip 또는 psql:
```sql
-- 방금 저장한 행
SELECT * FROM blog_bookmarks ORDER BY id DESC LIMIT 5;

-- API 의 목록과 같은 결과가 나오는지 (6단계 SQL)
SELECT b.id, b.post_id, p.title, b.created_at
FROM blog_bookmarks b JOIN blog_posts p ON p.id = b.post_id
WHERE b.user_id = 1
ORDER BY b.created_at DESC, b.id DESC;

-- UNIQUE 가 정말 막는지 (에러가 나야 정상)
INSERT INTO blog_bookmarks (user_id, post_id) VALUES (1, 1);
INSERT INTO blog_bookmarks (user_id, post_id) VALUES (1, 1);   -- duplicate key value violates unique constraint

-- CASCADE 확인: 연습용 글을 지우면 북마크도 사라지는지 (실제 글로 하지 말 것)
```
psql 접속: `psql "postgresql://stock_user:stock_password@localhost:5432/stock_db"`

## 9-6. 서버 로그 읽기

blog 서버 터미널에는 요청마다 한 줄씩 남는다.
```
INFO:     127.0.0.1:52344 - "PUT /api/v1/blogs/1/bookmark HTTP/1.1" 200 OK
INFO:     127.0.0.1:52350 - "GET /api/v1/me/bookmarks HTTP/1.1" 401 Unauthorized
```
500 이 나면 그 바로 위에 파이썬 에러(Traceback)가 찍힌다. **맨 아래 줄**(에러 종류와 메시지)과 **우리 파일 이름이 나오는 줄**을 먼저 본다.

## 체크

- [ ] 9-3 시나리오 6단계를 모두 실행했다.
- [ ] 9-4 의 실패 4가지를 직접 만들어 봤다.
- [ ] API 응답과 DB 조회 결과가 같은 것을 확인했다.

← [8. Router](./08-router.md) · 다음: [10. 자동 테스트 →](./10-test.md)

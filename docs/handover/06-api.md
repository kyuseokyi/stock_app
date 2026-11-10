# 6. API — 화면과 서버가 대화하는 방법

> 목표: REST·GraphQL·WebSocket·SSE 가 각각 무엇이고 이 프로젝트 어디에 쓰이는지 알고, `curl` 로 로그인 → 댓글 작성 → 차트 조회를 직접 해 본다.

## 6-1. API 란

화면(웹·앱)이 서버에게 "이거 줘 / 이거 저장해" 라고 요청하는 **약속된 형식**이다.
이 프로젝트는 네 가지 방식을 쓴다.

| 방식 | 비유 | 이 프로젝트에서 | 서비스 |
|---|---|---|---|
| **REST** | 주소마다 정해진 창구 | 로그인, 게시판·글·댓글, 게임 주문, 관리자 기능 대부분 | auth, blog, trading_game, stock_api(관리자) |
| **GraphQL** | 주소는 하나, 원하는 항목을 골라 주문 | 종목 검색, 차트, 스크리너, 시장 개요 | stock_api `/graphql` |
| **WebSocket** | 계속 열려 있는 전화선(양방향) | 게임 실시간 시세·손익·랭킹 | trading_game `/ws/game/stream` |
| **SSE** | 서버가 일방적으로 보내는 방송 | 새 글 알림 토스트 | blog `/api/v1/notifications/stream` |

## 6-2. REST 기초

```
POST  /api/v1/blogs/12/comments        ← 메서드 + 주소(경로)
Authorization: Bearer eyJhbGci...      ← 헤더 (누가 보내는지)
Content-Type: application/json
{"content": "좋은 글이네요"}             ← 본문(body)
```

| 메서드 | 뜻 | 예 |
|---|---|---|
| `GET` | 조회 | `GET /api/v1/boards` |
| `POST` | 새로 만들기 | `POST /api/v1/blogs/12/comments` |
| `PUT` | 바꾸기(통째로) | `PUT /api/v1/comments/5` |
| `DELETE` | 지우기 | `DELETE /api/v1/comments/5` |

### 상태 코드 (응답 숫자) — 에러를 볼 때 제일 먼저 확인

| 코드 | 뜻 | 이 프로젝트에서 흔한 원인 |
|---|---|---|
| 200 / 201 / 204 | 성공 / 만들어짐 / 성공(본문 없음) | |
| 400 | 요청이 규칙에 안 맞음 | 탈퇴 확인 문구 불일치 등 |
| **401** | 로그인 필요·토큰 문제 | 토큰 없음, 만료(`TOKEN_EXPIRED`), 다른 기기 로그인(`SESSION_REPLACED`) |
| **403** | 로그인은 됐지만 권한 없음 | 관리자 전용 API, 남의 댓글 수정, 댓글 꺼진 게시판 |
| 404 | 없음 | 없는 글 번호, 꺼진 기능(게스트 로그인 비활성 등) |
| 409 | 지금 상태로는 불가 | 게임: 거래 시간이 아님, 시세가 오래됨 |
| **422** | 요청 JSON 모양이 틀림 | 필수 필드 누락, 타입 틀림 (pydantic 이 자동으로 냄) |
| 500 | 서버 코드 에러 | 서버 로그를 봐야 한다 |
| 502 / 503 / 504 | 서버가 꺼졌거나 준비 안 됨 | 배포 중, 컨테이너 다운, `/ready` 실패 |

## 6-3. 로그인과 JWT 토큰

### 흐름
```
1) 로그인     POST auth /api/v1/auth/login  {"email","password"}     (관리자)
              POST auth /api/v1/auth/guest  {"nickname","platform"}   (개발용 게스트)
              카카오·네이버: GET /api/v1/auth/social/{kakao|naver}/start → … → POST /api/v1/auth/social/exchange
   응답       {"access_token": "eyJ...", "token_type": "bearer", "user": {...}, "refresh_token": (앱만), "expires_in": (앱만)}

2) 이후 요청  모든 서비스에 헤더  Authorization: Bearer eyJ...
3) 각 서비스  shared/auth.py get_current_user 가 토큰을 검증 → users 테이블에서 사용자 확인
```

### JWT 가 뭔가
- 서버가 서명한 **출입증**이다. 안에 사용자 번호(`sub`), 권한(`role`), 세션 id(`sid`), 만료 시각이 들어 있다.
- 서명 키 `JWT_SECRET_KEY` 가 **auth·blog·stock_api·trading_game 모두 같아야** 한 서비스에서 받은 토큰을 다른 서비스가 믿는다. 이 값이 서비스마다 다르면 로그인은 되는데 다른 API 가 전부 401 이 난다.
- 수명: 웹·관리자 12시간(`JWT_EXPIRE_HOURS`), 앱 60분 + 리프레시 토큰 30일(`POST /api/v1/auth/refresh` 로 갱신).
- **플랫폼별 단일 세션**: 같은 계정은 web·app·admin 마다 마지막 로그인 1곳만 유효하다. 다른 기기에서 로그인하면 이전 기기는 401 `SESSION_REPLACED`.

## 6-4. 주요 REST 주소 지도

> 정확한 전체 목록은 각 서비스를 켜고 **`/docs`** (Swagger) 를 보는 게 가장 정확하다.

| 서비스 (로컬) | 주소 | 설명 | 로그인 |
|---|---|---|---|
| auth `:8001` | `POST /api/v1/auth/login` | 관리자 로그인 | — |
| | `POST /api/v1/auth/guest` | 게스트(개발용, `AUTH_GUEST_ENABLED`) | — |
| | `GET /api/v1/auth/me` / `DELETE /api/v1/auth/me` | 내 정보 / 탈퇴 | 필요 |
| | `POST /api/v1/auth/refresh`, `/logout` | 앱 토큰 갱신·로그아웃 | — |
| blog `:8000` | `GET /api/v1/boards` | 게시판 목록 | — |
| | `GET /api/v1/blogs?board_id=&featured=` | 글 목록 | — |
| | `GET/POST /api/v1/blogs/{id}/comments` | 댓글 목록 / 작성 | 작성은 필요 |
| | `PUT/DELETE /api/v1/comments/{id}` | 댓글 수정·삭제 (본인·관리자) | 필요 |
| | `GET /api/v1/notifications/stream` | SSE 실시간 알림 | — |
| | `PUT /api/v1/push-devices` | 앱 푸시 토큰 등록 | 필요 |
| | `/api/v1/admin/fund-notices`, `push-sends`, `push-templates` | 관리자 푸시 | 관리자 |
| stock_api `:8002` | `POST /graphql` | 종목·차트·스크리너·시장 (GraphQL) | — |
| | `/api/v1/admin/market/...` | 데이터 현황·검증·작업 실행 | 관리자 |
| trading_game `:8003` | `/api/game/...` | 시즌·주문·포지션·랭킹·퀘스트·퀴즈 | 대부분 필요 |
| | `ws://…/ws/game/stream?token=` | 실시간 WebSocket | 선택 |

## 6-5. GraphQL (stock_api)

주소는 `POST /graphql` 하나. 본문에 "무엇을, 어떤 항목만" 받을지 적는다. 파이썬 코드의 `snake_case` 이름이 GraphQL 에선 자동으로 `camelCase` 가 된다(`get_chart_data` → `getChartData`).

```graphql
query {
  searchStocks(query: "삼성") { symbol name market }
}

query {
  getChartData(symbol: "005930", startDate: "2026-09-01", endDate: "2026-11-04") {
    name
    candles { date open high low close volume }
    ma20
  }
}
```
- 쿼리 정의: `backend/apps/stock_api/graphql/schema.py`, 응답 타입: `graphql/types.py`.
- 브라우저에서 `http://localhost:8002/graphql` 을 열면 GraphiQL 화면에서 바로 쿼리를 쳐 볼 수 있다.
- 차트 데이터는 ClickHouse `daily_prices FINAL` 에서 읽는다(`services/clickhouse_source.py`). 수집된 데이터가 없는 종목은 가짜(시드) 캔들이 나온다 — 로컬에서 그래프가 보여도 실데이터가 아닐 수 있다.

## 6-6. 실시간: WebSocket 과 SSE

**게임 실시간 시세 흐름**
```
KIS 실시간 체결 ─▶ run_game_ws(수집 데몬) ─▶ Redis "stock:tick:{종목}" ─▶ trading_game(리더 1개가 구독)
   ─▶ 자동청산 검사 + 0.25초마다 최신 틱 묶어서 ─▶ WebSocket ─▶ 웹·앱 게임 화면
```
- 토큰 없이 연결하면 공개 연결(시세만), 토큰이 있으면 개인 손익까지. 잘못된 토큰은 종료 코드 4401.

**새 글 알림(SSE) 흐름**
```
관리자 글 작성 ─▶ blog 서버가 Redis 에 발행 ─▶ /api/v1/notifications/stream 에 연결된 웹 브라우저들 ─▶ 토스트
```

## 6-7. CORS — "브라우저가 막았어요"

웹 브라우저는 **다른 주소의 서버를 부를 때** 그 서버가 허락한 주소인지 확인한다. 허락 목록은 `backend/shared/cors.py` (+ 환경변수 `CORS_ORIGINS`).
- 증상: 브라우저 콘솔에 `blocked by CORS policy`. `curl` 이나 앱에서는 잘 되는데 웹에서만 안 된다.
- web_client 는 운영에서 같은 도메인 프록시(`app.haezean.com/_api/...`)를 써서 CORS 를 피한다(카카오톡 인앱 브라우저 문제 때문 — [8장](./08-web.md)).

## 직접 해보기 (`curl`)

auth(8001)·blog(8000)·stock_api(8002) 를 켠 상태에서:

```bash
# 1) 관리자 로그인 → 토큰 받기
curl -s -X POST http://localhost:8001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@stock.app","password":"admin1234"}'
# 응답의 access_token 값을 복사해 둔다
TOKEN=여기에_붙여넣기

# 2) 내 정보
curl -s http://localhost:8001/api/v1/auth/me -H "Authorization: Bearer $TOKEN"

# 3) 글 목록 → 글 번호 하나 고르기
curl -s "http://localhost:8000/api/v1/blogs"

# 4) 댓글 작성 (12 를 실제 글 번호로)
curl -s -X POST http://localhost:8000/api/v1/blogs/12/comments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"curl 로 단 댓글"}'

# 5) 토큰 없이 다시 → 401 확인,  content 빼고 → 422 확인

# 6) GraphQL
curl -s -X POST http://localhost:8002/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ searchStocks(query: \"삼성\") { symbol name market } }"}'
```

> Postman 을 쓰고 있다면 위 요청을 컬렉션으로 저장해 두면 편하다.

이전: [5. 데이터베이스](./05-database.md) · 다음: [7. 배치 작업 (Celery)](./07-batch-celery.md)

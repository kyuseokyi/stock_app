# Stock App Project

한국투자증권 API 기반 주식 데이터 파이프라인 + 블로그/커뮤니티 + 관리자 웹/모바일을 포함하는 풀스택 모노레포입니다. 백엔드는 **용도별 독립 마이크로서비스(`backend/apps/`)** 로 구성되며, 로컬은 각 서비스를 개별 포트로 실행하고 운영은 Nginx 리버스 프록시로 통합합니다.

## 📂 구조

```
backend/
├── apps/
│   ├── auth/        # 인증 서비스 — 로그인/JWT 발급·검증, 관리자 시드   (포트 8001)
│   ├── blog/        # 블로그 서비스 — 게시판/게시글/댓글 CRUD, SSE 알림 (포트 8000)
│   ├── stock_api/   # 주식 API 서비스 — GraphQL 종목검색/차트(온더플라이) (포트 8002)
│   └── collector/   # 수집·알림 워커 (Celery) — 새 글 FCM 푸시(Mock)
├── shared/          # 공통 DB 모델·세션·JWT 검증·보안
└── alembic/         # DB 마이그레이션
admin_web/           # 관리자 웹 (React + Vite + TailwindCSS)             (포트 5173)
web_client/          # 일반 유저 웹 (React + Vite + Tailwind + Zustand)   (포트 3000)
docs/                # 아키텍처·기획·프롬프트 문서
docker-compose.dev.yml
```

## 🚀 로컬 개발 환경 셋업 (Windows & macOS 공통)

DB 인프라는 **Docker Named Volumes** 기반으로 OS 간 권한/성능 이슈 없이 동작합니다.

### 1. 인프라 구동 (PostgreSQL / ClickHouse / Redis)
```bash
docker-compose -f docker-compose.dev.yml up -d
```

### 2. 백엔드 (FastAPI / Celery) — `uv` 사용
```bash
cd backend
uv sync                                   # 의존성 동기화
uv run alembic upgrade head               # PostgreSQL 스키마 마이그레이션
uv run python -m shared.clickhouse_schema # ClickHouse 스키마 생성(daily_prices/fundamentals, 멱등)
uv run python -m apps.auth.seed_admin     # 관리자 시드 (최초 1회)

# 각 서비스는 개별 포트로 실행 (필요한 것만 띄우면 됩니다)
uv run uvicorn apps.auth.main:app      --reload --port 8001   # 인증(로그인)
uv run uvicorn apps.blog.main:app      --reload --port 8000   # 블로그(게시판/글/댓글/SSE)
uv run uvicorn apps.stock_api.main:app --reload --port 8002   # 주식 API(GraphQL /graphql)

# 데이터 수집/알림 워커 (Celery)
uv run celery -A apps.collector.celery_app worker --loglevel=info
uv run celery -A apps.collector.celery_app beat   --loglevel=info   # 스케줄러(매일 20:30 전종목 수집)

# 국내 주식 데이터 수집 — 수동 트리거 (워커 실행 중일 때)
# 전종목 일봉(겹침창) 수집:      collector.collect_all_daily
# 전종목 장기 백필(청킹):        collector.backfill_all_daily  (months=14)
# 단일 종목:                     collector.collect_daily_ohlcv / collector.backfill_domestic_daily
# 예) 워커 없이 즉시 실행:
uv run python -c "from apps.collector.tasks.universe import collect_all_daily; print(collect_all_daily(source='mst'))"
# 종목 마스터 소스: STOCK_MASTER_SOURCE=mst(전종목·.mst) | fallback(대형주 20) | auto(기본: mst→실패시 fallback)
# KIS 초당 호출 제한: KIS_RATE_PER_SEC(기본 8)
```
> ⚠️ 관리자 웹 로그인은 **auth(8001)**, 게시판/글/댓글은 **blog(8000)** 을 사용합니다. 어드민을 테스트하려면 **두 서비스를 모두** 띄워야 합니다.

기본 관리자 계정: `admin@stock.app` / `admin1234`

### 3. 관리자 웹 (React + Vite)
```bash
cd admin_web
npm install
npm run dev        # http://localhost:5173
```

### 4. 일반 유저 웹 (web_client)
일반 사용자(B2C)용 반응형 웹. 블로그/커뮤니티 조회 + SSE 실시간 알림 + **임시 로그인(닉네임)으로 댓글 작성**.
> 임시 로그인은 auth 서비스의 `POST /api/v1/auth/guest`(닉네임→FREE 유저 발급)를 사용합니다. 카카오/구글 OAuth는 추후 동일 토큰 경로로 교체 예정. 댓글 작성 테스트에는 auth(8001)도 함께 띄워야 합니다.
```bash
cd web_client
npm install
npm run dev        # http://localhost:3000
```
> blog 서비스(8000)만 있으면 조회가 동작합니다. (`VITE_API_BASE_URL` 로 API 주소 오버라이드)

## 🔄 작업 재개(Resume) 가이드 & 환경 점검

작업을 중단했다가 다시 시작할 때, **DB 인프라(Docker)** 는 재부팅 전까지 계속 떠 있지만 **앱 서비스(FastAPI/Celery/Vite)** 는 종료되므로 다시 띄워야 합니다.

> 📌 **가상환경 참고**: 백엔드는 `uv` 가 `backend/.venv` 를 자동 관리합니다. `uv run ...` 만 쓰면 되고 **별도 conda 활성화는 필요 없습니다.** (전역 규칙상 conda를 쓰고 싶다면 `stock_app` env를 먼저 생성해 사용하세요.)

### 0. 사전 준비물 (최초 1회)
- **Docker Desktop** (DB 인프라), **uv** (백엔드 파이썬), **Node.js 18+** (프론트)

### 1. 현재 상태 점검 (무엇이 켜져 있나)
```bash
# DB 인프라(도커) 상태 — postgres/redis/clickhouse 가 healthy 인지
docker compose -f docker-compose.dev.yml ps

# 앱 서비스 포트 점유 확인 (● 떠 있으면 실행 중)
for p in 8001 8000 8002 5173 3000; do lsof -ti:$p >/dev/null 2>&1 && echo "$p ●실행중" || echo "$p ○정지"; done
# 8001 auth · 8000 blog · 8002 stock_api · 5173 admin_web · 3000 web_client

# Celery 워커
pgrep -fl "celery.*worker" || echo "celery ○정지"
```

### 2. 최소 기동 순서 (매번)
```bash
# (1) DB 인프라가 내려가 있으면 먼저 올린다 (재부팅 후엔 항상 필요)
docker compose -f docker-compose.dev.yml up -d

# (2) 백엔드 서비스 — 필요한 것만. 각 명령은 별도 터미널/백그라운드로 실행
cd backend
uv run uvicorn apps.auth.main:app      --reload --port 8001   # 로그인/JWT
uv run uvicorn apps.blog.main:app      --reload --port 8000   # 게시판/글/댓글/SSE
uv run uvicorn apps.stock_api.main:app --reload --port 8002   # 주식 GraphQL(차트/종목)
uv run celery -A apps.collector.celery_app worker --loglevel=info   # 알림 워커(선택)

# (3) 프론트 — 필요한 것만
cd ../admin_web  && npm run dev   # 관리자 5173  (auth 8001 + blog 8000 + stock_api 8002 필요)
cd ../web_client && npm run dev   # 유저웹 3000  (blog 8000 + 댓글작성 시 auth 8001)
```

### 3. 기능별 "무엇을 띄워야 하나"
| 하고 싶은 것 | 필요한 서비스 |
|---|---|
| 관리자 로그인 + 게시판/글/댓글 관리 | Docker(postgres) + auth(8001) + blog(8000) + admin_web(5173) |
| 어드민 차트 삽입(종목검색/드로잉) | 위 + stock_api(8002) |
| 유저 웹 블로그 조회 | Docker(postgres) + blog(8000) + web_client(3000) |
| 유저 웹 임시 로그인 + 댓글 작성 | 위 + auth(8001) |
| 새 글 실시간 알림(SSE)·푸시(Mock) | 위 + Redis(도커) + celery worker |

### 4. 마이그레이션/시드 (스키마·계정 변경 시에만)
```bash
cd backend
uv run alembic upgrade head             # PostgreSQL 모델 변경 후 스키마 반영
uv run python -m shared.clickhouse_schema  # ClickHouse 테이블 (없으면 생성, 멱등)
uv run python -m apps.auth.seed_admin   # 관리자 계정 없을 때 (admin@stock.app / admin1234)
```

### 5. 종료
```bash
# 앱 서비스만 정리 (포트 kill)
for p in 8001 8000 8002 5173 3000; do lsof -ti:$p | xargs kill -9 2>/dev/null; done
pkill -f "celery.*worker"

docker compose -f docker-compose.dev.yml stop   # DB 인프라 정지(데이터 유지)
# docker compose -f docker-compose.dev.yml down  # 컨테이너 제거(볼륨은 유지 → 데이터 보존)
```
> 데이터(볼륨 `pg_data`/`clickhouse_data`/`redis_data`)는 `down` 해도 유지됩니다. 완전 초기화는 `down -v`.

## 🗄️ 로컬 DB 접속 정보

`docker-compose.dev.yml` 기준값입니다. 앱은 아래를 기본값으로 자동 사용하며, DataGrip/DBeaver 등 GUI 툴로 직접 붙을 때도 동일하게 입력합니다.

| DB | Host | Port | User | Password | Database |
|---|---|---|---|---|---|
| **PostgreSQL** | localhost | `5432` | `stock_user` | `stock_password` | `stock_db` |
| **ClickHouse** | localhost | `8123`(HTTP) / `9000`(Native) | `default` | `password` | `stock_data` |
| **Redis** | localhost | `6379` | — | (없음) | `0` |

> **GUI 툴(DataGrip/DBeaver) 접속 팁**
> - **PostgreSQL**: 기본 PostgreSQL 드라이버로 위 값 그대로. URL: `jdbc:postgresql://localhost:5432/stock_db`
> - **ClickHouse**: **HTTP 8123** + ClickHouse 드라이버 **0.6.3 이상** 권장(구버전은 서버 24.8과 호환 문제 발생). URL: `jdbc:clickhouse://localhost:8123/stock_data`
> - 조회 시 최신 1행 보장은 `... FINAL` 사용: `SELECT * FROM stock_data.daily_prices FINAL WHERE ticker='005930' ORDER BY date`
> - ⚠️ 위 값은 **로컬 개발용**입니다. 운영 배포 시 비밀번호를 반드시 변경하세요.

### 스키마 요약

**PostgreSQL (`stock_db`) — 관계형** · 스키마는 Alembic 관리(`backend/alembic/`)

| 테이블 | 용도 | 주요 컬럼 |
|---|---|---|
| `users` | 사용자(관리자·게스트·소셜) | email, nickname, provider, provider_id, role, is_active, password_hash, fcm_token |
| `boards` | 게시판 | name, order_index, is_active, min_role_required, comments_enabled |
| `blog_posts` | 게시글 | board_id, author_id, title, content, thumbnail_url, view_count |
| `blog_comments` | 댓글 | post_id, author_id, content |
| `push_templates` | 푸시 알림 템플릿 | title, body, last_sent_at |
| `stock_meta` | 종목 메타(마스터) | ticker, name, market, is_active |
| `alembic_version` | 마이그레이션 버전(Alembic 자동) | version_num |

**ClickHouse (`stock_data`) — 시계열** · 스키마는 `shared/clickhouse_schema.py`

| 테이블 | 엔진 | 용도 |
|---|---|---|
| `daily_prices` | `ReplacingMergeTree(ingested_at)` | 일봉 OHLCV + MA5/20/50/120 (조회 `FINAL`) |
| `fundamentals` | `MergeTree` | 재무지표(PER/PBR/ROE 등) — Phase 1-b 연동 예정 |

## ⚙️ 주요 환경변수

| 변수 | 대상 | 기본값 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | backend | `postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_db` | 비동기 DB(API) |
| `SYNC_DATABASE_URL` | collector | `postgresql+psycopg2://...` | 동기 DB(Celery) |
| `REDIS_URL` | backend | `redis://localhost:6379/0` | Celery 브로커 & SSE pub/sub |
| `CLICKHOUSE_HOST` / `CLICKHOUSE_PORT` | backend | `localhost` / `8123` | ClickHouse 호스트·HTTP 포트 |
| `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` | backend | `default` / `password` | ClickHouse 인증 |
| `CLICKHOUSE_DB` | backend | `stock_data` | 주가 시계열 DB |
| `JWT_SECRET_KEY` | auth·blog | `dev-insecure-secret-change-me` | JWT 서명 키 (**서비스 간 동일값 필수**, 운영 필수 설정) |
| `PUSH_BACKEND` | collector | `mock` | `mock` \| `fcm` (FCM은 자격증명 준비 후) |
| `CORS_ORIGINS` | backend | (localhost 기본 허용) | 콤마 구분 추가 오리진 |
| `VITE_API_BASE_URL` | admin_web | `http://localhost:8000/api/v1` | 블로그 API |
| `VITE_AUTH_BASE_URL` | admin_web | `http://localhost:8001/api/v1` | 인증 API |
| `VITE_STOCK_API_URL` | admin_web | `http://localhost:8002/graphql` | 주식 API(GraphQL) — 차트 삽입 종목검색/차트 |
| `VITE_AUTH_BASE_URL` | web_client | `http://localhost:8001/api/v1` | 인증 API — 임시 로그인(닉네임) |
| `KIS_MODE` | collector | `vps` | KIS 접속 모드 — `vps`(모의투자) \| `prod`(실서버) |
| `KIS_APP_KEY` / `KIS_APP_SECRET` | collector | (빈값) | KIS OpenAPI 앱키/시크릿 (비우면 Mock 수집 폴백) |
| `STOCK_MASTER_SOURCE` | collector | `auto` | 전종목 마스터 소스 — `mst`(.mst 전종목) \| `fallback`(대형주 20) \| `auto`(mst→실패시 fallback) |
| `KIS_RATE_PER_SEC` | collector | `8` | 전종목 수집 시 KIS 초당 호출 상한(실전 ~20 한도 내 보수적) |
| `KIS_ACCOUNT_NO` | collector | (빈값) | 계좌번호(시세조회만이면 생략 가능) |

> 백엔드는 `shared` 로드 시 `APP_ENV`(기본 `development`)에 따라 `backend/.env.{APP_ENV}` → `backend/.env` 를 자동 로드합니다. 템플릿은 `backend/.env.example`.

### 🔑 한국투자증권(KIS) 설정 (Phase 1 데이터 파이프라인)
```bash
cd backend
cp .env.example .env.development     # 템플릿 복사 (.env.* 는 git 무시)
# .env.development 를 열어 아래를 채웁니다:
#   KIS_MODE=vps          # 먼저 모의투자(sandbox)로 안전하게 테스트
#   KIS_APP_KEY=...        # https://apiportal.koreainvestment.com 에서 발급
#   KIS_APP_SECRET=...
#   KIS_ACCOUNT_NO=...     # 계좌번호(예: 12345678-01) — 시세조회만이면 생략 가능
```
- **앱키가 없으면** 수집기는 Mock 데이터로 폴백하므로 키 없이도 구조 개발이 가능합니다.
- `KIS_MODE=vps`(모의투자) → BASE `openapivts...:29443`, `prod` → `openapi...:9443` 로 자동 전환됩니다.

### 📊 최초 주식 데이터 적재 (KIS 설정 후, 최초 1회)
ClickHouse는 처음엔 비어 있어 `stock_api`가 온더플라이(가짜) 차트를 보여줍니다. 실데이터로 채우려면:
```bash
cd backend
# 전종목 14개월 백필 — 워커 없이 즉시 실행(약 1시간). 비-NXT 종목은 UN→J 폴백.
uv run python -c "from apps.collector.tasks.universe import backfill_all_daily; print(backfill_all_daily(months=14))"
```
- 이후 매일 20:30 `beat`이 `collect_all_daily`로 자동 갱신합니다.
- **이미 백업본이 있으면** 재수집(~1시간) 대신 복원이 빠릅니다 → `docs/deployment/clickhouse-backup.md`.
- 빠른 확인만 원하면 대형주 몇 종목만: `... backfill_domestic_daily('005930', months=14)`.

## 🔔 알림 아키텍처
- **웹(SSE)**: 블로그 서비스의 `GET /api/v1/notifications/stream` 에 EventSource 로 연결 → 새 글 작성 시 Redis pub/sub 로 즉시 토스트 알림.
- **모바일(FCM)**: 새 글 작성 시 Celery 워커로 위임(`collector.send_new_post_notification`) → 대상 유저에게 푸시. 현재 발송기는 Mock(로그), `PUSH_BACKEND=fcm` + 자격증명으로 교체 예정.

## 🛠 데이터 스토어
- **PostgreSQL**: 사용자·게시판·게시글·댓글 등 관계형 데이터
- **ClickHouse**: 주식 시계열/보조지표 — `daily_prices`(`ReplacingMergeTree(ingested_at)`, 멱등 적재·조회 FINAL), `fundamentals`
- **Redis**: Celery 브로커 + SSE pub/sub + 캐시

## 📚 문서
- 아키텍처: `docs/architecture_plan.md`
- AMS 참고 분석: `docs/ams-reference/`
- 기능별 프롬프트: `docs/prompts/`

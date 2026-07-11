# Stock App Project

한국투자증권 API 기반 주식 데이터 파이프라인 + 블로그/커뮤니티 + 관리자 웹/모바일을 포함하는 풀스택 모노레포입니다. 백엔드는 **용도별 독립 마이크로서비스(`backend/apps/`)** 로 구성되며, 로컬은 각 서비스를 개별 포트로 실행하고 운영은 Nginx 리버스 프록시로 통합합니다.

## 📂 구조

```
backend/
├── apps/
│   ├── auth/        # 인증 서비스 — 로그인/JWT 발급·검증, 관리자 시드   (포트 8001)
│   ├── blog/        # 블로그 서비스 — 게시판/게시글/댓글 CRUD, SSE 알림 (포트 8000)
│   ├── stock_api/   # 주식 API 서비스 — 스크리너/차트 (스켈레톤)         (포트 8002)
│   └── collector/   # 수집·알림 워커 (Celery) — 새 글 FCM 푸시(Mock)
├── shared/          # 공통 DB 모델·세션·JWT 검증·보안
└── alembic/         # DB 마이그레이션
admin_web/           # 관리자 웹 (React + Vite + TailwindCSS)             (포트 5173)
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
uv run alembic upgrade head               # DB 스키마 마이그레이션
uv run python -m apps.auth.seed_admin     # 관리자 시드 (최초 1회)

# 각 서비스는 개별 포트로 실행 (필요한 것만 띄우면 됩니다)
uv run uvicorn apps.auth.main:app      --reload --port 8001   # 인증(로그인)
uv run uvicorn apps.blog.main:app      --reload --port 8000   # 블로그(게시판/글/댓글/SSE)
uv run uvicorn apps.stock_api.main:app --reload --port 8002   # 주식 API(스켈레톤)

# 데이터 수집/알림 워커 (Celery)
uv run celery -A apps.collector.celery_app worker --loglevel=info
uv run celery -A apps.collector.celery_app beat   --loglevel=info   # 스케줄러
```
> ⚠️ 관리자 웹 로그인은 **auth(8001)**, 게시판/글/댓글은 **blog(8000)** 을 사용합니다. 어드민을 테스트하려면 **두 서비스를 모두** 띄워야 합니다.

기본 관리자 계정: `admin@stock.app` / `admin1234`

### 3. 관리자 웹 (React + Vite)
```bash
cd admin_web
npm install
npm run dev        # http://localhost:5173
```

## ⚙️ 주요 환경변수

| 변수 | 대상 | 기본값 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | backend | `postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_db` | 비동기 DB(API) |
| `SYNC_DATABASE_URL` | collector | `postgresql+psycopg2://...` | 동기 DB(Celery) |
| `REDIS_URL` | backend | `redis://localhost:6379/0` | Celery 브로커 & SSE pub/sub |
| `JWT_SECRET_KEY` | auth·blog | `dev-insecure-secret-change-me` | JWT 서명 키 (**서비스 간 동일값 필수**, 운영 필수 설정) |
| `PUSH_BACKEND` | collector | `mock` | `mock` \| `fcm` (FCM은 자격증명 준비 후) |
| `CORS_ORIGINS` | backend | (localhost 기본 허용) | 콤마 구분 추가 오리진 |
| `VITE_API_BASE_URL` | admin_web | `http://localhost:8000/api/v1` | 블로그 API |
| `VITE_AUTH_BASE_URL` | admin_web | `http://localhost:8001/api/v1` | 인증 API |

## 🔔 알림 아키텍처
- **웹(SSE)**: 블로그 서비스의 `GET /api/v1/notifications/stream` 에 EventSource 로 연결 → 새 글 작성 시 Redis pub/sub 로 즉시 토스트 알림.
- **모바일(FCM)**: 새 글 작성 시 Celery 워커로 위임(`collector.send_new_post_notification`) → 대상 유저에게 푸시. 현재 발송기는 Mock(로그), `PUSH_BACKEND=fcm` + 자격증명으로 교체 예정.

## 🛠 데이터 스토어
- **PostgreSQL**: 사용자·게시판·게시글·댓글 등 관계형 데이터
- **ClickHouse**: 주식 시계열/보조지표 (파티셔닝, `ReplacingMergeTree` 예정)
- **Redis**: Celery 브로커 + SSE pub/sub + 캐시

## 📚 문서
- 아키텍처: `docs/architecture_plan.md`
- AMS 참고 분석: `docs/ams-reference/`
- 기능별 프롬프트: `docs/prompts/`

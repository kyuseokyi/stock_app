# 실행 & 배포 가이드 (Run & Deploy)

일상 운영 **빠른 참조**. 로컬에서 앱을 어떻게 띄우고, 서버(미니PC)에 어떻게 배포하는지 한 곳에 모았다.

> **더 깊은 문서**
> - 로컬 상세(포트·기능별 조합·DB 접속정보): [`../README.md`](../README.md)
> - 서버 **최초 1회** 부트스트랩(러너 등록·시크릿·Cloudflare·스키마): [`server_setup.md`](./server_setup.md)
> - SSH 터널(cloudflared·Termius): [`cloudflare_termius_guide.md`](./cloudflare_termius_guide.md)
> - 아키텍처 제약: [`claude_system_context.md`](./claude_system_context.md)

---

## A. 로컬 개발 실행

### 0. 준비물
Docker Desktop · **uv**(백엔드 파이썬) · Node 18+(프론트). 백엔드는 `uv`가 `backend/.venv`를 자동 관리하므로 **conda 불필요**(`uv run …`만 사용).

### 1. DB 선택 — 둘 중 하나
| 방식 | 명령/설정 | 비고 |
|---|---|---|
| **(a) 완전 로컬** | `docker-compose -f docker-compose.dev.yml up -d` | postgres 5432 · clickhouse 8123 · redis 6379. `.env.development`의 DB를 `localhost:5432`/`8123`로 |
| **(b) 개발서버(미니PC) DB 사용** | `./scripts/dev-db-tunnel.sh` (별도 터미널 유지) | `localhost:15432→PG`, `18123→CH` 포워딩. **Redis는 로컬 유지**. `.env.development`는 이미 15432/18123을 가리킴 |

> (b) 상세·주의(공유 DB 스키마 변경, cloudflared 2222 선행)는 README "로컬 개발 → 개발서버 DB(SSH 터널)" 참조.

### 2. 백엔드 (uv — 필요한 것만 별도 터미널/백그라운드)
```bash
cd backend
uv sync                                                    # 최초/의존성 변경 시
uv run uvicorn apps.auth.main:app      --reload --port 8001   # 인증(로그인/JWT)
uv run uvicorn apps.blog.main:app      --reload --port 8000   # 블로그(게시판/글/댓글/SSE)
uv run uvicorn apps.stock_api.main:app --reload --port 8002   # 주식 GraphQL(/graphql)
uv run celery -A apps.collector.celery_app worker --loglevel=info   # 수집/알림 워커(선택)
```
> ⚠️ 로컬 포트는 auth **8001** · blog **8000** · stock **8002** (운영 compose는 blog가 8003).

### 3. 마이그레이션·시드 (스키마/계정 변경 시에만)
```bash
cd backend
uv run alembic upgrade head                 # PostgreSQL 스키마
uv run python -m shared.clickhouse_schema   # ClickHouse 테이블(멱등)
uv run python -m apps.auth.seed_admin       # 관리자(admin@stock.app / admin1234)
```
> ⚠️ **개발서버 DB(1-b)에 붙은 상태**로 실행하면 **개발서버의 스키마·계정이 바뀐다**(공유 DB). 로컬 전용 변경은 (1-a)에서.

### 4. 프론트
```bash
cd admin_web  && npm install && npm run dev   # 관리자 http://localhost:5173
cd web_client && npm install && npm run dev   # 유저웹 http://localhost:3000
```

### 5. 기능별 "무엇을 띄우나"
| 하고 싶은 것 | 필요한 서비스 |
|---|---|
| 관리자 로그인 + 게시판 관리 | DB + auth(8001) + blog(8000) + admin_web(5173) |
| 어드민 종목검색/차트 삽입 | 위 + stock_api(8002) |
| 유저 웹 조회 | DB + blog(8000) + web_client(3000) |
| 실시간 알림(SSE)·수집 | 위 + Redis + celery worker |

### 6. 종료
```bash
for p in 8001 8000 8002 5173 3000; do lsof -ti:$p | xargs kill -9 2>/dev/null; done
pkill -f "celery.*worker"
docker compose -f docker-compose.dev.yml stop     # 로컬 DB 정지(데이터 유지)
```

---

## B. 서버 배포 (미니PC)

### 0. 최초 1회 부트스트랩
러너 등록·호스트 시크릿(`/opt/stock_app/env/.env.production`)·Cloudflare Tunnel·스키마 부트스트랩은 **[`server_setup.md`](./server_setup.md)** 를 따른다(딱 한 번). 이후 배포는 아래 파이프라인이 자동/수동 처리.

### 1. 배포 파이프라인 — 서버/웹 분리
GitHub Actions self-hosted 러너(미니PC)에서 동작. **대상별로 두 워크플로**로 나뉘어, 각자 지정 서비스만 `docker compose up -d --build` 한다(나머지 컨테이너·볼륨 보존).

| 워크플로 | 자동 트리거(경로) | 배포 대상 |
|---|---|---|
| `.github/workflows/deploy-server.yml` | `backend/**`, `docker-compose.prod.yml` | auth/stock/blog API + celery worker/beat (DB는 depends_on) |
| `.github/workflows/deploy-web.yml` | `web_client/**`, `admin_web/**`, `docker-compose.prod.yml` | web_client(3000) + admin_web(3001) |

### 2. 자동 배포 (경로 기반 push)
`dev`에서 작업 → `main` 병합 → push. **변경된 경로에 해당하는 워크플로만** 실행된다(둘 다 바뀌면 둘 다).
```bash
git checkout main && git merge dev && git push origin main
# backend/** 변경 → Deploy Server / web_client·admin_web/** 변경 → Deploy Web
```
> 워크플로 파일(`.github/**`)만 바꾼 push는 어느 필터에도 안 걸려 배포를 트리거하지 않는다(수동으로 실행·테스트).

### 3. 수동 배포 (workflow_dispatch)
**전제**: 워크플로가 origin `main`에 올라가 있어야 UI에 버튼이 뜬다(최초 push 이후 활성). 실행엔 저장소 **write 권한** 필요.

- **웹 UI**: 저장소 → **Actions** → 좌측에서 `Deploy Server` 또는 `Deploy Web` 선택 → **Run workflow** → Branch `main` → 실행.
- **gh CLI**:
  ```bash
  gh workflow run deploy-server.yml --ref main   # 서버만
  gh workflow run deploy-web.yml    --ref main   # 웹만
  gh run watch                                   # 진행 확인
  ```
  > `gh auth status`로 **write 권한 계정** 확인(권한 없으면 거부).

### 4. 배포 시 주의
- **프론트 배포는 백엔드/수집 워커를 건드리지 않는다**(분리의 핵심). 반대도 동일.
- **수집 시간(매일 20:30) 중 서버 배포 지양** — 워커 컨테이너 recreate로 수집이 끊긴다. 필요하면 **수동 배포로 조용한 시간에**.
- **최초 배포 후 스키마 부트스트랩 1회** 필수(안 하면 전 요청 500) → server_setup.md §7.
- **DB 포트(5432/8123/9000/6379)는 LAN 전용** — Cloudflare 터널에 절대 노출 금지.

### 5. 배포 검증
```bash
docker compose -f docker-compose.prod.yml ps                 # 컨테이너 up/healthy
curl -s https://api.haezean.com/graphql -H 'content-type: application/json' -d '{"query":"{ __typename }"}'
# 프론트/로그인 CORS 확인
curl -s -D - -o /dev/null -X OPTIONS https://auth.haezean.com/api/v1/auth/login \
  -H 'Origin: https://admin.haezean.com' -H 'Access-Control-Request-Method: POST' | grep -i allow-origin
```

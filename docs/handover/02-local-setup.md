# 2. 내 컴퓨터에서 띄워 보기

> 목표: 내 맥(또는 윈도우)에서 DB → 서버 → 웹 순서로 켜고, 관리자 로그인과 글 목록 화면을 직접 본다.
> 윈도우라면 먼저 [`docs/windows_setup.md`](../windows_setup.md) 를 본다.

## 2-1. 준비물 (최초 1회)

| 도구 | 왜 필요한가 | 확인 명령 |
|---|---|---|
| **Docker Desktop** | DB 3종(PostgreSQL·ClickHouse·Redis)을 설치 없이 컨테이너로 띄운다 | `docker --version` |
| **uv** | 파이썬 버전·패키지를 프로젝트별로 관리한다 (`pip` + `venv` 대체) | `uv --version` |
| **Node.js 20** | 웹·앱 개발 서버 실행 (`nvm use 20`) | `node -v` |
| **Git** | 코드 받기·커밋 | `git --version` |

> 💡 `uv` 는 `backend/.venv` 가상환경을 자동으로 만든다. 명령 앞에 `uv run` 만 붙이면 되고, conda 활성화는 꼭 필요하지 않다.

## 2-2. 켜는 순서 (꼭 이 순서)

**DB → 백엔드 → 프론트.** 아래층이 없으면 위층이 에러를 낸다.

### ① DB 켜기
```bash
cd stock_app
docker compose -f docker-compose.dev.yml up -d     # 백그라운드로 postgres·clickhouse·redis 실행
docker compose -f docker-compose.dev.yml ps        # 3개 모두 running(healthy) 인지 확인
```

### ② 백엔드 처음 준비 (최초 1회, 또는 테이블이 바뀌었을 때)
```bash
cd backend
cp .env.example .env.development          # 환경변수 파일 만들기 (이미 있으면 생략)
uv sync                                   # 파이썬 패키지 설치
uv run alembic upgrade head               # PostgreSQL 테이블 만들기/최신화
uv run python -m shared.clickhouse_schema # ClickHouse 테이블 만들기 (여러 번 해도 안전)
uv run python -m apps.auth.seed_admin     # 관리자 계정 만들기 (admin@stock.app / admin1234)
```

> `.env.development` 는 **Git 에 올라가지 않는** 개인 설정 파일이다(`.gitignore`). 처음엔 `.env.example` 을 복사해서 쓰면 로컬 DB 를 가리킨다.
> 이미 받은 `.env.development` 가 `15432`/`18123` 포트를 가리키면 **개발서버(미니PC) DB** 를 쓰는 설정이다. 이때는 [README 의 SSH 터널 절](../../README.md#로컬-개발--개발서버미니pc-db-사용-ssh-터널)대로 `./scripts/dev-db-tunnel.sh` 를 먼저 켠다. 이 상태에서 `alembic`·시드를 돌리면 **개발서버 DB 가 바뀌니** 조심한다.

### ③ 백엔드 서버 켜기 (터미널을 하나씩 따로 연다)
```bash
cd backend
uv run uvicorn apps.auth.main:app      --reload --port 8001   # 로그인
uv run uvicorn apps.blog.main:app      --reload --port 8000   # 게시판·댓글
uv run uvicorn apps.stock_api.main:app --reload --port 8002   # 주식 데이터(GraphQL)
```
- `--reload` : 코드를 저장하면 서버가 자동 재시작된다(개발용).
- 켜졌는지 확인: 브라우저에서 `http://localhost:8000/health` → `{"status":"ok","service":"blog"}`

### ④ 프론트 켜기
```bash
cd admin_web  && npm install && npm run dev    # 관리자 웹  http://localhost:5173
cd web_client && npm install && npm run dev    # 사용자 웹  http://localhost:3000
```

### ⑤ 확인
1. `http://localhost:5173` → `admin@stock.app` / `admin1234` 로 로그인 → 게시판을 하나 만들고 글을 쓴다.
2. `http://localhost:3000` → 방금 쓴 글이 보이면 성공.

## 2-3. 무엇을 띄워야 하나 (기능별)

전부 다 켤 필요는 없다. 보고 싶은 기능에 맞춰 켠다.

| 하고 싶은 것 | 필요한 것 |
|---|---|
| 게시판·글 보기 | DB + blog(8000) + web_client |
| 로그인·댓글 쓰기 | 위 + auth(8001) |
| 관리자 화면 | DB + auth + blog + stock_api + admin_web |
| 차트·스크리너·마켓 | DB + stock_api(8002) (+ 수집된 데이터) |
| 트레이딩 게임 | DB + auth + trading_game(8003, `--workers 1`) + `run_game_ws`(장외엔 `MOCK_TICK_STREAM=true`) + 시즌 시드 |
| 데이터 수집·알림 | DB + Celery worker (+ beat) — [7장](./07-batch-celery.md) |

전체 표는 [README "기능별 무엇을 띄워야 하나"](../../README.md#3-기능별-무엇을-띄워야-하나) 참고.

## 2-4. 상태 점검과 종료

```bash
# 무엇이 켜져 있나 (● 실행중 / ○ 정지)
for p in 8001 8000 8002 8003 5173 3000; do lsof -ti:$p >/dev/null 2>&1 && echo "$p ●" || echo "$p ○"; done

# 끄기
for p in 8001 8000 8002 8003 5173 3000; do lsof -ti:$p | xargs kill -9 2>/dev/null; done
docker compose -f docker-compose.dev.yml stop      # DB 정지 (데이터는 남는다)
```

> `docker compose ... down -v` 의 `-v` 는 **DB 데이터를 통째로 지운다.** 초기화가 목적일 때만 쓴다.

## 2-5. 처음에 자주 막히는 곳

| 증상 | 원인 | 해결 |
|---|---|---|
| `connection refused ... 5432` | DB 컨테이너가 안 켜짐 | ① 다시 실행, `docker compose ps` 확인 |
| `Address already in use` | 같은 포트에 서버가 이미 떠 있음 | 2-4 의 끄기 명령 후 다시 실행 |
| `relation "users" does not exist` | 테이블이 없음 | `uv run alembic upgrade head` |
| 웹에서 `Network Error` | 해당 백엔드 서버가 꺼져 있음 | 2-3 표에서 필요한 서버 확인 |
| 웹 `npm run build` 가 `VITE_... 주입되지 않았습니다` 로 실패 | 배포용 빌드는 API 주소가 필수 | 로컬 확인은 `npm run build -- --mode development` |

## 직접 해보기

1. 2-2 의 ①~⑤를 끝까지 따라 한다.
2. `http://localhost:8000/docs` 를 열어 본다. 이것이 FastAPI 가 자동으로 만들어 주는 API 설명서(Swagger)다. [4장](./04-server-fastapi.md)에서 다시 쓴다.
3. blog 서버를 끈 상태에서 web_client 를 새로고침하고 어떤 에러가 나는지 본다. 다시 켜면 돌아오는지 확인한다.

이전: [1. 전체 그림](./01-big-picture.md) · 다음: [3. 파이썬 기초](./03-python-basics.md)

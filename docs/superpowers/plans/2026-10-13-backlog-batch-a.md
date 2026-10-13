# 백로그 A 묶음 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서로 독립된 4개 백로그 — (1) 차트 퀴즈 정기 생성 Celery beat, (2) 명예의 전당 응답 `season_number`, (3) 게스트 로그인 백엔드 게이트 `AUTH_GUEST_ENABLED`, (4) admin_web `@tailwindcss/typography` — 를 각각 커밋 1개로 구현하고 문서를 갱신한다.

**Architecture:** (1) `apps/collector/tasks/quiz.py` 가 `scripts.generate_chart_quiz.generate` 를 **import 해서 재사용**(로직 복제 금지, CLI 유지). 재고 판정(`chart_quiz_pool` 중 `user_quiz_attempts` 에 없는 id 수, NOT EXISTS)과 생성 호출은 `session_factory`·`generate_fn` 을 받는 async 함수로 분리해 sqlite 로 테스트. 태스크 래퍼는 `settle_season` 과 같은 `asyncio.run(_run())` + `finally: engine.dispose()` 형태. (2) `routers/leaderboard.py` hall_of_fame 에서 `HallOfFame ⨝ GameSeason` 조인으로 `season_number` 추가(기존 키·정렬·limit 불변). (3) `apps/auth/guest_gate.py` — 요청 시점에 env 를 읽는 `guest_login_enabled()` + 라우트 의존성 `require_guest_enabled`(꺼짐 → 404 `{"detail":"Not Found"}`). (4) devDependency + `tailwind.config.js` plugins.

**Tech Stack:** FastAPI·SQLAlchemy async·Celery(crontab, Asia/Seoul) / pytest(+aiosqlite·AsyncMock·monkeypatch) · React 18 + TS strict + Vite + Tailwind 3.4 · Expo + Unistyles v3 + jest-expo

**스펙:** `docs/superpowers/specs/2026-10-13-backlog-batch-a-design.md`

---

## 공통 규칙 (모든 태스크)

- 브랜치 `dev`. 스테이징은 명시 경로만(`git add -A`/`git add .` 금지). `.claude/`·`.serena/project.yml` 스테이징 금지. 괄호 경로는 따옴표로 감싼다.
- 커밋 메시지 끝에 정확히:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- 백엔드는 `cd backend && uv run ...`. 테스트는 네트워크·DB·Redis 없이(sqlite in-memory + 목). **alembic 을 어떤 DB 에도 실행하지 않는다**(신규 마이그레이션 없음).
- 백엔드 기준선: `uv run pytest -p no:warnings` → **343 passed**.
- 실제 env 파일(`.env.development` 등)은 수정하지 않는다 — `backend/.env.example` 만.
- **테스트에서의 APP_ENV**: `shared/env.py` 가 `shared` import 시 1회 `.env.{APP_ENV 또는 development}` 를 `override=False` 로 로드한다. 로컬은 `backend/.env.development` 가 있어 `APP_ENV=development` 가 `os.environ` 에 들어오지만, CI·Docker 이미지는 `.env.*` 가 gitignore/dockerignore 라 **미설정**. → 게이트 관련 테스트는 반드시 `monkeypatch` 로 `AUTH_GUEST_ENABLED`·`APP_ENV` 를 명시(삭제 포함)한다.

---

## Task 1: 퀴즈 정기 생성 (Celery beat)

**Files:**
- Create: `backend/apps/collector/tasks/quiz.py`
- Modify: `backend/apps/collector/celery_app.py` (`include` 에 `apps.collector.tasks.quiz`, beat `generate-chart-quiz` = `crontab(hour=21, minute=0)`)
- Create: `backend/tests/test_quiz_beat.py`

- [ ] **Step 1 (red):** 테스트 작성
  - `count_unseen(db)` — 퀴즈 3개 중 1개에 시도 기록(유저 시드 → FK 충족) → 2.
  - `refill_quiz_pool(maker, generate_fn=AsyncMock, min_unseen=2, batch=5)` 재고 == min → skip(`generated=0`, `skipped_reason` 문자열), generate 미호출.
  - 재고 < min → `generate_fn(5, rng=..., session_factory=maker)` 호출, `{"generated": created, "skipped_reason": None}`.
  - env 파싱: `QUIZ_POOL_MIN_UNSEEN`/`QUIZ_POOL_BATCH` 미설정 → 100/50, 정수 → 그 값, 잘못된 값 → 기본값.
  - beat: `celery_app.conf.beat_schedule["generate-chart-quiz"]` task 이름 `collector.generate_chart_quiz`, `schedule.hour == {21}`, `schedule.minute == {0}`; `"apps.collector.tasks.quiz" in celery_app.conf.include`; 모듈 import 후 `"collector.generate_chart_quiz" in celery_app.tasks`.
  - 태스크 래퍼: `_run` 을 목으로 바꾸고 `generate_chart_quiz()` 가 결과 dict 반환.
- [ ] **Step 2:** `uv run pytest tests/test_quiz_beat.py` → ImportError/실패 확인.
- [ ] **Step 3:** 구현 — `from scripts import generate_chart_quiz as gen` 후 `gen.generate` 를 모듈 속성으로 호출(목 교체 가능). `session_factory` 는 명시 전달.
- [ ] **Step 4:** 테스트 통과 + `uv run python -m scripts.generate_chart_quiz --help` (CLI 보존) + 전체 pytest.
- [ ] **Step 5:** 커밋 `feat(collector): 차트 퀴즈 풀 정기 보충 Celery beat(21:00, 미시도 재고 기준)`

## Task 2: 명예의 전당 `season_number`

**Files:**
- Modify: `backend/apps/trading_game/routers/leaderboard.py`
- Modify: `backend/tests/test_game_web_api.py` (HoF 테스트 추가)
- Modify: `web_client/src/types/game.ts`, `web_client/src/components/game/LeaderboardModal.tsx`
- Modify: `mobile/src/features/game/types.ts`, `mobile/src/features/game/components/leaderboard-sheet.tsx`
- (api.ts 는 원 응답 그대로 반환 — 매핑 없음, 무수정)

- [ ] **Step 1 (red):** 시즌 2개(`season_number` 7·8, id 와 다르게) + HoF 행 시드 → 응답 각 행 `season_number` == 시즌 번호, 기존 키 집합 유지, 정렬(season_id desc, rank asc), `?season_id=` 필터 유지.
- [ ] **Step 2:** `uv run pytest tests/test_game_web_api.py -k hall` → KeyError 실패 확인.
- [ ] **Step 3:** `select(HallOfFame, GameSeason.season_number).join(GameSeason, GameSeason.id == HallOfFame.season_id)` 로 변경, 행 dict 에 `season_number` 추가.
- [ ] **Step 4:** web/mobile 타입에 `season_number: number`, `groupBySeason` 그룹에 `seasonNumber` 보관(그룹 키는 `seasonId` 유지), 헤더 `시즌 {g.seasonNumber}`, "season_id 만 준다" 주석 제거.
- [ ] **Step 5:** 검증 — pytest 전체, `cd web_client && npx tsc --noEmit && VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build`, `cd mobile && npx tsc --noEmit && npm test`.
- [ ] **Step 6:** 커밋 `feat(game): 명예의 전당 응답에 season_number 추가 + 웹·모바일 시즌 헤더 표기`

## Task 3: 게스트 로그인 백엔드 게이트

**Files:**
- Create: `backend/apps/auth/guest_gate.py`
- Modify: `backend/apps/auth/routers/auth.py` (`@router.post("/guest", ..., dependencies=[Depends(require_guest_enabled)])`)
- Create: `backend/tests/test_auth_guest_gate.py`
- Modify: `backend/tests/test_social_login.py` (`test_guest_login_unchanged` 에 `monkeypatch.setenv("AUTH_GUEST_ENABLED", "true")` — 로컬 `.env.development` 에 우연히 기대지 않게)

- [ ] **Step 1 (red):** 각 테스트에서 `AUTH_GUEST_ENABLED`·`APP_ENV` 를 `delenv(raising=False)` 후 필요한 값만 set.
  - 명시 `true`(APP_ENV=production 이어도) → 200 / 명시 `false`(APP_ENV=development 여도) → 404.
  - 미설정 + `development`/`test` → 200 / 미설정 + `production` → 404 / 둘 다 미설정 → 404.
  - 알 수 없는 값(`maybe`) → 404(fail closed). 꺼짐 상태에서 잘못된 본문도 422 가 아닌 404.
  - 404 본문 정확히 `{"detail": "Not Found"}`.
- [ ] **Step 2:** `uv run pytest tests/test_auth_guest_gate.py` → 실패(꺼짐 케이스가 200) 확인.
- [ ] **Step 3:** 구현 — 요청 시점 `os.getenv`, 값 정규화(`true/1/yes/on` → 켬, `false/0/no/off` 및 기타 → 끔, 빈 값 → APP_ENV ∈ {development, test}).
- [ ] **Step 4:** 게이트 테스트 + `tests/test_social_login.py` + 전체 pytest 통과.
- [ ] **Step 5:** 커밋 `feat(auth): 게스트 로그인 백엔드 게이트(AUTH_GUEST_ENABLED, 미설정 시 dev/test 만)`

## Task 4: admin_web 미리보기 타이포그래피

**Files:**
- Modify: `admin_web/package.json`, `admin_web/package-lock.json` (`npm i -D --save-exact @tailwindcss/typography@0.5.19` — peer `tailwindcss >=3.0.0`, 2025-09 배포)
- Modify: `admin_web/tailwind.config.js` (`import typography from '@tailwindcss/typography'`, `plugins: [typography]`)

- [ ] **Step 1:** 설치 + 설정.
- [ ] **Step 2:** `cd admin_web && npx tsc --noEmit && VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x VITE_STOCK_API_URL=http://x npm run build`.
- [ ] **Step 3:** `grep -c '\.prose' dist/assets/*.css` > 0 확인. 컴포넌트 클래스 변경 없음(이미 `prose max-w-none` 사용).
- [ ] **Step 4:** 커밋 `feat(admin): @tailwindcss/typography 도입 — 에디터·코치 미리보기 prose 스타일`
- [ ] 브라우저 확인(컨트롤러): 블로그 에디터·코치 미리보기 제목·목록·링크, 레이아웃 회귀 없음.

## Task 5: 문서

**Files:**
- Modify: `README.md` (퀴즈 beat 21:00 + `QUIZ_POOL_MIN_UNSEEN`/`QUIZ_POOL_BATCH`, `AUTH_GUEST_ENABLED` 환경변수 표·게스트 안내를 프론트 플래그와 짝으로)
- Modify: `docs/server_setup.md` (develop 서버 `/opt/stock_app/env/.env.production` 에 `AUTH_GUEST_ENABLED=true` — 웹 `VITE_ENABLE_GUEST_LOGIN=true` 와 짝, product 전환 시 둘 다 false; **배포 전에 넣어야** develop 게스트 로그인이 404 가 되지 않음)
- Modify: `backend/.env.example` (`AUTH_GUEST_ENABLED=`, `QUIZ_POOL_MIN_UNSEEN=`, `QUIZ_POOL_BATCH=`)
- Modify: `docs/ROADMAP.md` 상시 백로그 — "퀴즈 생성 정기 스케줄"·"admin_web prose 스타일" 체크, HoF season_number·게스트 게이트 체크 항목 추가

- [ ] 커밋 `docs: 백로그 A 묶음 — README·server_setup·env 예시·ROADMAP`

## 최종 검증

```bash
cd backend && uv run pytest -p no:warnings          # 전부 통과
cd web_client && npx tsc --noEmit && VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build
cd admin_web && npx tsc --noEmit && VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x VITE_STOCK_API_URL=http://x npm run build
cd mobile && npx tsc --noEmit && npm test
```

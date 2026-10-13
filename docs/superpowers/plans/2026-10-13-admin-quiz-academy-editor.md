# 퀴즈·아카데미 문항 관리자 편집(백로그 ⑤-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아카데미 문항을 코드 상수 → DB(`academy_questions`)로 옮겨 관리자가 편집하고, 차트 퀴즈 풀을 관리자가 조회·수정·비활성·삭제·일괄 생성·직접 출제한다(admin_web 화면 포함).

**Architecture:** 모델 2건(신규 `AcademyQuestion`, `ChartQuiz.is_active`) + 마이그레이션 1개(초기 3문항 시드). 아카데미는 `academy_service`가 DB를 읽고 관리자 CRUD 함수를 추가, 퀴즈 관리는 신규 `quiz_admin_service`(목록·상세·수정·삭제·일괄 생성·직접 출제)가 맡는다. 라우터는 신규 `routers/academy_admin.py`·`routers/quiz_admin.py`(prefix `/api/game/admin`, `require_admin`)로 HTTP 매핑만 한다. 생성기(`scripts/generate_chart_quiz.py`)는 최소 리팩터링으로 사유 코드·동기 수집 함수를 노출하고 CLI·beat 동작은 그대로 둔다.

**스펙:** `docs/superpowers/specs/2026-10-13-admin-quiz-academy-editor-design.md`

---

## 공통 규칙

- 브랜치 `dev`. 명시 경로만 스테이징(`git add -A`/`.` 금지, `.claude/`·`.serena/project.yml` 금지, 괄호 경로는 따옴표). 태스크마다 커밋 1개, 트레일러:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- **어떤 DB 에도 `alembic upgrade/downgrade` 를 실행하지 않는다**(검증은 컨트롤러가 일회용 DB 에서). `alembic heads` 조회만 허용(현재 head `a7b8c9d0e1f2`).
- 백엔드 기준선 `uv run pytest -p no:warnings` → **445 passed**. 엄격 TDD(실패 테스트 먼저 → 실패 확인 → 구현 → 통과).
- TS: `any`·`@ts-ignore` 금지. web_client 사용자 아카데미 API 형식 불변.

## 설계 결정(스펙 보완)

- **마이그레이션 시드**: 3문항을 마이그레이션에 하드코딩(서비스 import 금지), id 1·2·3, sort_order 1·2·3. PG 에서는 명시 id 삽입 뒤 `setval(pg_get_serial_sequence('academy_questions','id'), MAX(id))` 로 시퀀스를 맞춘다(안 하면 첫 관리자 POST 가 id=1 중복). `chart_quiz_pool.is_active` 는 `server_default="true"`(기존 행 활성), 모델은 `default=True` 도 둔다(sqlite `create_all` 테스트).
- **아카데미 채점**: 활성 문항을 `sort_order, id` 순으로 조회. 0개면 `attempts` 증가 **전에** `AcademyError("NO_QUESTIONS")` → 409(빈 집합 `all([])`=True 로 해금되는 버그 방지). 응답 형식 불변.
- **기존 테스트 갱신**: `test_quest_quiz_streak.py` 의 `ALL_CORRECT`(모듈 상수 의존)를 시드 헬퍼(동일 3문항 삽입) 기반으로 바꾼다 — 상수 제거에 따른 정당한 갱신(검증 약화 아님).
- **관리자 아카데미 DTO**: `choices: list[1~200자] (2~6개)`, `answer` 범위는 model_validator, `question` 1~500, `explanation` 1~1000, `sort_order` 0~10000(기본 0), `is_active` 기본 true. 문자열은 앞뒤 공백 제거 후 길이 검증. PUT 은 전체 교체. 없는 id → 404 `NOT_FOUND`.
- **퀴즈 수정 DTO**: `pattern_type`·`explanation`·`is_active` 모두 선택, `extra="forbid"` → `answer`·`chart_snapshot` 등을 보내면 422.
- **퀴즈 목록**: `{items, total, page, size}`, `created_at desc, id desc`(sqlite 동시각 타이브레이크), 시도 수 = `user_quiz_attempts` 행 수(출제 포함).
- **삭제**: CASCADE FK 가 있어도 시도 수를 먼저 세어 >0 이면 409 `HAS_ATTEMPTS`.
- **비활성 범위**: `serve_random`·`count_unseen` 에만 `is_active` 필터. 이미 출제된 뒤 비활성된 문제의 **제출은 허용**(submit 필터 없음).
- **생성기 리팩터링**: `evaluate_quiz(ticker, candles, base_idx) -> dict | str`(사유 코드 `INSUFFICIENT_DATA`·`INVALID_SERIES`·`TOO_FLAT`), `make_quiz` 는 이를 감싸 None 반환(기존 테스트 불변). `generate` 를 동기 `collect_quizzes(...)` + 기존 `insert_quizzes` 로 분리(CLI·beat 동작 동일). `_fetch_candles(ticker, start=None, end=None)` 로 기간 지정 허용(기본 3년).
- **이벤트 루프 보호**: ClickHouse 클라이언트가 동기이므로 관리자 일괄 생성·직접 출제의 수집은 `asyncio.to_thread`. 생성기 fetch 함수는 **호출 시점에** `gen._fetch_*` 를 조회해 넘긴다(기본 인자 바인딩 때문에 monkeypatch 가 안 먹는 문제 회피).
- **직접 출제**: (ticker, base_date) 선조회 → 있으면 409 `DUPLICATE` → CH `base_date-150일 ~ base_date+20일` 조회 → 기준일 캔들 없으면 `INSUFFICIENT_DATA` → `evaluate_quiz` 사유 코드 422 → 삽입(IntegrityError 도 `DUPLICATE`). 응답은 상세 DTO(201).
- **차트 미리보기 이후 5일**: `chart_snapshot` 은 기준일까지 60봉뿐이므로 admin 화면이 기존 stock_api `getChartData(ticker, base_date+1, base_date+14)` 로 이후 5봉을 받아 다른 색으로 덧그린다. 실패하면 스냅샷만 표시(백엔드 상세 응답은 스펙대로 원본만).
- **라우트**: 컬렉션 경로는 `""`(trailing slash 307 리다이렉트로 CORS 깨짐 방지). 모든 신규 엔드포인트 비관리자 403 테스트.
- **admin 오류 표시**: 신규 API 오류는 `detail: {code, message}` → 신규 공용 헬퍼 `lib/gameApiError.ts` 가 문자열·객체·검증 배열을 모두 처리(기존 페이지는 손대지 않음).

## Task 1: 모델 + 마이그레이션

**Files:** `backend/shared/game_models.py`(`AcademyQuestion`, `ChartQuiz.is_active`), `backend/alembic/versions/b8c9d0e1f2a3_academy_questions_quiz_active.py`(down `a7b8c9d0e1f2`), `backend/tests/test_admin_quiz_academy.py`

- [ ] 실패 테스트: `AcademyQuestion` 왕복(choices JSON 리스트, is_active 기본 true), `ChartQuiz.is_active` 기본 true
- [ ] 모델·마이그레이션(시드 3문항 + PG 시퀀스 보정, downgrade: 컬럼 drop → 테이블 drop)
- [ ] 통과 → 커밋 `feat(game): academy_questions 테이블·퀴즈 is_active(모델·마이그레이션)`

## Task 2: 아카데미 DB 전환 + 관리자 CRUD API(TDD)

**Files:** `services/academy_service.py`, `routers/academy.py`, `routers/academy_admin.py`(신규), `schemas/game_dtos.py`, `main.py`, `tests/test_admin_quiz_academy.py`, `tests/test_quest_quiz_streak.py`(시드 헬퍼)

- [ ] 실패 테스트: 활성만·sort_order 순 출제, 전부 정답 해금·비활성 문항 무시, 0개 409(attempts 불변), 기해금 유지(문항 추가 후), 관리자 목록(비활성 포함)·생성·수정·삭제·404, 검증 422(choices 1개/7개/201자, answer 범위, 빈 질문), 비관리자 403
- [ ] 구현 → 전체 회귀 → 커밋 `feat(game): 아카데미 문항 DB 전환 + 관리자 CRUD API`

## Task 3: 퀴즈 활성 필터 + 관리자 목록·상세·수정·삭제·일괄 생성(TDD)

**Files:** `services/quiz_service.py`, `apps/collector/tasks/quiz.py`, `services/quiz_admin_service.py`(신규), `routers/quiz_admin.py`(신규), `scripts/generate_chart_quiz.py`(`collect_quizzes` 분리), `schemas/game_dtos.py`, `main.py`, `tests/test_admin_quiz_academy.py`, `tests/test_quiz_beat.py`

- [ ] 실패 테스트: 비활성 출제 제외·재고 제외, 목록 페이지네이션·필터·시도 수·size>100 422, 상세(날짜 포함 스냅샷), 수정 허용 필드·금지 필드 422, 삭제 409/204, 일괄 생성(CH 목), 403
- [ ] 구현 → 커밋 `feat(game): 퀴즈 활성 필터 + 관리자 퀴즈 관리·일괄 생성 API`

## Task 4: 직접 출제(TDD)

**Files:** `scripts/generate_chart_quiz.py`(`evaluate_quiz`, `_fetch_candles` 기간), `services/quiz_admin_service.py`, `routers/quiz_admin.py`, 테스트

- [ ] 실패 테스트: `evaluate_quiz` 사유 코드, 직접 출제 201·`INSUFFICIENT_DATA`(데이터 없음/기준일 없음/이후 5봉 부족)·`TOO_FLAT`·`INVALID_SERIES` 422·`DUPLICATE` 409, 생성 후 해설 수정
- [ ] 구현 → 커밋 `feat(game): 관리자 퀴즈 직접 출제(종목·기준일)`

## Task 5: admin_web

**Files:** `src/types/game.ts`, `src/api/academyAdmin.ts`, `src/api/quizAdmin.ts`, `src/lib/gameApiError.ts`, `src/pages/TradingGameAcademy.tsx`, `src/pages/TradingGameQuizzes.tsx`, `src/components/QuizChartPreview.tsx`, `src/App.tsx`, `src/components/Sidebar.tsx`

- [ ] 아카데미: 목록(순서·활성 토글·편집·삭제), 편집 폼(선택지 2~6 동적, 정답 라디오), 활성 수 + "활성 문항을 모두 맞혀야 해금" 안내
- [ ] 퀴즈: 표(활성 필터·페이지네이션), 상세 패널(echarts 캔들 + 기준일 마크라인 + 이후 5봉 다른 색), 해설·패턴 편집, 활성 토글, 삭제(409 안내), "N개 자동 생성", "직접 출제"(종목 검색 KR·기준일)
- [ ] `npx tsc --noEmit` + build → 커밋 `feat(admin): 아카데미 문항·퀴즈 관리 화면`

## Task 6: 문서

- [ ] README: 관리자 API 목록·admin 화면·테이블 목록·"3문항" 문구 → "활성 문항 전부", ROADMAP ⑤-2 체크 → 커밋 `docs: 퀴즈·아카데미 문항 관리자 편집(⑤-2) README·ROADMAP`

## 검증

- `cd backend && uv run pytest -p no:warnings`
- `cd admin_web && npx tsc --noEmit && VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x VITE_STOCK_API_URL=http://x npm run build`
- `cd web_client && npx tsc --noEmit`, `cd mobile && npx tsc --noEmit && npm test`
- 컨트롤러: 일회용 PG 에 upgrade/downgrade/upgrade + `alembic check`, 시드 3문항·시퀀스 확인, 브라우저 스모크

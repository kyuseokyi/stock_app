# 퀴즈·아카데미 문항 관리자 편집 설계 스펙 (백로그 ⑤-2)

> 작성일: 2026-10-13 · 상태: 승인됨(사용자: "1번(현실적 범위)과 2번(퀴즈 직접 출제) 둘 다")
> 선행: Phase 5b 아카데미(`services/academy_service.py`, 코드 상수 QUESTIONS)·퀴즈(`chart_quiz_pool`, `scripts/generate_chart_quiz.py`)·관리자 기능 설정 화면(admin_web `TradingGameSettings`).

## 1. 아카데미 문항 → DB
- 새 테이블 `academy_questions`: `id`, `question`(text), `choices`(JSON 문자열 배열, 2~6개), `answer`(int, 0-based), `explanation`(text), `sort_order`(int), `is_active`(bool, default true), `created_at`, `updated_at`.
- 마이그레이션에서 현재 코드 상수 3문항을 **초기 데이터로 삽입**(id·순서·내용 동일). 코드 상수는 제거하고 서비스는 DB를 읽는다.
- 해금 규칙: **활성 문항 전부 정답**이어야 해금. 활성 문항이 0개면 제출 409 `NO_QUESTIONS`. 이미 해금한 사용자(`user_academy`)는 문항이 바뀌어도 유지.
- 사용자 API(`/api/game/academy/quiz`, `/submit`) 응답 형식 불변(활성 문항만, sort_order 순).
- 관리자 API(`/api/game/admin/academy/questions`): 목록(GET, 비활성 포함), 생성(POST), 수정(PUT /{id}), 삭제(DELETE /{id} — 실제 삭제). 검증: choices 2~6개·각 1~200자, answer 범위, question 1~500자, explanation 1~1000자.

## 2. 퀴즈 관리
- `chart_quiz_pool` 에 `is_active`(bool, default true) 컬럼 추가(마이그레이션). 비활성 문제는 출제(`serve_random`)·beat 재고 계산(미시도 수)에서 제외.
- 관리자 API(`/api/game/admin/quizzes`):
  - 목록 GET(페이지네이션 `page`,`size`≤100, 필터 `active`, 최신순) — id·ticker·base_date·pattern_type·answer·actual_change·is_active·시도 수.
  - 상세 GET /{id} — 원본 chart_snapshot(날짜 포함)·정답·해설.
  - 수정 PUT /{id} — `pattern_type`(1~50자)·`explanation`(1~1000자)·`is_active` 만(차트·정답·등락률 불변).
  - 삭제 DELETE /{id} — 시도 기록이 있으면 409 `HAS_ATTEMPTS`(비활성 권장), 없으면 삭제.
  - **일괄 생성** POST `/generate` `{count: 1~200}` → 기존 생성기 함수 호출, `{created, skipped}`.
  - **직접 출제** POST `/` `{ticker, base_date}` → 생성기의 `make_quiz` 로 해당 종목 일봉(ClickHouse)에서 기준일까지 60캔들·이후 5거래일로 정답/등락률/해설 자동 계산해 저장. 실패 사유 코드: `INSUFFICIENT_DATA`·`TOO_FLAT`(|등락|<1%)·`INVALID_SERIES`(이상치) → 422, `DUPLICATE`(ticker+base_date) → 409. 생성 후 해설 수정 가능.
- 모든 관리자 API 는 기존 관리자 인증 의존성(코치·기능 플래그와 동일) 사용.

## 3. admin_web
- 사이드바 "트레이딩 게임"에 **"🎓 아카데미 문항"**, **"🧩 퀴즈 관리"** 추가(라우트 `game/academy`, `game/quizzes`).
- 아카데미 문항 화면: 목록(순서·활성 토글·편집·삭제), 편집 폼(질문, 선택지 동적 추가/삭제 2~6, 정답 라디오, 해설, 순서), 활성 문항 수 + "활성 문항을 모두 맞혀야 해금" 안내.
- 퀴즈 관리 화면: 목록 표(활성 필터, 페이지네이션), 행 → 상세(차트 미리보기 — 기존 admin echarts, 기준일 표시, 이후 5일 다른 색), 해설·패턴 편집, 활성 토글, 삭제(시도 있으면 비활성 안내), 상단 "N개 자동 생성"·"직접 출제(종목 검색·기준일)" 버튼. 종목 검색은 기존 stock_api 검색 재사용.
- TS strict, 기존 admin 패턴(api 계층·타입·에러 처리) 준수.

## 4. 검증
- backend TDD: 아카데미 DB 전환(사용자 API 불변·활성만·전부 정답 해금·0개 409·기해금 유지), 관리자 CRUD 검증·권한(비관리자 403), 퀴즈 비활성 출제·재고 제외, 수정 허용 필드, 삭제 409/성공, 일괄 생성, 직접 출제 성공·사유 코드(ClickHouse 조회는 목).
- 마이그레이션: 로컬 docker PG 일회용 DB upgrade/downgrade/upgrade + `alembic check`(컨트롤러). 초기 3문항 삽입 확인.
- admin tsc/build, 브라우저 스모크(일회용 DB): 문항 추가→웹 아카데미 모달 반영, 퀴즈 비활성→출제 제외, 직접 출제.
- 문서: README admin 섹션, ROADMAP 백로그 체크.

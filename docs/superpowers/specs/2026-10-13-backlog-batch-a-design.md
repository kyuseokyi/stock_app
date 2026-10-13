# 백로그 A 묶음 설계 스펙 — 퀴즈 정기 생성 · 명예의 전당 season_number · 게스트 로그인 백엔드 게이트 · admin 미리보기 타이포그래피

> 작성일: 2026-10-13 · 상태: 승인됨(사용자: "A 묶음(위 설계) → B 묶음 순서") · 서로 독립된 4개 항목.

## 1. 퀴즈 정기 생성 (Celery beat)

- 기존 `backend/scripts/generate_chart_quiz.py` 의 생성 로직(`generate(...)`)을 재사용하는 Celery 태스크 `collector.generate_chart_quiz` 추가(`apps/collector/tasks/` 기존 태스크 모듈 패턴).
- **조건부 생성**: 아직 어떤 사용자도 시도하지 않은 문제 수(`chart_quiz_pool` 중 `user_quiz_attempts` 에 없는 id)가 `QUIZ_POOL_MIN_UNSEEN`(기본 100) 미만이면 `QUIZ_POOL_BATCH`(기본 50)개 생성, 아니면 skip. 결과 dict `{generated, skipped_reason}` 반환·로그.
- beat: `crontab(hour=21, minute=0)` — 일봉 수집(20:30)·정산(20:40) 이후. celery_app 의 timezone 설정을 따른다(기존 스케줄과 같은 기준).
- 스크립트 CLI 는 그대로 유지(수동 실행 경로 보존).
- 테스트: 재고 충분 → skip, 부족 → 생성 함수 호출(목으로 대체), beat 스케줄 등록 확인.

## 2. 명예의 전당 `season_number`

- `GET /api/game/hall-of-fame` 응답 각 행에 `season_number`(int) 추가 — `HallOfFame` ↔ `GameSeason` 조인. 기존 필드·정렬·limit 불변(하위 호환).
- web: `types/game.ts` HallOfFameRow 에 `season_number`, `LeaderboardModal` 그룹 헤더 `시즌 {season_number}`(그룹 키는 season_id 유지).
- mobile: `features/game/types.ts`·`leaderboard-sheet.tsx` 동일.
- 테스트: 응답에 season_number 포함(pytest), web tsc/build, mobile tsc/jest.

## 3. 게스트 로그인 백엔드 게이트

- `AUTH_GUEST_ENABLED` 환경변수: `true`/`false` 명시 시 그 값. **미설정이면 `APP_ENV` 가 `development`/`test` 일 때만 켬**(그 외 끔 — fail-closed).
- 꺼져 있으면 `POST /api/v1/auth/guest` → 404 `{"detail":"Not Found"}`.
- 개발 서버(develop)는 테스트용으로 켜 둔다: `docs/server_setup.md`·README 에 `/opt/stock_app/env/.env.production` 에 `AUTH_GUEST_ENABLED=true` 추가 안내(웹 빌드 `VITE_ENABLE_GUEST_LOGIN=true` 와 짝). product 전환 시 둘 다 false.
- 테스트: 명시 true/false, 미설정+development → 허용, 미설정+production·APP_ENV 미설정 → 404.

## 4. admin_web 미리보기 타이포그래피

- `@tailwindcss/typography`(Tailwind v3 호환 버전) devDependency 추가 + `tailwind.config.js` `plugins` 에 등록(ESM 설정 형식에 맞춤).
- 이미 `prose` 클래스를 쓰는 곳(RichTextEditor·코치 미리보기 등)에 스타일이 적용된다. 새 클래스 추가는 최소화(필요 시 `max-w-none` 정도).
- 검증: tsc·build, CSS 번들에 `.prose` 규칙 생성 확인, 브라우저로 블로그 에디터·코치 미리보기 시각 확인(제목·목록·링크), 기존 레이아웃 회귀 없음.

## 5. 검증·문서
- backend pytest 전체 통과, web/admin tsc·build, mobile tsc·jest.
- README(퀴즈 beat·게스트 게이트 env), server_setup(개발 서버 env), ROADMAP 백로그 체크.

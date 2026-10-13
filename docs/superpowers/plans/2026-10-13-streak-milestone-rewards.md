# 연속 출석 마일스톤 보상(백로그 ⑤-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 연속 출석 3·7·14·30일 마일스톤 현금 보상을 시즌마다 마일스톤별 1회, 버튼으로 수령한다(web·mobile 공통).

**Architecture:** 새 테이블 `streak_reward_claims`(user·season·milestone 유니크) + `services/streak_reward_service.py`(상수·자격 판정·조회·수령) → `routers/quiz.py` 의 streak 라우트가 HTTP 매핑만 한다. 수령은 퀘스트 수령(`quest_service.claim`)과 같은 방식: 계좌 선확보 → 수령 행 삽입(flush, 유니크 위반 = `ALREADY_CLAIMED`) → `reward_service.grant_cash`(계좌 FOR UPDATE) → `RewardUnavailable` 이면 rollback(수령 행도 사라짐) → commit.

**스펙:** `docs/superpowers/specs/2026-10-13-streak-milestone-rewards-design.md`

---

## 공통 규칙

- 브랜치 `dev`. 명시 경로만 스테이징(`git add -A`/`.` 금지, `.claude/`·`.serena/project.yml` 금지, 괄호 경로는 따옴표). 태스크마다 커밋 1개, 트레일러:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- **어떤 DB 에도 `alembic upgrade/downgrade` 를 실행하지 않는다**(검증은 컨트롤러가 일회용 DB 에서). `alembic heads` 조회만 허용.
- 백엔드 기준선 `uv run pytest -p no:warnings` → 365 passed. 엄격 TDD(실패 테스트 먼저 → 실패 확인 → 구현 → 통과).
- 모바일 기준선 jest 86 passed. TS: `any`·`@ts-ignore` 금지.

## 설계 결정(스펙 보완)

- 오류 판정 순서(퀘스트와 동일한 "정의 → 달성 → 시즌 → 중복" 흐름): `UNKNOWN_MILESTONE`(404) → `FEATURE_DISABLED`(503) → `NO_ACTIVE_SEASON`(409) → `NOT_REACHED`(409) → `ALREADY_CLAIMED`(409, 선조회 + 유니크 위반) → `PRICE_UNAVAILABLE`(409, 수령 행 롤백).
- 자격: `current_streak >= m` 이고 `last_activity_date ∈ {오늘, 어제}`(KST, `coach_service.kst_today`). `highest_streak` 미사용.
- DTO `StreakRewardDTO.amount` 는 **int**(코드 상수, Raw/변환 분리 불필요). 수령 응답 `cash_balance` 는 퀘스트와 같이 Decimal(문자열).
- `StreakResponse.rewards` 는 기본값 빈 리스트(기존 생성부 호환). 퀴즈 제출 응답의 `streak` 도 rewards 를 계산해 채운다(스토어가 그 값으로 덮어써도 보상 목록이 사라지지 않게). 프론트 보상 모달/시트는 열 때 `refreshStreak()` 로 최신화.
- `season_id` FK 는 `ondelete=CASCADE`(game_accounts 와 동일).

## Task 1: 모델 + 마이그레이션

**Files:** `backend/shared/game_models.py`(`StreakRewardClaim`), `backend/alembic/versions/<rev>_streak_reward_claims.py`(down_revision `e5f6a7b8c9d0`), `backend/tests/test_streak_rewards.py`

- [ ] 실패 테스트: 모델 왕복 + `(user_id, season_id, milestone)` 유니크 위반 IntegrityError
- [ ] 모델·마이그레이션 작성(제약 이름 `uq_streak_reward_user_season_milestone`, 모델·마이그레이션 컬럼 정의 일치)
- [ ] 통과 확인 → 커밋 `feat(game): streak_reward_claims 테이블(모델·마이그레이션)`

## Task 2: 서비스(TDD)

**Files:** `backend/apps/trading_game/services/streak_reward_service.py`, `backend/tests/test_streak_rewards.py`

- [ ] 실패 테스트: 자격 판정(오늘/어제/그제 활동, 마일스톤 경계 2·3), `reward_status`(플래그 꺼짐·시즌 없음 → [], claimed/claimable), `claim` 성공(현금·bonus_cash), 미달·중복·시즌별 독립·시즌 없음·종료시각 경과·시세 없음(수령 행 미생성·잔고 불변)·알 수 없는 마일스톤·플래그 꺼짐·유니크 위반 경로
- [ ] `STREAK_MILESTONES`, `StreakRewardError(code)`, `is_eligible`, `reward_status`, `claim` 구현
- [ ] 통과 → 커밋 `feat(game): 연속 출석 마일스톤 보상 서비스`

## Task 3: 라우터 + DTO(TDD)

**Files:** `schemas/game_dtos.py`(`StreakRewardDTO`, `StreakResponse.rewards`, `StreakRewardClaimResponse`), `routers/quiz.py`, `tests/test_streak_rewards.py`, `tests/test_quest_quiz_streak.py`(`test_router_streak_my` 기대값에 `rewards: []` 추가 — 필드 추가에 따른 정당한 갱신)

- [ ] 실패 테스트: `GET /streak/my` rewards(기존 필드 불변), `POST /streak/rewards/{m}/claim` 200·404·409(각 코드)·503, 퀴즈 제출 streak 에 rewards 포함
- [ ] 구현 → 전체 회귀 → 커밋 `feat(game): 연속 출석 보상 조회·수령 API`

## Task 4: web_client

**Files:** `types/game.ts`(`StreakReward`, `Streak.rewards`, `StreakClaimResult`), `api/game.ts`(`claimStreakReward`), `lib/gameErrors.ts`(`NOT_REACHED`, `UNKNOWN_MILESTONE`), `components/game/StreakRewardModal.tsx`(신규), `components/game/GameHeader.tsx`(칩 → 버튼, `onOpenStreak`), `pages/GamePage.tsx`

- [ ] 모달: 마일스톤 4행(진행 막대 `min(current,m)/m`, 금액, [보상 받기]/받음 ✓/진행 중), 안내 "연속이 끊기기 전에 받아야 해요". 열 때 `refreshStreak()`, 수령 성공 → `setStreak`·`refreshTrading()`·토스트
- [ ] `npx tsc --noEmit` + build → 커밋 `feat(web): 연속 출석 보상 모달`

## Task 5: mobile

**Files:** `features/game/{types,api}.ts`, `features/game/lib/errors.ts` + `errors.test.ts`(테스트 먼저), `features/game/components/streak-reward-sheet.tsx`(신규, 기존 `Sheet`), `components/game-header.tsx`(칩 → Pressable), `app/(tabs)/game.tsx`

- [ ] jest 실패 테스트(`NOT_REACHED`·`UNKNOWN_MILESTONE` 문구) → 구현 → 통과
- [ ] 시트·헤더·화면 연결, `npx tsc --noEmit && npm test` → 커밋 `feat(mobile): 연속 출석 보상 시트`

## Task 6: 문서

- [ ] README 게임 섹션 한 줄, `docs/ROADMAP` 백로그 "연속 출석 보상" 체크(문항 편집은 ⑤-2 로 분리 표기) → 커밋 `docs: 연속 출석 보상 README·ROADMAP 반영`

## 최종 검증

`cd backend && uv run pytest -p no:warnings` · `cd web_client && npx tsc --noEmit && VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build` · `cd mobile && npx tsc --noEmit && npm test`

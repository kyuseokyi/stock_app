# 연속 출석 마일스톤 보상 설계 스펙 (백로그 ⑤-1)

> 작성일: 2026-10-13 · 상태: 승인됨(사용자: "마일스톤 · 시즌당 1회" 선택 후 "진행")
> 선행: Phase 5b Streak(`services/streak_service.py`)·보상(`services/reward_service.grant_cash`)·퀘스트 수령 패턴(`services/quest_service.claim`), 6b/6c 게임 모달.

## 1. 정책
- 마일스톤: **3일 +100,000 · 7일 +300,000 · 14일 +700,000 · 30일 +2,000,000** (코드 상수 `STREAK_MILESTONES`).
- **시즌마다 마일스톤별 1회.** 지급 대상은 현재 ACTIVE·거래 가능 시즌 계좌(`season_is_tradable`).
- **수령 자격: 수령 시점 `current_streak >= milestone`** 이고, 마지막 활동일이 오늘 또는 어제(KST)여서 연속이 아직 살아 있을 것(끊긴 연속의 current_streak 는 다음 활동 전까지 남아 있으므로 날짜로 확인). `highest_streak`(시즌 무관 누적)은 쓰지 않는다.
- 관리자 플래그 `STREAK` 꺼짐 → 조회의 rewards 는 빈 배열, 수령은 503 `FEATURE_DISABLED`.
- 수동 수령(버튼). 자동 지급 없음.

## 2. 데이터
- 새 테이블 `streak_reward_claims`: `id`, `user_id`(FK users, CASCADE), `season_id`(FK game_seasons), `milestone`(int), `amount`(Numeric(15,2)), `claimed_at`(timestamptz, default now). **UniqueConstraint(user_id, season_id, milestone)**.
- Alembic 마이그레이션(down_revision = 현재 head) + `shared/game_models.py` 모델.

## 3. API (trading_game)
- `GET /api/game/streak/my` 응답에 `rewards: [{milestone, amount, claimed, claimable}]` **추가**(기존 필드 불변). 활성 시즌이 없으면 `rewards: []`. `claimable = 자격 충족 && not claimed`.
- `POST /api/game/streak/rewards/{milestone}/claim` → `{streak: StreakResponse(rewards 포함), cash_balance}`.
  - 오류(`detail: {code, message}`): 404 `UNKNOWN_MILESTONE`, 409 `NOT_REACHED`, 409 `ALREADY_CLAIMED`, 409 `NO_ACTIVE_SEASON`, 409 `PRICE_UNAVAILABLE`, 503 `FEATURE_DISABLED`.
  - 동시성: 계좌 행 잠금(퀘스트 수령과 동일) + 유니크 위반 시 `ALREADY_CLAIMED`. 지급 실패(RewardUnavailable) 시 claim 행도 롤백.
- 서비스 계층 `services/streak_reward_service.py`(라우터는 HTTP 매핑만).

## 4. 프론트
- **web**: `types/game.ts`(StreakReward, Streak.rewards), `api/game.ts`(`claimStreakReward`), `lib/gameErrors.ts` 문구(`NOT_REACHED` → "아직 연속 출석 일수가 부족해요", `UNKNOWN_MILESTONE` → "없는 보상이에요"), 헤더 Streak 칩을 버튼으로 → `StreakRewardModal`(마일스톤 4개: 진행 막대 `min(current,m)/m`, 금액, 상태 버튼 [보상 받기]/받음 ✓/진행 중, 안내 "연속이 끊기기 전에 받아야 해요"). 수령 성공 → 스토어 streak 갱신 + `refreshTrading()` + 토스트. 칩 노출 조건은 기존 유지(enabled && current ≥ 1).
- **mobile**: `features/game/types.ts`·`api.ts`·`lib/errors.ts`(+jest), `game-header.tsx` 칩 → `streak-reward-sheet.tsx`(기존 Sheet 사용). 동작·문구 web 과 동일.

## 5. 검증
- backend TDD: 자격 판정(오늘/어제/그제 활동, 마일스톤 경계), 미달 409, 중복 409, 시즌별 독립 수령, 플래그 꺼짐 503·rewards 빈 배열, 활성 시즌 없음, 시세 없음(PRICE_UNAVAILABLE 시 claim 행 미생성), 알 수 없는 마일스톤 404, 응답 기존 필드 불변. 전체 회귀.
- 마이그레이션: 로컬 docker PG 일회용 DB에서 upgrade/downgrade/upgrade·`alembic check`(컨트롤러).
- web tsc/build, mobile tsc/jest, 브라우저 스모크(일회용 DB에 user_streaks 행 조작으로 7일 상태 만들어 수령).
- 문서: README 게임 섹션 한 줄, ROADMAP 백로그 "연속 출석 보상" 체크(문항 편집은 ⑤-2 로 분리 표기).

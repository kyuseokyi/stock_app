# 주간 랭킹 설계 스펙

> 작성일: 2026-10-13 · 상태: 승인됨(사용자: 주기 A·주 경계 A·기록+보상 A·대상 A, "토스트도 넣어서 진행", "모바일앱도 에뮬레이터로 올려서 확인")
> 선행: 시즌 랭킹(`services/ranking_service.py`, Redis ZSET `game:season:{id}:ranking`), 보상 지급(`reward_service.grant_cash` — NAV 방식, 지급 전후 ROI 불변), 시즌 정산(`settlement.settle_due_season`, 매일 20:40), 랭킹 UI(web `LeaderboardModal.tsx`, mobile `leaderboard-sheet.tsx`).

## 0. 결정 사항
- 랭킹 구성: **주간 + 시즌(=월간, 시즌이 1일 09:00~말일 20:00)** + 명예의 전당. 일간 없음.
- 주: **월요일 09:00 KST ~ 다음 월요일 09:00 KST**, 시즌 시작·종료 시각으로 잘라낸다. 주 식별자 = 잘라내기 전 주 시작 월요일 날짜(`YYYY-MM-DD`). 시즌 첫 주의 기준 수익률은 0%.
- 기록 + 보상: 주 마감 시 Top 10 저장, 1·2·3위에 **500,000 · 300,000 · 200,000** 원 자동 지급(`grant_cash`). **시즌 마지막 주는 기록만**(보상 0).
- 순위 대상: 그 주에 랭킹이 갱신된 계좌(포지션 보유 틱 또는 주문/청산). 보상 대상: 그중 **그 주에 포지션을 연(`GamePosition.created_at` ∈ 주) 계좌**. 대상이 아닌 1~3위는 0원 기록, 다음 순위로 넘기지 않음.
- 보상 알림 **토스트** 포함(web·mobile).

## 1. 주간 수익률 계산
- `grant_cash` 가 원금을 `금액/(1+r)` 만큼 늘려 ROI 를 보존하므로 `1 + ROI/100` 은 좌당 가치(NAV)다.
- 주간 ROI(%) = `((1 + roi/100) / (1 + base/100) − 1) × 100`, 소수 4자리 반올림. 보상 지급은 주간 ROI 를 바꾸지 않는다.
- base(주 시작 시점 누적 ROI)는 **처음 갱신될 때 기록**한다: 그 주에 계좌가 처음 `update_rank` 될 때, 시즌 ZSET 의 **갱신 전 점수**(없으면 0)를 `HSETNX` 로 기준값 해시에 저장한 뒤 시즌 ZSET·주간 ZSET 을 ZADD 한다. 수익률은 `update_rank` 를 통해서만 바뀌므로 "이번 주 첫 갱신 직전 값 = 주 시작 시점 값"이다. HSETNX 가 ZADD 보다 먼저라 동시 갱신에서도 다른 갱신이 바꾼 점수가 기준값이 되지 않는다.
- 1 + base/100 ≤ 0(이론상 -100% 이하)이면 주간 ROI 는 0 으로 둔다.

## 2. 백엔드 (trading_game)
### 2.1 순수 함수·상수 `services/weekly_ranking.py`
- `week_bounds(now, season_start, season_end) -> tuple[date, datetime, datetime]`: (week_id, 잘라낸 시작, 잘라낸 끝). 입력은 aware datetime.
- `weekly_roi(roi, base) -> Decimal`.
- `REWARDS = {1: 500000, 2: 300000, 3: 200000}`, `ARCHIVE_TOP = 10`.
- Redis 키: `game:season:{sid}:week:{YYYY-MM-DD}:ranking`(ZSET), `game:season:{sid}:week:{YYYY-MM-DD}:base`(HASH). 둘 다 TTL 21일.

### 2.2 `ranking_service.update_rank` 확장
- 선택 키워드 인자 `season_window: tuple[datetime, datetime | None] | None = None` 추가. 호출부(`tick_listener._push_personal_pnl`, `sync_account_rank`)가 시즌의 (start_at, end_at)을 넘긴다. 미지정이면 주간 갱신을 건너뛴다(기존 호출·테스트 동작 유지).
- 주 판정 시각은 현재 시각(now)이며, now 가 잘라낸 주 창 밖(시즌 밖)이면 주간 갱신을 건너뛴다.
- 시즌 ZSET 동작·키는 불변.

### 2.3 마감 `close_week(db, redis, season, week_id, *, with_reward) -> dict`
- 주간 ZSET Top 10 → `weekly_ranking_results` 저장(닉네임 스냅샷). 이미 해당 (season_id, week_start) 행이 있으면 아무것도 하지 않음(멱등).
- with_reward 이면 1~3위 중 보상 대상에게 `grant_cash`, `reward_amount` 기록. 시세 없음(`RewardUnavailable`)이면 그 계좌는 0 기록 + 경고 로그.
- 한 트랜잭션으로 commit. 보상은 ROI 를 바꾸지 않으므로 랭킹 재동기화 불필요.
- Celery 태스크 `close_trading_week`, beat **매주 월요일 08:50 KST**: 활성 시즌의 지난주(now − 1일 시점의 주)를 `with_reward=True` 로 마감. 그 주가 이 시즌 시작 전이면 건너뜀.
- `settle_due_season`: 시즌 ZSET 삭제 전에 그 시즌 종료 직전 시점의 주를 `with_reward=False` 로 마감.

### 2.4 테이블 `weekly_ranking_results` (마이그레이션, down_revision `b8c9d0e1f2a3`)
`id` PK, `season_id` FK game_seasons, `week_start`(date), `rank`(int), `user_id` FK users, `nickname`(varchar 50, null), `weekly_roi`(Numeric(10,4)), `reward_amount`(Numeric(18,2), default 0), `notified_at`(timestamptz null), `created_at`. UNIQUE (season_id, week_start, rank), UNIQUE (season_id, week_start, user_id).

### 2.5 API (`routers/leaderboard.py`, 로직은 서비스)
- `GET /api/game/seasons/{id}/weekly-leaderboard` → `{week_start, start_at, end_at, entries:[{rank,user_id,nickname,weekly_roi}]}` Top 100(공개). 시즌 없음 404.
- `GET /api/game/seasons/{id}/weekly-my-rank` → `{rank, weekly_roi, total}`(인증, 없으면 null 들).
- `GET /api/game/weekly-results?season_id=&limit=` → 지난 주들 Top 3 묶음 `[{season_id, week_start, entries:[{rank,nickname,weekly_roi,reward_amount}]}]`(최신순, 공개, limit 기본 4·최대 20).
- `GET /api/game/weekly-rewards/unseen` → 내 미확인 보상(`reward_amount>0 AND notified_at IS NULL`) `[{id, week_start, rank, reward_amount}]`(인증).
- `POST /api/game/weekly-rewards/{id}/ack` → notified_at 설정(본인 것만, 아니면 404).
- 기존 응답(`leaderboard`, `my-rank`, `accounts/me`)은 변경하지 않는다.

## 3. web_client / mobile
- 랭킹 모달·시트 탭: **`주간 | 시즌 랭킹 | 명예의 전당`**, 기본 주간.
- 주간 탭: 기간 표시("10/12(월) 09:00 ~ 10/19(월) 09:00", 잘린 경우 잘린 시각), 내 주간 순위, Top 100(순위·닉네임·주간 수익률), 상단 "지난주 Top 3" 카드(보상액 표시), 안내 한 줄 "1~3위 50만·30만·20만 원 · 그 주 신규 주문 1회 이상 · 시즌 마지막 주는 기록만".
- 토스트: 게임 화면 진입 시 `weekly-rewards/unseen` 조회 → 항목마다 "🏅 지난주 N위! 보상 X원이 지급됐어요" 토스트 후 ack, 계좌 재조회. 기존 토스트 컴포넌트 재사용.
- API·타입 계층 분리(web `api/game.ts`·`types/game.ts`, mobile `features/game/api.ts`·`types.ts`), TS strict.

## 4. 검증
- backend TDD: `week_bounds`(월요일 09:00 경계, 08:59 는 전주, 시즌 시작/종료 잘림), `weekly_roi`(보상 전후 불변), update_rank 기준값(첫 갱신=이전 점수, 시즌 중간 참가=0, 두 번째 갱신은 기준 유지, 창 없음=주간 미갱신), close_week(Top10 저장, 보상 대상 필터, 멱등, 마지막 주 0원), API(공개/인증, ack 본인만), settle 시 마지막 주 기록.
- 마이그레이션: 로컬 docker PG 일회용 DB upgrade/downgrade/upgrade.
- web tsc/build, mobile tsc/jest.
- **모바일 에뮬레이터 실행 확인**(사용자 요청): Android 에뮬레이터 + dev build, Metro 8082, `adb reverse` 8000~8004·8082, 랭킹 시트 주간 탭·토스트 표시 확인(스크린샷).
- 문서: README 게임 섹션, ROADMAP.

# 시즌 기간 선택(월간/분기) + 월간 랭킹 + 보상 금액 admin 설정 설계 스펙

> 작성일: 2026-10-14 · 상태: 승인됨(사용자: "시분을 분기로 설정할수도 있을까?" → "운영자가 선택하는 방식으로 진행하고 싶어" → "보상 금액을 admin에서 바꿀 수 있게 해줘" → 설계안 제시 후 "진행해줘")
> 선행: `2026-10-13-weekly-ranking-design.md`(주간 랭킹 구조를 월간에 재사용).

## 0. 결정 사항 요약
- 시즌 기간은 운영자가 admin 에서 **다음 시즌 기간**(`month`|`quarter`)을 고른다. 진행 중 시즌은 바꾸지 않는다.
- **시즌 1기는 월간 유지**(10/31 20:00 KST 종료, seed 스크립트 backfill 그대로).
- 분기 시즌일 때만 **월간 랭킹**(기록 + 1~3위 보상)을 연다.
- 주간·월간·연속 출석 보상 금액을 admin 에서 바꾼다(다음 마감/다음 수령부터 적용, 지급된 기록은 `reward_amount` 그대로).
- 정산은 "종료일 당일 또는 그 이전 가장 최근 거래일 종가"로(주말·공휴일 말일 보류 버그 수정).

## 1. 정산 종가 보완(먼저 구현 — 10/31(토) 시즌 1기 정산에 필요)
- `apps/collector/tasks/settle_season.py` `clickhouse_close_price(ticker, end_at)`:
  - `end_date` = end_at 의 KST 날짜. `get_candles(ticker, end_date-10일, end_date)` 중 **날짜 ≤ end_date 인 마지막 봉**.
  - 봉이 없으면 None(보류).
  - `end_date` 가 평일(월~금)이고 마지막 봉 날짜 ≠ end_date 이면 → **당일 수집 실패 가능성**이므로 None(다음 실행 재시도). 단 `now ≥ end_at + 3일` 이면(평일 공휴일 등) 마지막 봉 종가로 정산.
  - 주말이면 마지막 봉(금요일 등) 종가.
- `settlement.settle_due_season` 은 `close_price_provider(season.ticker, end_at)` 로 호출(시그니처 변경, 테스트 대역 갱신).

## 2. 시즌 기간 `period`
- 마이그레이션: `game_seasons.period VARCHAR(10) NOT NULL server_default 'month'`(CHECK `period IN ('month','quarter')`). 기존 행은 `month`.
- `settlement.py` 기간 함수 일반화:
  - `season_bounds(start_month_ref, period)`: 시작 = ref 가 속한 달 1일 09:00 KST, 끝 = `month` 이면 그 달 말일 20:00, `quarter` 면 **그 달이 속한 분기의 마지막 달(3·6·9·12월) 말일 20:00**. 분기 중간에 시작하면 그 분기 말까지(예: 11월 시작 분기 시즌 = 11/1~12/31).
  - `next_season_bounds(prev_end_at, period)`: prev_end_at(KST) 의 다음 달을 시작 달로 `season_bounds`.
  - 기존 `month_bounds`/`next_month_bounds` 는 호환용으로 유지.
- 차기 시즌 생성 시 `period = game_settings.next_season_period`(없으면 `month`).
- seed 스크립트 동작 불변(시즌 1기 month).
- 시즌 응답 DTO 에 `period` 추가(기존 필드 불변). D-day·종료 문구는 서버 `end_at` 기준(클라이언트에서 "말일" 가정 금지 — 있으면 수정).

## 3. 설정 저장소 `game_settings`
- 새 테이블 `game_settings(key VARCHAR(64) PK, value JSON NOT NULL, updated_at timestamptz)`(PG 는 JSONB, SQLite 테스트 호환 타입 사용).
- 키·기본값(행 없으면 기본값):
  - `next_season_period`: `"month"`
  - `weekly_rewards`: `[500000, 300000, 200000]`(1~3위)
  - `monthly_rewards`: `[1500000, 900000, 600000]`
  - `streak_rewards`: `{"3": 100000, "7": 300000, "14": 700000, "30": 2000000}`(마일스톤 집합은 고정, 금액만 변경)
- 서비스 `services/game_settings_service.py`: `get_settings(db)`(기본값 병합), `update_settings(db, patch)`. 검증: 금액은 0 이상 정수, 최대 100,000,000. 기간은 month|quarter. 잘못된 값 422.
- 기존 상수(`weekly_ranking.REWARDS`, `STREAK_MILESTONES`)는 **기본값 정의로 남기고**, 지급 시점에 설정값을 읽어 쓴다.
- 연속 출석 보상은 **시즌당 1회** 규칙 유지(금액만 설정값).

## 4. 월간 랭킹(분기 시즌 전용)
- 순수 로직: 월 구간 = **매월 1일 09:00 KST ~ 다음 달 1일 09:00 KST**, 시즌 창으로 잘림. `month_id` = 그 달 1일 date.
- Redis: `game:season:{sid}:month:{YYYY-MM-01}:ranking`(ZSET), `…:base`(HSETNX 기준값, 주간과 같은 NAV 비율 ROI). TTL 100일.
- `ranking_service.update_rank`: 시즌 `period == 'quarter'` 일 때만 월간 ZSET 도 갱신(주간과 같은 경로). 포지션 캐시의 시즌 창 정보에 `period` 포함.
- 마감 `close_month(db, redis, season, month_id, with_reward)`: 주간 `close_week` 와 같은 규칙 — Top 10 기록, 1~3위 중 **그 달 구간에 포지션을 연 계좌**에만 `monthly_rewards` 지급, 탈퇴 유저 건너뛰기, 멱등, IntegrityError 시 롤백.
- Celery beat `close-trading-month`: **매월 1일 08:55 KST**(주간 08:50 과 분리). 활성 시즌이 quarter 이고 지난달 구간이 시즌과 겹치면 마감. 잘린 끝 = 시즌 종료(정산 지연)면 기록만.
- 정산(`settle_due_season`)에서 quarter 시즌이면 **시즌 마지막 달을 기록만**(보상 없음), 실패해도 정산은 계속(주간과 동일 패턴).
- 결과 저장: 기존 `weekly_ranking_results` 테이블에 **`period_type VARCHAR(10) NOT NULL server_default 'week'`** 컬럼 추가, 월간은 `week_start` 에 그 달 1일 저장. 유니크 제약을 `(season_id, period_type, week_start, rank)`·`(…, user_id)` 로 교체. (설계안의 `ranking_results` 일반화와 같은 효과를 테이블 이름 변경 없이 — 기존 API·탈퇴 익명화 코드 회귀 방지.) 기존 주간 조회·마감 쿼리는 `period_type='week'` 조건 추가.
- API(주간과 대칭, 기존 주간 API 불변):
  - `GET /seasons/{id}/monthly-leaderboard` → `{month_start, start_at, end_at, entries[{rank,user_id,nickname,monthly_roi}]}`
  - `GET /seasons/{id}/monthly-my-rank` → `{rank, monthly_roi, total}`
  - `GET /monthly-results?season_id&limit` → 지난달들의 Top 3
  - 미확인 보상 `GET /weekly-rewards/unseen` 응답 항목에 `period_type` 추가(월간 보상도 포함), ack 는 기존 엔드포인트 공용.
  - 공개 `GET /reward-config` → `{weekly:[...3], monthly:[...3], streak:{"3":..}}`(클라이언트 안내 문구용).
- 월간 시즌이면 월간 API 는 빈 결과(에러 아님).

## 5. admin
- API: `GET/PUT /api/game/admin/settings`(기존 admin 권한 의존성 재사용).
- admin_web "게임 설정"(기존 기능 플래그 화면 옆 섹션 또는 새 페이지): 다음 시즌 기간 라디오(월간/분기 + 설명 "분기 중간에 시작하면 그 분기 말까지"), 보상 금액 표(주간 1~3위, 월간 1~3위, 연속 출석 3·7·14·30일), 저장 버튼, 안내 "다음 마감·다음 수령부터 적용, 진행 중 시즌 기간은 바뀌지 않음". 현재 시즌 번호·기간·종료일 표시.

## 6. 클라이언트(web_client·mobile)
- 랭킹 탭: 시즌 `period === 'quarter'` 이면 `주간 | 월간 | 시즌 | 명예의 전당`, 아니면 기존 그대로.
- 월간 탭: 주간 탭 구성 재사용(현재 달 순위·내 순위·지난달 Top 3).
- 보상 토스트: `period_type === 'month'` 이면 "지난달 월간 랭킹 N위 보상 X원" 문구.
- 보상 안내 문구(주간 "1~3위 …", 연속 출석 금액)는 `/reward-config` 값으로 표시, 실패 시 기본값.
- 금액 표기 "500,000원" 형식 유지. 파스텔 C안 디자인 유지.

## 7. 검증
- backend TDD: 종가 선택(주말 말일·평일 당일 없음 보류·3일 후 허용), season_bounds(month/quarter/분기 중간 시작/12월→다음 해), 차기 시즌 period 설정 반영, settings 기본값·검증·저장, 월간 구간·키·update_rank(quarter 만), close_month(보상 대상·멱등·탈퇴 건너뛰기·마지막 달 기록만), 주간 회귀(period_type 분리), 주간·스트릭 보상이 설정 금액 사용, API(월간 3종·reward-config·admin settings 권한).
- 전체 pytest, 마이그레이션은 로컬 docker PG 일회용 DB 에서 upgrade/downgrade/upgrade.
- admin_web/web_client tsc·build, mobile tsc·jest.
- 로컬 스모크(일회용 DB + Redis DB5): admin 설정 저장 → quarter 시즌 수동 생성 → web/에뮬레이터 랭킹 탭 4개 확인, 끝나면 정리.
- 문서: README 게임 섹션, pending_checks(시즌 운영 문구: 월간/분기), ROADMAP.

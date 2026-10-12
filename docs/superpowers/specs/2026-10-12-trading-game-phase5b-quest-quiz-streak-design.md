# 트레이딩 게임 Phase 5b — 퀘스트·아카데미·야간 차트 퀴즈·Streak 설계 스펙

> 작성일: 2026-10-12 · 상태: 승인됨
> 원 지시서: `docs/prompts/trading_game/05_phase5_coach_quest_admin.md` §3(퀘스트·아카데미), §4(퀴즈·Streak)
> 기획: `docs/trading_game_plan.md` §3.2·3.3·3.5, §6.7·6.8
> 선행: Phase 5a(코치·넛지) 완료·main 머지(`67f7d13`).

## 0. 확정된 결정

| 항목 | 결정 |
|---|---|
| 보상 처리 | **원금 동반 가산(펀드 입금 방식)**: 보상 b 지급 시 `cash_balance`·`total_asset`은 b 증가, 원금 조정분 `bonus_cash`는 `b / (1 + r/100)` 증가 — r 은 지급 시점 ROI로, 포지션 보유 중이면 최신가 평가 실시간 ROI(랭킹과 같은 마크), 없으면 실현 `current_roi`. 원금 = `INITIAL_CASH + bonus_cash`, ROI = (자산 − 원금)/원금. → 지급 직후 (실시간) ROI가 불변(같은 금액을 원금에 더하면 ROI가 0 쪽으로 희석되는 문제를 피함). 보유 중 시세 없음 → 퀘스트 409 `PRICE_UNAVAILABLE`(미수령 유지·재시도) / 퀴즈 보상 생략. |
| 퀘스트 | Q1 손절선 걸고 첫 거래(+50만) / Q2 골든크로스 LONG 진입(+100만) / Q3' 최소 비중(25% 이하) 진입 3회('원칙주의자' 배지 — 주문 비중 선택지가 25/50/100%뿐이라 기획서의 20%는 달성 불가하므로 최소 선택지 25%로 정의). 원안 Q4(랭킹 보너스)는 랭킹 오염이라 제외. 진행도는 **유저 단위 영구 1회성**, 보상은 **수령 시점 활성 시즌 계좌**로 지급. |
| 퀴즈 출처 | ClickHouse 일봉 기반 **자동 생성 스크립트**(관리자 입력 없음) |
| 기능 on/off | **어드민 토글** — `game_feature_flags` 테이블(QUIZ, STREAK), 재시작 없이 즉시 반영 |
| Streak | KST 하루 중 **주문 1회 이상 또는 퀴즈 제출 1회 이상**이면 유지. 별도 on/off. |
| 아카데미 | **즉시 잠금**: 리스크 관리 3문항(코드 고정) 전부 정답 시 `unlocked_leverage_5x`. 미해금 5배 주문은 403. 기존 열린 5배 포지션은 유지. 재응시 무제한. |
| 퀴즈 보상 한도 | 정답 +20만, **KST 하루 3회까지**. 계좌 행 잠금(FOR UPDATE)으로 유저별 직렬화 — 동시 제출에도 한도 유지 |
| 퀴즈 제한시간 | 서버 검증: `served_at` 기준 **10초 + 여유 3초** 초과 제출은 오답 |

## 1. DB 변경 (Alembic 마이그레이션 1개, down_revision `c3d4e5f6a7b8`)

| 테이블/컬럼 | 정의 |
|---|---|
| `game_accounts.bonus_cash` | `Numeric(15,2) NOT NULL server_default '0'`. 기존 계좌는 0 → ROI 결과 불변(하위 호환). |
| `user_quest_progress` | PK(`user_id` FK users.id CASCADE, `quest_code` String(30)), `progress` Integer default 0, `completed_at` timestamptz NULL, `claimed_at` timestamptz NULL |
| `user_badges` | PK(`user_id`, `badge_code` String(30)), `awarded_at` timestamptz server_default now() |
| `user_academy` | PK `user_id`, `unlocked_leverage_5x` Boolean default false, `passed_at` timestamptz NULL, `attempts` Integer default 0 |
| `chart_quiz_pool` | `id` Serial PK, `ticker` String(20), `base_date` Date, `pattern_type` String(50), `chart_snapshot` JSON(OHLCV 배열), `answer` String(10) ('UP'/'DOWN'), `actual_change` Numeric(6,2), `explanation` Text, `reward_cash` Integer default 200000, `created_at`. **유니크 `(ticker, base_date)`** |
| `user_quiz_attempts` | PK(`user_id`, `quiz_id` FK chart_quiz_pool CASCADE), `served_at` timestamptz, `choice` String(10) NULL, `is_correct` Boolean NULL, `rewarded` Boolean default false, `reward_date` Date NULL(보상 지급 KST 날짜 — 일일 3회 한도 집계용), `submitted_at` timestamptz NULL |
| `user_streaks` | PK `user_id`, `current_streak` Integer default 0, `highest_streak` Integer default 0, `last_activity_date` Date NULL |
| `game_feature_flags` | PK `key` String(30), `enabled` Boolean, `updated_at` timestamptz. 마이그레이션에서 `QUIZ`·`STREAK`를 `enabled=true`로 시드. |

ORM은 `shared/game_models.py`에 추가한다. 검증은 일회용 로컬 docker PG에서 upgrade → `alembic check` → downgrade → 재upgrade(dev 터널 DB는 건드리지 않는다).

## 2. ROI 분모 변경 (원금 동반 가산)

`INITIAL_CASH`로 나누는 곳을 모두 `INITIAL_CASH + acc.bonus_cash`로 바꾼다.
- `services/order_engine.py` `close_position`의 `roi_acc`
- `services/tick_listener.py`의 `compute_live_roi(..., INITIAL_CASH)` 호출 → 분모 인자에 `INITIAL_CASH + acc.bonus_cash`
- 헬퍼 `principal(acc) -> Decimal`을 `reward_service`에 두어 한곳에서 계산한다(order_engine·tick_listener가 import — 의존 방향 단순화).

보상 지급은 `reward_service.grant_cash(db, account, amount, *, redis)` 하나로 통일한다: 계좌 행을 `SELECT ... FOR UPDATE`로 잠그고 최신값으로 재적재한 뒤, `cash_balance`·`total_asset`은 `amount`, `bonus_cash`는 `amount / max(1 + r/100, 0.01)`(0.01원 반올림)만큼 원자적 UPDATE로 증가시킨다. r 은 '현재 NAV' 기준 ROI — OPEN 포지션이 없으면 `current_roi`, 있으면 시즌 종목의 최신가(`market_clock.read_latest`, 신선도 무관 — 랭킹과 같은 마지막 평가가)로 `ranking_service.compute_live_roi`. 보유 중인데 최신가가 없으면 `RewardUnavailable` → 퀘스트 수령은 rollback 후 409 `PRICE_UNAVAILABLE`(미수령 유지, 잠시 후 재시도), 퀴즈는 제출만 기록하고 보상 생략(`rewarded=false`, 경고 로그). `current_roi`는 건드리지 않는다. 보상은 거래 가능한 시즌(`season_is_tradable`: ACTIVE 이고 `end_at` 미경과)의 계좌에만 지급 — 정산 대기 시즌이면 퀘스트 `NO_ACTIVE_SEASON`, 퀴즈 보상 없음.

근거: 현재 자산 A = P(1+r)일 때 원금을 P' = P + b/(1+r)로 두면 (A+b)/P' = 1+r → ROI 불변. 같은 금액 b를 원금에 더하면 (A−P)/(P+b)로 0 쪽으로 희석되어, 마이너스 계좌가 보상만으로 순위가 오르는 악용이 생긴다. 포지션 보유 중에 실현 ROI를 쓰면 같은 악용이 생긴다(예: 실현 0%·실시간 −80% 계좌에 2,100,000 지급 시 실시간 ROI 약 −66%로 개선, 청산하면 그대로 확정) — 그래서 보유 중에는 실시간 ROI로 원금을 늘린다. 지급 이후의 손익은 늘어난 원금 기준으로 측정된다(펀드 입금과 동일). 1+r 하한 0.01은 ROI −100%(자산 0) 방어.

시즌 정산의 명예의 전당 순위는 `total_trades > 0` 계좌만 대상 — 퀴즈·퀘스트 보상만 받은 무거래 계좌(ROI 0%)가 손실 낸 실제 플레이어보다 앞서 자리를 차지하지 않게 한다.

## 3. 유저 API (trading_game 8003, 로그인 필수)

Router → Service → ORM. 신규 라우터 `routers/quests.py`, `routers/academy.py`, `routers/quiz.py`(streak 포함)를 `main.py`에 등록.

| 엔드포인트 | 동작 |
|---|---|
| `GET /api/game/quests` | Q1·Q2·Q3' 각각 `code, title, description, reward_cash 또는 reward_badge, progress, target, completed, claimed` + 보유 배지 목록 |
| `POST /api/game/quests/{code}/claim` | 미달성 409 `QUEST_NOT_COMPLETED`, 수령됨 409 `ALREADY_CLAIMED`, 활성(거래 가능) 시즌 없음 409 `NO_ACTIVE_SEASON`, 보유 포지션 시세 없음 409 `PRICE_UNAVAILABLE`, 알 수 없는 코드 404. `UPDATE ... SET claimed_at=now() WHERE claimed_at IS NULL AND completed_at IS NOT NULL`의 rowcount로 중복 방지 후 `grant_cash` 또는 배지 지급. 응답: 갱신된 퀘스트 + 계좌 잔고 |
| `GET /api/game/academy/quiz` | 3문항(`id, question, choices[]`) — 정답 제외. `unlocked` 여부 포함 |
| `POST /api/game/academy/submit` | `{answers: {id: choice_index}}`. 전부 정답이면 `unlocked_leverage_5x=True, passed_at=now()`. 응답: 문항별 정오·해설, `unlocked`. `attempts`+1 |
| `GET /api/game/quiz/random` | QUIZ off → 503 `FEATURE_DISABLED`. 시도하지 않은 퀴즈 1개를 무작위 선택, `user_quiz_attempts`(served_at=now) 삽입. 응답: `id, chart_snapshot(날짜 제거·첫 종가=100 정규화), time_limit_sec=10` (ticker 제외 — 정답 검색 방지; answer·actual_change·explanation·pattern_type 제외). 남은 문제 없음 → 404 `NO_QUIZ_AVAILABLE` |
| `POST /api/game/quiz/{id}/submit` | `{choice: 'UP'|'DOWN'}`. QUIZ off → 503. 시도 행 없음 → 409 `QUIZ_NOT_SERVED`, 이미 제출 → 409 `ALREADY_SUBMITTED`. `now - served_at > 13초`면 오답(`timed_out=true`). 정답 + 오늘(KST) 보상 3회 미만 + 활성 시즌 있음 → `grant_cash(reward_cash)`, `rewarded=true`. Streak 갱신. 응답: `correct, answer, actual_change, pattern_type, explanation, rewarded, reward_cash, timed_out, ticker, base_date, streak` (제출 후 종목·기준일 공개) |
| `GET /api/game/streak/my` | `current_streak, highest_streak, last_activity_date, enabled` |

5배 레버리지 잠금: `POST /api/game/orders`에서 `leverage == 5`이고 `user_academy.unlocked_leverage_5x`가 아니면 주문 처리 **전에** 403 `LEVERAGE_LOCKED`. 1·2배 주문 경로는 변경 없음.

## 4. 어드민 기능 설정

- API: `GET /api/game/admin/feature-flags`, `PUT /api/game/admin/feature-flags/{key}` (`{enabled: bool}`), `require_admin`. 알 수 없는 key 404.
- `feature_flag_service.is_enabled(db, redis, key)`: Redis `game:flag:{key}` 30초 캐시, 미스 시 DB 조회. PUT 시 캐시 삭제. Redis 오류 시 DB 직접 조회(실패해도 기능 판정은 계속).
- admin_web: `src/pages/TradingGameSettings.tsx`, 사이드바 "트레이딩 게임 > ⚙️ 기능 설정", 라우트 `game/settings`. 야간 퀴즈·연속 출석 토글 스위치, 토글 중 비활성화, 실패 시 토스트 후 원상복구. `gameClient`가 null이면 5a와 같은 "게임 서버 미연결" 안내. 모든 비제출 버튼 `type="button"`.

## 5. 이벤트 훅 (best-effort)

주문 성공 직후(`routers/orders.py` POST /orders), 넛지 계산과 같은 위치에서 각각 독립 try/except:
- `quest_service.on_order_opened(db, user_id, *, side, ratio, stop_loss_price, ticker, entry_price)`
  - Q1: `stop_loss_price`가 있으면 완료
  - Q3': `ratio <= 0.25`면 progress+1, 3 도달 시 완료
  - Q2: `side == 'LONG'`이고 골든크로스 조건이면 완료. 일봉 종가(오늘 이전, 5a `rsi_service`의 ClickHouse 경로·캐시 재사용) + 현재가로 MA5·MA20을 계산하여 **최근 3거래일 이내(오늘 포함)에 MA5가 MA20을 아래→위로 교차**했고 현재 MA5 > MA20이면 성립. CH 조회는 `asyncio.wait_for(2초)`, 실패·지연 시 Q2 판정만 생략.
  - 이미 완료된 퀘스트는 건드리지 않는다.
- `streak_service.touch(db, user_id, today=kst_today())` — STREAK off면 no-op.

퀴즈 제출 시에도 `streak_service.touch`를 호출한다.

Streak 규칙(KST 날짜): `last_activity_date == today` → 변화 없음 / `== today-1` → +1 / 그 외(NULL 포함) → 1. `highest_streak = max(highest, current)`.

## 6. 퀴즈 자동 생성 스크립트

`backend/scripts/generate_chart_quiz.py` (`uv run python -m scripts.generate_chart_quiz --count 50`)
- ClickHouse `daily_prices FINAL`에서 종목·기준일을 무작위 추출, 기준일까지 **60봉**을 `chart_snapshot`으로, 이후 **5봉** 종가 변동률을 `actual_change`로.
- `|actual_change| < 1%`는 버린다(애매한 문제 제외). 양수 → `UP`, 음수 → `DOWN`.
- `pattern_type`·`explanation`은 규칙 기반 템플릿: 기준일 RSI(14) 구간(과매수 ≥70 / 과매도 ≤30 / 중립), MA5·MA20 관계(골든크로스·데드크로스·정배열·역배열)를 조합. 순수 함수 `build_explanation(closes) -> (pattern_type, explanation_md)`로 분리해 테스트한다.
- `(ticker, base_date)` 유니크 충돌은 건너뛰어 재실행해도 중복 없음. 생성·건너뜀 개수 출력.
- 운영 DB 실행 금지 주석(시드 스크립트와 동일 관례).

## 7. 오류 처리 요약

| 상황 | 응답 |
|---|---|
| 미해금 5배 주문 | 403 `LEVERAGE_LOCKED` |
| 퀴즈 꺼짐 | 503 `FEATURE_DISABLED` |
| 남은 퀴즈 없음 | 404 `NO_QUIZ_AVAILABLE` |
| 미배정/재제출 | 409 `QUIZ_NOT_SERVED` / `ALREADY_SUBMITTED` |
| 퀘스트 수령 실패 | 409 `QUEST_NOT_COMPLETED` / `ALREADY_CLAIMED` / `NO_ACTIVE_SEASON`, 404 미지정 코드 |
| 보상 시세 없음(포지션 보유 중 최신가 없음) | 퀘스트 409 `PRICE_UNAVAILABLE`(미수령 유지, 잠시 후 재시도) / 퀴즈는 보상 생략(`rewarded=false`) |

퀘스트·Streak 훅 예외는 로그만 남기고 주문 응답은 성공. 해금 검사만 필수 경로.

## 8. 테스트 (`backend/tests/test_quest_quiz_streak.py`, aiosqlite)

- ROI 불변: 양수·음수·0 ROI 계좌에서 보상 전후 실현 ROI `(자산−원금)/원금` 동일, 이후 청산 `current_roi`가 원금 기준으로 계산됨, ROI −100% 하한
- 퀘스트: Q1, Q2(교차 3거래일 이내 성립 / 4거래일째 불성립 / SHORT 불성립 / CH 실패 시 생략), Q3' 진행도, 중복 수령 방지, 활성 시즌 없음 409, 배지 지급
- 아카데미: 전부 정답 해금, 1개 오답 미해금, 미해금 5배 403, 1·2배 영향 없음, 해금 후 5배 성공
- 퀴즈: 응답에 answer/explanation 미포함, 푼 문제 재출제 없음, 13초 초과 오답, 하루 보상 3회 제한, off 시 503, 미배정 409
- Streak: 같은 날 유지, 다음 날 +1, 공백 후 1, KST 자정 경계, off 시 미갱신, 주문·퀴즈 양쪽 훅
- 기능 설정: 비관리자 403, 토글 시 캐시 무효화, 미지정 key 404
- 생성 스크립트: `build_explanation` 분기, ±1% 미만 제외, 유니크 중복 건너뜀
- 회귀: 기존 150개 전부 통과. 단 `test_coach_and_nudge.py`의 라우터 5배 주문 테스트 2건(`test_open_order_returns_warning_and_advice`, `test_open_order_rsi_timeout_keeps_overleverage`)은 잠금 정책상 **해금 시드 후 주문**하도록 수정한다(의도된 동작 변경).
- 훅 순서: 주문 응답 DTO를 먼저 만든 뒤 훅을 실행한다(훅 실패 시 rollback이 세션 객체를 expire시켜도 응답에 영향 없음).
- admin_web: `tsc --noEmit` + build, 기능 설정 화면 브라우저 스모크(일회용 PG)

## 9. 문서

- README trading_game 섹션: 5b API, 기능 플래그, 퀴즈 생성 스크립트 사용법.
- ROADMAP: 5b 완료 반영.

## 10. 범위 밖

유저 프론트(web_client·mobile)의 퀘스트·퀴즈·Streak UI(서브페이즈 6), 연속 출석 보상, Q4 랭킹 보너스, 퀴즈·아카데미 문항 어드민 편집, 퀴즈 생성 정기 스케줄(Celery beat), trading_game 운영 배포.

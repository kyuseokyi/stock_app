# 트레이딩 게임 Phase 4 — 실시간 랭킹 + 시즌 정산 + Trading MBTI 설계 (Spec)

> 작성일: 2026-10-12
> 상위 기획: `docs/trading_game_plan.md`, 단계 프롬프트: `docs/prompts/trading_game/04_phase4_ranking_season_settlement.md`
> 선행: Phase 1(모델 `game_accounts`/`hall_of_fame` 등) · Phase 2(수집 데몬 `stock:tick:*`·`stock:latest:*`) · Phase 3(주문/체결 엔진, 청산 시 `current_roi`/`total_asset`/`max_roi` 갱신) 완료
> 대상: `backend/` (Redis ZSET · Celery · async SQLAlchemy · ClickHouse)

---

## 1. 개요 & 범위

ACTIVE 시즌의 **실시간 랭킹**(Redis ZSET, Top 100)을 제공하고, 시즌 종료 시 **정산 스케줄러**(전액 강제청산 → 최종순위 확정 → 명예의 전당 박제 → 차기 시즌 생성)를 Celery로 자동 실행하며, 각 유저의 **Trading MBTI**를 산출한다.

### 1.1 산출물
- `apps/trading_game/services/ranking_service.py` — ZSET 갱신/조회(순수+Redis)
- `apps/trading_game/services/mbti_analyzer.py` — 매매 성향 분류(순수 함수)
- `apps/trading_game/services/settlement.py` — 정산 파이프라인(멱등)
- `apps/trading_game/routers/leaderboard.py` — 랭킹/명예의전당 REST
- `apps/collector/tasks/settle_season.py` — Celery 태스크(일 1회 말일 판별)
- `apps/collector/celery_app.py` 수정 — beat 스케줄 등록(매일 20:40 KST)
- `apps/trading_game/services/tick_listener.py` 수정 — 매 틱 라이브 ROI `ZADD`
- `apps/trading_game/services/order_engine.py` 수정 — 청산 시 실현 ROI `ZADD`
- `apps/trading_game/main.py` 수정 — leaderboard 라우터 마운트
- `tests/test_ranking_and_settlement.py` — 단위 테스트

### 1.2 범위 밖(명시적 제외 / 추후)
- 지인 리그(Private League) — 후속 서브페이즈(테이블·초대코드·리그 리더보드)
- 프론트 랭킹/MBTI 화면 — Phase 6
- 무기한(`end_at=NULL`) 시즌 자동정산 — 월간 시즌만 대상
- 코치/퀘스트/차트퀴즈 — Phase 5

---

## 2. 확정된 설계 결정

### 2.1 시즌 주기 = 월간 고정
매월 1일 09:00 KST 시작 ~ 말일 20:00 KST 종료(`end_at`). `end_at=NULL`(무기한) 시즌은 자동정산 대상에서 제외한다.

### 2.2 정산 시각 = 매일 20:40 KST 실행, 말일 자동 판별
Celery beat를 **매일 20:40**에 돌리고, 태스크가 "ACTIVE 시즌이 있고 `now ≥ season.end_at`"일 때만 정산한다. "매월 말일"을 cron 월길이 계산 없이 처리한다.
**20:40인 이유(정산 가격 확보):** 애프터마켓은 20:00 종료라 `stock:latest`는 TTL(120s) 만료 상태 → 강제청산가가 없다. 20:30 일봉 수집 이후인 20:40에 실행해 **ClickHouse `daily_prices` 당일 종가(FINAL)** 를 강제청산가로 쓴다.

### 2.3 강제청산 가격 소스
정산의 전액청산가 = **ClickHouse `daily_prices`의 해당 시즌 종목 당일 종가(FINAL)**.
폴백: 당일 종가 미존재 시 KIS REST 현재가(`apps/collector/kis/client.py` 재사용). 둘 다 없으면 정산 중단+로그(시즌 ACTIVE 유지, 멱등이라 익일 20:40 재시도).

### 2.4 실시간 랭킹 = 라이브(미실현 포함)
Redis ZSET `game:season:{season_id}:ranking`, member=`user_id`(str), score=`current_roi(%)` float.
- **라이브:** tick_listener가 매 틱, 보유 포지션자의 **미실현 평가 ROI**를 계산해 `ZADD`.
- **청산:** `order_engine.close_position`이 실현 `current_roi`로 `ZADD`.
ZSET은 휘발성 실시간 소스, DB `current_roi`는 청산/정산 체크포인트. 정산(전액청산) 후 둘이 일치한다.

### 2.5 라이브 ROI 계산(순수)
`compute_live_roi(cash_balance, open_pos_or_none, price, initial_cash) -> Decimal(%)`:
- 보유 포지션 있으면 `total_asset = cash_balance + (size_amount + unrealized_pnl)` (unrealized_pnl = `pricing.compute_pnl(size, compute_roi_pct(side, entry, price, lev))`, 원금손실 클램프 동일 적용).
- 없으면 `total_asset = cash_balance`.
- `roi = (total_asset - initial_cash) / initial_cash * 100`, 소수 4자리.

---

## 3. 컴포넌트 & 인터페이스

### 3.1 `services/ranking_service.py`
- `async update_rank(redis, season_id, user_id, roi: Decimal) -> None`: `ZADD game:season:{id}:ranking {roi} {user_id}`.
- `async top_leaderboard(redis, db, season_id, limit=100) -> list[dict]`: `ZREVRANGE ... WITHSCORES` → User 닉네임·계좌 요약(total_asset·win_rate) 조인. 반환 `{rank, user_id, nickname, roi_pct, total_asset, win_rate}`.
- `async my_rank(redis, season_id, user_id) -> dict | None`: `ZREVRANK`(+1), `ZCARD`로 백분위, `ZSCORE`로 roi. 미등록이면 None.
- `ranking_key(season_id) -> str` 헬퍼.

### 3.2 `services/mbti_analyzer.py` (순수 함수)
`classify_mbti(trades: list[GameTrade]) -> str`. 거래 `total < 3`이면 기본 라벨 `"균형 탐색가"`.
임계·우선순위(첫 매치 반환):
1. **불나방 트레이더**: `entry_ratio==1.0` 거래 비율 ≥ 0.5 AND 평균 보유시간(`closed_at - opened_at`) < 600초.
2. **냉철한 원칙주의자**: `had_stop_loss` 거래 비율 ≥ 0.7.
3. **빅쇼트의 후예**: SHORT 이익 기여 비중(`Σ pnl>0 중 SHORT / Σ pnl>0`) ≥ 0.6 (SHORT 이익거래 ≥1).
4. **황소 저격수**: LONG 승률(LONG 중 `pnl>0` 비율) ≥ 0.6 (LONG 거래 ≥1).
5. 그 외 → `"균형 탐색가"`.

### 3.3 `services/settlement.py`
`async settle_due_season(db, redis, close_price_provider) -> dict | None`:
1. `get_active_season`; 없거나 `end_at is None` 또는 `now < end_at` → None(정산 안 함).
2. `status != 'ACTIVE'` 재확인(멱등 가드).
3. 종가 = `close_price_provider(ticker)`; None이면 중단(로그) → None.
4. 해당 시즌 모든 OPEN 포지션 → `order_engine.close_position(reason='SEASON_END', exit_price=종가)` 순회.
5. 계좌 `current_roi DESC` 상위 100 → `hall_of_fame` 적재(rank, user_id, user_nickname, final_roi=current_roi, final_asset=total_asset, win_rate=win_trades/total_trades*100, trading_mbti=classify_mbti(해당 유저 trades)). `uq_hof_season_rank`/`uq_hof_season_user`로 멱등(이미 있으면 skip).
6. 시즌 `status='FINISHED'`.
7. 차기 시즌 생성: `season_number+1`, 동일 ticker/stock_name, `start_at`=익월 1일 09:00 KST, `end_at`=익월 말일 20:00 KST, `status='ACTIVE'`, `initial_cash=INITIAL_CASH`. `uq_season_number` 충돌 시 skip(멱등).
반환 요약 dict(정산 시즌번호·청산수·적재수·차기시즌번호).

### 3.4 `routers/leaderboard.py` (prefix `/api/game`)
- `GET /seasons/{season_id}/leaderboard` → `top_leaderboard` Top100.
- `GET /seasons/{season_id}/my-rank` → 인증 유저 `my_rank`(미등록이면 `{rank: null, roi_pct: null}`).
- `GET /hall-of-fame?season_id=`(옵션) → 마감 시즌 박제 조회(시즌 미지정 시 최근 FINISHED들).

### 3.5 `tasks/settle_season.py` (Celery)
`@celery_app.task(name="settle_trading_season")` → sync 래퍼가 async `settle_due_season` 실행(`asyncio.run` 또는 기존 collector 태스크의 async 실행 패턴 재사용). 종가 provider = ClickHouse 당일 종가 조회(폴백 KIS REST). beat: `celery_app.py`에 `crontab(minute=40, hour=20)` Asia/Seoul 등록(기존 20:30 수집 스케줄 옆).

### 3.6 tick_listener / order_engine 수정(최소)
- tick_listener 보유자 처리에서 `compute_live_roi` → `ranking_service.update_rank`. 계좌 `cash_balance`도 함께 조회하도록 쿼리 확장.
- order_engine `close_position` 성공 후 season_id/user_id 로 `ranking_service.update_rank(redis, season_id, user_id, acc.current_roi)`. Redis 핸들 주입은 구현 시 결정(close_position에 optional redis 인자, 또는 호출부에서 ZADD — 엔진 의존성 최소화 우선).

---

## 4. 데이터 흐름
```
[틱] tick_listener ─ 보유자 live ROI ─► ranking_service.update_rank(ZADD)
[청산] order_engine.close_position ─ 실현 ROI ─► ZADD
[조회] leaderboard 라우터 ─► ranking_service(ZREVRANGE/ZREVRANK) + DB 닉네임/계좌
[말일 20:40] Celery settle_season ─► settlement.settle_due_season
     └ ClickHouse 종가 → 전액 강제청산 → hall_of_fame 적재(+MBTI) → FINISHED → 차기시즌
```

## 5. 에러 처리
- 종가 미확보 → 정산 중단+로그, 시즌 ACTIVE 유지(멱등 재시도).
- 정산 재실행 → FINISHED/`uq_*` 가드로 중복 적재·중복 차기시즌 방지(멱등).
- Redis 장애(ZADD/조회) → 랭킹은 로그 후 skip(틱/청산 본 로직 유지), 조회는 503.
- MBTI 거래 0~2건 → 기본 라벨.

## 6. 테스트 (`tests/test_ranking_and_settlement.py`)
- **mbti_analyzer(순수):** 4분류 각 경계·우선순위 충돌·거래<3 기본라벨.
- **ranking_service:** fakeredis(가용 시) 또는 실 redis — ZADD/ZREVRANGE 정렬, my_rank 백분위, 닉네임 조인. 미가용 시 순수 로직+수동 표기.
- **settlement(aiosqlite):** 시즌+계좌 N개+OPEN 포지션 시드 → `settle_due_season`(종가 주입) → 전원 청산·`current_roi` 확정·`hall_of_fame` 상위100 적재·MBTI 부여·시즌 FINISHED·차기시즌 ACTIVE 생성. **멱등**(두 번 실행 시 중복 없음) 검증. `end_at=NULL`/미도래 시 정산 안 함 검증.
- **compute_live_roi(순수):** 보유/미보유, 미실현 손익 반영.

## 7. 연기(추후 Phase)
지인 리그, 프론트 화면(Phase 6), 무기한 시즌 자동정산, 다종목.

## 8. 컨텍스트 & 의존성
- 재사용: `pricing`(ROI/PnL), `order_engine.close_position`(강제청산), `account_service.get_active_season`, `shared.database`, `shared.game_models`(GameAccount/HallOfFame/GameTrade/GameSeason), `apps/stock_api/services/clickhouse_source.py`(당일 종가 조회), Phase 3 tick_listener 파이프라인.
- 의존성: `redis.asyncio`(ZSET), Celery(기존), ClickHouse 클라이언트(기존).
- 환경변수: `REDIS_URL`(기존).

## 9. 검증 기준 (DoD)
- [ ] `tests/test_ranking_and_settlement.py` 통과(MBTI·랭킹·정산·멱등·라이브ROI).
- [ ] 기존 테스트 회귀 없음(`uv run pytest`).
- [ ] leaderboard 라우터 8003 마운트(스모크 import).
- [ ] Celery beat에 settle_season(매일 20:40 KST) 등록 확인.
- [ ] 정산 멱등성(두 번 실행 중복 없음) 테스트로 검증.
- [ ] 랭킹 라이브 갱신: 틱/청산 경로에서 ZADD 호출 연결.

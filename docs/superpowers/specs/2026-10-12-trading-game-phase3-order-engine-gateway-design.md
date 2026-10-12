# 트레이딩 게임 Phase 3 — 가상 주문/체결 엔진 + 클라이언트 WS 게이트웨이 설계 (Spec)

> 작성일: 2026-10-12
> 상위 기획: `docs/trading_game_plan.md` (Phase 3), 단계 프롬프트: `docs/prompts/trading_game/03_phase3_order_engine_gateway.md`
> 선행: Phase 1 DB 스키마(`game_accounts`/`game_positions`/`game_trades` 등, 시즌1기 005930 ACTIVE 시드) + Phase 2 실시간 WS 수집 데몬(`stock:tick:{ticker}` Redis Pub/Sub 발행) 완료
> 대상: `backend/` (FastAPI · asyncio · redis.asyncio · async SQLAlchemy)

---

## 1. 개요 & 범위

ACTIVE 시즌의 지정 종목에 대해 유저가 **원클릭 가상 주문**(LONG/SHORT · 레버리지 1x/2x/5x · 진입비중 25/50/100%)을
현재가로 **즉시 체결**하고, 실시간 틱마다 평가손익(PnL/ROI)을 재계산하여 **TP/SL/마진콜 자동청산**을 수행하는
**가상 주문/체결 엔진**과, 클라이언트(web/mobile)에 틱·개인손익·시장심리를 밀어주는 **FastAPI WebSocket 게이트웨이**를 구축한다.

### 1.1 산출물
- `shared/kis_config.py` 또는 Phase 2 publisher 수정 — 최신가 캐시(`stock:latest:{ticker}`) 기록 추가
- `apps/trading_game/__init__.py`
- `apps/trading_game/main.py` — FastAPI 앱 + `lifespan`(Redis 구독 리스너 1개 백그라운드 태스크), Port 8003
- `apps/trading_game/schemas/game_dtos.py` — Pydantic DTO
- `apps/trading_game/services/pricing.py` — **순수 함수**(PnL/ROI/TP·SL 가격/청산판정)
- `apps/trading_game/services/account_service.py` — 계좌 조회/자동생성
- `apps/trading_game/services/order_engine.py` — 진입/청산(조건부 업데이트·트랜잭션)
- `apps/trading_game/services/liquidation_service.py` — 틱 수신 시 TP/SL/마진콜 검사
- `apps/trading_game/services/market_clock.py` — 거래 세션 창 + 신선도 게이팅
- `apps/trading_game/services/tick_listener.py` — Redis 구독 → 자동청산 + Fan-out 소스
- `apps/trading_game/routers/orders.py` — REST: 진입/수동청산/활성포지션·계좌 조회
- `apps/trading_game/routers/ws_gateway.py` — WebSocket: 틱/개인손익/시장심리 push + `ConnectionManager`
- `alembic/versions/<rev>_game_phase3_trade_fields.py` — `game_trades`/`game_positions` 필드 추가 + 부분 유니크 인덱스
- `tests/test_order_engine.py` — 순수 수식·청산·게이팅·동시성 제약 단위 테스트
- `README.md` — 8003 기동법·환경변수 갱신

### 1.2 범위 밖 (명시적 제외 / 추후 Phase)
- 실시간 랭킹(ZSET)·시즌 정산·Trading MBTI → **Phase 4**
- 관리자 코치·퀘스트·차트 퀴즈 → **Phase 5**
- web_client/mobile 실시간 트레이딩 화면(현재 "시즌 준비 중" 스켈레톤 교체) → **Phase 6**
- 지인 리그(Private League) → Phase 4
- `H0STCNT0`가 KRX 애프터마켓/통합 틱을 실제로 내려주는지 **장중 실검증** → Phase 2 꼬리작업

---

## 2. 확정된 설계 결정

### 2.1 배포 형태 & 프로세스 모델
- **독립 앱 `apps/trading_game/main.py`(Port 8003)**. 자체 `lifespan`에서 Redis 구독 리스너를 백그라운드 태스크 1개로 기동.
- **단일 워커(1 worker) 전제.** 리스너가 보유하는 인메모리 상태(연결 클라이언트 레지스트리, 최근 집계)는 워커 1개에서만 정합. README·기동 명령에 `--workers 1` 명시.
- 틱 Fan-out(WS 전송)과 자동청산 검사는 **서로 다른 경로**로 처리. WS 전송은 per-client 타임아웃 → 실패 시 해당 클라이언트 drop(청산 로직이 느린 전송에 막히지 않게).

### 2.2 진실 가격 = 통합(H0STCNT0) 체결가 단일 스트림
NXT·KRX는 상장종목·체결가가 거래소별로 다르므로, 게임은 **통합(KRX+NXT) 체결가 1개 스트림만** 진실 가격으로 쓴다.
Phase 2 데몬이 발행하는 `stock:tick:{ticker}`가 그 단일 소스다. 시즌 종목은 KRX 상장 유동 종목에서 선정한다(상위집합).

### 2.3 최신가 캐시(`stock:latest:{ticker}`) — 단일 writer
Phase 2 publisher가 `PUBLISH`와 **동일 파이프라인**에서 `SET stock:latest:{ticker} <json> EX 120`을 추가 기록한다
(additive·회귀안전, 단일 writer). JSON = `{"price": <number>, "ts": <epoch_seconds>}`.
REST 주문 핸들러는 이 키를 읽어 **진입가**로 쓴다(지연 없는 원클릭 즉시 체결).

### 2.4 이중 게이트: 거래 세션 창 + 신선도
주문 진입 허용 = **(현재 KST ∈ `TRADING_WINDOWS`) AND (`stock:latest`.ts 가 `STALE_SECONDS` 이내)**.
- `TRADING_WINDOWS` 기본값 = `[("09:00","15:30"), ("16:00","20:00")]` (Asia/Seoul) — KRX 정규장 + 애프터마켓. **NXT 프리마켓(08:00~08:50) 제외.** 설정 데이터로 관리(코드 분기는 "window 안인가?" 한 곳).
- `STALE_SECONDS` 기본 10(env). 세션 창 안이라도 데몬이 죽어 틱이 끊기면 거부.
- 세션 밖 → 409 "거래 시간이 아닙니다". 가격 끊김 → 409 "시세 수신이 중단되었습니다".
- 자동청산은 틱이 올 때만 동작하므로 세션 창과 자연 정합(세션 밖엔 틱 없음 → 청산 검사도 없음).

### 2.5 레버리지·진입비중·단일 포지션
- 레버리지 허용 집합 = `{1, 2, 5}`. 그 외 값은 422.
- 진입비중 `ratio` 허용 집합 = `{0.25, 0.5, 1.0}`. 진입 원금 `size_amount = cash_balance * ratio`, **최소 10만 원** 미만이면 422.
- **1계좌 1활성포지션**(기본 룰). DB 레벨 부분 유니크 인덱스로 강제(2.7).

### 2.6 ROI/PnL 수식 (퍼센트 단위, Decimal 전구간)
- 단위 = **퍼센트**(예: `12.3456` = +12.3456%). `roi_pct`·`current_roi`·`max_roi` 모두 퍼센트. Phase 4 ZSET score와 일치.
- 편도 수수료 0.015%, **왕복 0.03%p**를 ROI에서 차감.
- LONG: `roi_pct = ((cur - entry) / entry) * leverage * 100 - 0.03`
- SHORT: `roi_pct = ((entry - cur) / entry) * leverage * 100 - 0.03`
- `pnl_amount = size_amount * roi_pct / 100`
- 반환 원리금 = `max(0, size_amount + pnl_amount)` (원금 초과 손실 없음).
- **승리 판정 = `pnl_amount > 0`** (TAKE_PROFIT 한정 아님).
- **Decimal 경계 변환**: 틱 JSON의 int/float는 연산 전 `Decimal(str(x))`로 변환(`float * Decimal` TypeError 방지).

### 2.7 스키마 변경 (Phase 3 Alembic 마이그레이션)
Phase 4(정산·MBTI)가 소비할 필드를 **지금** 추가한다(실거래 발생 후 소급은 더 위험).
- `game_trades` 추가: `size_amount Numeric(15,2) NOT NULL`, `leverage Integer NOT NULL`, `entry_ratio Numeric(5,4) NOT NULL`, `opened_at DateTime(tz) NOT NULL`, `had_stop_loss Boolean NOT NULL DEFAULT false`.
  - 근거(Phase 4 MBTI): `had_stop_loss`→"냉철한 원칙주의자(SL설정 70%+)", `entry_ratio`→"불나방(100% 몰빵)", `opened_at`(+closed_at)→"짧은 보유시간", `side`+`pnl_amount`→"빅쇼트/황소 저격수".
- `game_positions` 추가: `entry_ratio Numeric(5,4) NOT NULL`(청산 시 trade로 복사).
- **부분 유니크 인덱스**: `uq_account_single_open ON game_positions(account_id) WHERE status='OPEN'`(PG·sqlite 공통). 1계좌 1활성포지션을 DB가 보장(원클릭 더블클릭 방지).
- 마이그레이션은 기존 시드(Phase 1, 거래 0건) 기준이라 NOT NULL 추가 안전. GUID 타입은 기존과 동일하게 `postgresql.UUID`/CHAR(32).

### 2.8 동시성 안전
- 청산(수동/자동 공통)은 **조건부 업데이트**: `UPDATE game_positions SET status='CLOSED' WHERE id=:id AND status='OPEN'` → `rowcount==1`일 때만 계좌 복구·`GameTrade` 생성 진행. 레이스(수동↔자동, 틱 연속) 시 1건만 승리, 나머지 no-op. PG·sqlite 공통이라 테스트 가능.
- 잔고 변경은 SQL 증감(`cash_balance = cash_balance + :delta`), 파이썬 읽기-수정-쓰기 금지.
- 진입은 트랜잭션 내: 잔고 차감 + 포지션 생성. 1포지션 제약 위반(IntegrityError) → 409 "이미 보유 중인 포지션이 있습니다".

---

## 3. 컴포넌트 & 인터페이스

### 3.1 `services/pricing.py` (순수 함수, 의존성 없음 — 테스트 핵심)
```python
FEE_ROUNDTRIP_PCT = Decimal("0.03")          # 왕복 수수료 %p
MARGIN_CALL_ROI_PCT = Decimal("-80")          # 마진콜 임계 ROI %

def compute_roi_pct(side, entry: Decimal, cur: Decimal, leverage: int) -> Decimal
def compute_pnl(size_amount: Decimal, roi_pct: Decimal) -> Decimal
def tp_sl_prices(side, entry: Decimal, sl_pct, tp_pct) -> tuple[Decimal | None, Decimal | None]
def liquidation_reason(side, entry, cur, leverage, sl_price, tp_price) -> str | None
    # 'TAKE_PROFIT' | 'STOP_LOSS' | 'MARGIN_CALL' | None  (우선순위: MARGIN_CALL > SL > TP)
```
- TP/SL 절대가: LONG `SL=entry*(1-|sl|)`, `TP=entry*(1+|tp|)`; SHORT `SL=entry*(1+|sl|)`, `TP=entry*(1-|tp|)`.
- **`stop_loss_pct`/`take_profit_pct` 단위 = 분수**(0.0~1.0, 예: `0.05`=5%). ROI의 퍼센트 단위(2.6)와 혼동 금지. DTO에서 범위 검증(0 < x ≤ 1).

### 3.2 `services/market_clock.py`
- `in_trading_window(now_kst, windows) -> bool`.
- `is_price_fresh(latest_ts, now_epoch, stale_seconds) -> bool`.
- `read_latest(redis, ticker) -> dict | None` (`stock:latest:{ticker}` 파싱).
- `assert_tradable(...)` → 실패 시 HTTPException(409, 사유 메시지).

### 3.3 `services/account_service.py`
- `get_or_create_account(db, user_id, season_id) -> GameAccount` (없으면 초기 `INITIAL_CASH` 지급 생성).
- 시즌 검증: ACTIVE이고 `end_at` NULL 또는 미래.

### 3.4 `services/order_engine.py`
- `open_position(db, redis, user, season_id, side, ratio, leverage, sl_pct, tp_pct) -> GamePosition`.
- `close_position(db, position_id, exit_price: Decimal, reason: str) -> GameTrade | None` (조건부 업데이트 + rowcount 체크; 패배 경로 None).

### 3.5 `services/liquidation_service.py`
- `check_and_liquidate(db, ticker, price: Decimal) -> list[GameTrade]`: 해당 ticker의 OPEN 포지션 순회 → `liquidation_reason` → `close_position`.

### 3.6 `services/tick_listener.py`
- Redis `PSUBSCRIBE stock:tick:{active_ticker}` → 각 틱: (a) `check_and_liquidate`, (b) `ConnectionManager`로 Fan-out 큐에 전달.
- 끊김 시 지수 백오프 재연결(상한 30s), 취소가능 graceful shutdown(Phase 2 교훈 재사용).

### 3.7 `routers/orders.py` (REST, prefix `/api/game`)
- `POST /orders` — 진입. 인증 `get_current_user`. 입력: `season_id, side, ratio, leverage, stop_loss_pct?, take_profit_pct?`.
- `POST /positions/{position_id}/close` — 수동청산(`MANUAL`). 최신가로 확정.
- `GET /positions/active` — 내 활성 포지션(+실시간 평가손익).
- `GET /accounts/me?season_id=` — 내 계좌 요약.

### 3.8 `routers/ws_gateway.py` (`WS /ws/game/stream?token={jwt}`)
- `?token=` JWT → `shared.security.decode_token` 검증 → `ConnectionManager` 등록.
- 매 틱: 전체 Fan-out(틱) + 보유자에게 개인 PnL/ROI push.
- 5초 주기: Long/Short 활성 포지션 비율 `{"long_pct","short_pct"}` broadcast.

### 3.9 DTO (`schemas/game_dtos.py`)
- `OrderRequest`(side: Literal['LONG','SHORT'], ratio: Literal[0.25,0.5,1.0], leverage: Literal[1,2,5], stop_loss_pct/take_profit_pct: Optional), `PositionResponse`, `AccountResponse`, `TickPush`, `SentimentPush`.

---

## 4. 데이터 흐름

```
Phase2 데몬 ─PUBLISH stock:tick:{t}──┐   (+SET stock:latest:{t} EX120)
                                     ▼
                     trading_game tick_listener (lifespan task)
                        ├─► liquidation_service.check_and_liquidate ─► close_position ─► game_trades
                        └─► ConnectionManager.fanout ─► WS clients(틱 + 개인 PnL)
REST POST /orders ─► read_latest(stock:latest) ─► assert_tradable(창+신선도) ─► open_position ─► game_positions
```

---

## 5. 에러 처리
- 최신가 없음/stale/세션 밖 → 409(사유 메시지 구분).
- 잔고 부족/최소주문 미만/잘못된 enum → 422.
- 1포지션 제약 위반 → 409.
- 청산 레이스(이미 CLOSED) → no-op(멱등).
- Redis 구독 끊김 → 백오프 재연결. 깨진 틱 → 로그 후 skip. WS 전송 실패 → 클라이언트 drop. 데몬은 유지.
- 종료 시그널 → 구독·소켓·Redis 정상 해제(취소가능 태스크).

---

## 6. 테스트 (`tests/test_order_engine.py`, aiosqlite in-memory)
- **순수 수식**: LONG/SHORT × leverage {1,2,5} ROI/PnL 정확도, 왕복 수수료 0.03%p 차감, 반환원리금 `max(0,·)`.
- **TP/SL/마진콜**: 경계값 트리거·우선순위(MARGIN_CALL>SL>TP), 미도달 시 None.
- **동시성**: 조건부 청산 멱등(이미 CLOSED면 no-op/None), 1계좌 1포지션(중복 진입 IntegrityError).
- **게이팅**: 세션 창 밖 거부, stale 거부, 정상 체결.
- **계좌**: 자동생성 초기자본, 승리(`pnl>0`) 카운트, 잔고 복구.
- WS/Redis 실연동 = 수동/Mock. `uv run pytest tests/test_order_engine.py -v`.

---

## 7. 연기(추후 Phase로 기록)
- 랭킹 ZSET·시즌 정산·MBTI(Phase 4), 코치·퀘스트(Phase 5), 프론트 화면(Phase 6), 지인 리그(Phase 4).
- `H0STCNT0` 애프터마켓/통합 틱 실수신 여부 장중 실검증(Phase 2 꼬리작업).
- 다종목 동시 거래(현재 시즌당 1종목), 추가진입/부분청산(현재 1포지션 전량).

---

## 8. 컨텍스트 & 의존성
- 재사용: `shared.auth.get_current_user`, `shared.security.decode_token`, `shared.database`(AsyncSessionLocal/get_db), `shared.models.User`, `shared.game_models`, `shared.cors`, Phase 2 Redis 패턴.
- 환경변수: `REDIS_URL`, `TRADING_WINDOWS`(기본 09:00-15:30,16:00-20:00 KST), `STALE_SECONDS`(기본 10), `GAME_INITIAL_CASH`(기존 상수 재사용).
- DB: Phase 1 모델 + Phase 3 마이그레이션.

---

## 9. 검증 기준 (Definition of Done)
- [ ] Phase 3 마이그레이션 적용 + `alembic check` in-sync. 부분 유니크 인덱스 생성 확인.
- [ ] `tests/test_order_engine.py` 통과(수식·청산·게이팅·동시성·계좌).
- [ ] 기존 테스트 회귀 없음(`uv run pytest`).
- [ ] 8003 앱 기동 → Mock 틱 중 `POST /orders` 체결 → 틱마다 자동 TP/SL/마진콜 동작(수동 검증).
- [ ] WS `/ws/game/stream` 접속 → 틱·개인손익·시장심리 수신(수동 검증).
- [ ] README에 8003 기동법·환경변수 반영.

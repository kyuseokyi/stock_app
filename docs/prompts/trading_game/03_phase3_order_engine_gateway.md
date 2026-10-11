[명령어: 이 작업은 `backend/` 디렉토리 안에서 수행하세요. 사전에 `docs/prompts/00_master_prompt.md`, `CLAUDE.md`, `docs/trading_game_plan.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 **원클릭 가상 주문/체결 엔진(Order & Execution Engine)**과 클라이언트에게 실시간 틱 및 포지션 손익을 전달하는 **FastAPI WebSocket Gateway**를 구현하는 것입니다.

---

## 1. 아키텍처 및 모듈 구성

모듈은 `backend/apps/trading_game/` 디렉토리에 독립적으로 배치하고, 필요 시 `backend/apps/stock_api/main.py`에 라우터를 마운트하거나 독립 앱(`backend/apps/trading_game/main.py`, Port: 8003)으로 기동할 수 있도록 설계하세요.

### 디렉토리 구조
```
backend/apps/trading_game/
├── __init__.py
├── main.py                     # FastAPI 앱 및 라이프사이클 (Redis Listener)
├── routers/
│   ├── orders.py               # REST API: 주문 진입, 수동 청산, 포지션/계좌 조회
│   └── ws_gateway.py           # WebSocket: 클라이언트 실시간 스트리밍
├── services/
│   ├── order_engine.py         # 즉시 체결 및 PnL 수식 연산 서비스
│   ├── liquidation_service.py  # TP/SL 및 마진콜(강제청산) 감시 로직
│   └── account_service.py      # 가상 계좌 생성/잔고 관리
└── schemas/
    └── game_dtos.py            # Pydantic DTO (OrderRequest, PositionResponse 등)
```

---

## 2. 상세 구현 명세

### 1) 주문 진입 (Open Position) - `POST /api/game/orders`
- **입력**: `season_id`, `side` ('LONG' | 'SHORT'), `ratio` (0.25 | 0.5 | 1.0), `leverage` (1 | 2 | 5), `stop_loss_pct` (선택), `take_profit_pct` (선택)
- **인증**: Bearer JWT (`users.id` 추출)
- **로직**:
  1. 유저의 해당 시즌 `GameAccount` 조회 (없으면 자동 생성, 초기 1,000만 원 지급)
  2. 유저가 이미 활성 포지션(`status='OPEN'`)을 가지고 있는 경우 처리 (1인 1포지션 룰 또는 추가 진입 정책. 기본: 단일 활성 포지션)
  3. Redis에 캐싱된 최신 틱 가격(`stock:latest:{ticker}`)을 진입가(`entry_price`)로 사용 (지연 없는 원클릭 즉시 체결)
  4. 진입 원금: `size_amount = account.cash_balance * ratio` (최소 주문 단위 10만 원 검증)
  5. 계좌 잔고 차감: `account.cash_balance -= size_amount`
  6. TP/SL 절대 가격 계산:
     - LONG: `SL = entry_price * (1 - abs(stop_loss_pct))`, `TP = entry_price * (1 + abs(take_profit_pct))`
     - SHORT: `SL = entry_price * (1 + abs(stop_loss_pct))`, `TP = entry_price * (1 - abs(take_profit_pct))`
  7. `GamePosition` 레코드 생성 (DB 저장)

### 2) 손익(PnL) 및 수익률(ROI) 연산 공식
- **가상 편도 수수료**: 0.015% (진입 시 0.015%, 청산 시 0.015%)
- **LONG 평가손익**:
  $$\text{ROI} = \left(\frac{\text{현재가} - \text{진입가}}{\text{진입가}}\right) \times \text{레버리지} - \text{수수료율}(0.03\%)$$
  $$\text{PnL} = \text{size\_amount} \times \text{ROI}$$
- **SHORT 평가손익**:
  $$\text{ROI} = \left(\frac{\text{진입가} - \text{현재가}}{\text{진입가}}\right) \times \text{레버리지} - \text{수수료율}(0.03\%)$$
  $$\text{PnL} = \text{size\_amount} \times \text{ROI}$$

### 3) 포지션 청산 (Close Position) - `POST /api/game/positions/{position_id}/close`
- **사유(`closed_reason`)**: `MANUAL`, `TAKE_PROFIT`, `STOP_LOSS`, `MARGIN_CALL`
- **로직**:
  1. 최신 체결가(`exit_price`)로 최종 PnL 및 ROI 확정
  2. 반환 원리금: $\text{return\_amount} = \max(0, \text{size\_amount} + \text{pnl})$
  3. 계좌 복구: `account.cash_balance += return_amount`, `account.total_trades += 1`, (익절 시 `account.win_trades += 1`)
  4. `GameTrade` 레코드 생성 및 `GamePosition.status = 'CLOSED'` 업데이트

### 4) 실시간 TP/SL 감시 및 마진콜 (Liquidation Monitor)
- Redis Pub/Sub(`stock:tick:{ticker}`) 수신 시 백그라운드 태스크에서 실행:
  - 현재 열려 있는 해당 종목의 모든 활성 포지션 메모리/DB 캐시 순회
  - TP 도달 시 $\rightarrow$ `TAKE_PROFIT` 자동 청산 트리거
  - SL 도달 시 $\rightarrow$ `STOP_LOSS` 자동 청산 트리거
  - 평가손실률 $\le -80\%$ 도달 시 $\rightarrow$ `MARGIN_CALL` 강제 청산 (원금 전액 손실 방지)

### 5) FastAPI WebSocket Gateway - `WS /ws/game/stream?token={jwt}`
- 클라이언트 접속 시 인증 및 세션 등록 (`ConnectionManager`)
- 틱 데이터 브로드캐스트: Redis Pub/Sub 수신 즉시 연결된 모든 클라이언트에게 Fan-out
- 개인화 포지션 푸시: 해당 유저가 포지션을 보유 중인 경우 매 틱마다 평가손익(PnL) 및 ROI 계산치를 전송
- 시장 심리(Sentiment) 브로드캐스트: 현재 활성 포지션들의 Long vs Short 비율 집계치 (예: `{"long_pct": 65.0, "short_pct": 35.0}`) 5초 주기로 전송

---

## 3. 작업 순서 (Step by Step)

1. **스키마 및 DTO 작성**: `backend/apps/trading_game/schemas/game_dtos.py`
2. **서비스 레이어 구현**:
   - `services/account_service.py`: 계좌 조회/생성
   - `services/order_engine.py`: 주문 진입 및 수동 청산 로직 (트랜잭션 격리)
   - `services/liquidation_service.py`: 틱 수신 시 자동 청산 검사기
3. **REST 라우터 구현**:
   - `routers/orders.py`: `/orders`, `/positions/active`, `/positions/{id}/close`
4. **WebSocket 라우터 구현**:
   - `routers/ws_gateway.py`: 클라이언트 WebSocket 연결, 틱 및 개인 손익 실시간 푸시
5. **FastAPI 메인 앱 통합 (`backend/apps/trading_game/main.py`)**:
   - Redis Pub/Sub 수신 리스너를 `lifespan` 태스크로 등록
6. **검증 및 단위 테스트 작성 (`backend/tests/test_order_engine.py`)**:
   - Long/Short 레버리지별 PnL 계산 정확도 검증
   - SL/TP 도달 시 자동 청산 로직 단위 테스트
   - `uv run pytest tests/test_order_engine.py -v` 실행 검증

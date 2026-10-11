[명령어: 이 작업은 `backend/` 디렉토리 안에서 수행하세요. 사전에 `docs/prompts/00_master_prompt.md`, `CLAUDE.md`, `docs/trading_game_plan.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 **한국투자증권(KIS) OpenAPI 실시간 WebSocket**을 연동하여, 현재 활성 시즌(Season)의 지정 종목에 대한 실시간 체결가(Tick)를 수집하고 이를 **Redis Pub/Sub** 채널(`stock:tick:{ticker}`)로 초저지연 발행(Publish)하는 백엔드 수집 데몬을 구축하는 것입니다.

---

## 1. 기술 요구사항 및 스펙

1. **웹소켓 접속키 (Approval Key) 발급**:
   - 엔드포인트: `POST {base_url}/oauth2/Approval`
   - Payload: `{"grant_type": "client_credentials", "appkey": KIS_APP_KEY, "secretkey": KIS_APP_SECRET}`
   - 발급된 `approval_key`는 메모리/Redis에 캐싱하여 재사용합니다. (유효기간 관리)
2. **KIS WebSocket 접속 주소**:
   - 실전/모의투자 공통 또는 환경별 URL:
     - 실서버: `ws://ops.koreainvestment.com:21000`
     - 모의투자: `ws://ops.koreainvestment.com:21000` (또는 31000)
     - `backend/shared/kis_config.py`에 WebSocket URL 상수 추가 정의
3. **실시간 체결가 등록 (TR: `H0STCNT0`)**:
   - 등록 요청 헤더/바디 포맷:
     ```json
     {
       "header": {
         "approval_key": "발급받은_approval_key",
         "custtype": "P",
         "tr_type": "1",
         "content-type": "utf-8"
       },
       "body": {
         "input": {
           "tr_id": "H0STCNT0",
           "tr_key": "{ticker}"
         }
       }
     }
     ```
4. **응답 데이터 파싱 (Pipe `|` 구분자 형식)**:
   - 한투 실시간 체결 데이터는 `0|H0STCNT0|001|005930^090005^71500^...` 형태의 문자열로 수신됩니다.
   - 3번째 세그먼트의 캐럿(`^`) 구분 필드 중 핵심 추출 데이터:
     - `ticker`: 종목코드 (예: `005930`)
     - `time`: 체결시간 (`HHMMSS`)
     - `price`: 현재가 / 체결단가 (정수/부동소수점 변환)
     - `change_price`: 전일대비 변동금액
     - `change_rate`: 전일대비 등락율 (%)
     - `volume`: 당일 누적 거래량
5. **Redis Pub/Sub 발행 채널 및 포맷**:
   - 채널명: `stock:tick:{ticker}` (예: `stock:tick:005930`)
   - 메시지 포맷 (JSON):
     ```json
     {
       "ticker": "005930",
       "price": 71500,
       "change_price": 500,
       "change_rate": 0.70,
       "volume": 1245000,
       "timestamp": "2026-10-08T09:00:05.123+09:00"
     }
     ```
6. **야간/휴장/모의 환경 대비 Mock 시세 생성기 (Mock Fallback)**:
   - 한국 정규장은 09:00 ~ 15:30에만 열리므로, 야간이나 주말 또는 KIS 키 미설정 시 개발 및 테스트를 위해 **가상 틱 생성 모드(`MOCK_TICK_STREAM=true`)**를 반드시 내장하세요.
   - 마지막 종가(예: 71,500원) 기준으로 초당 1~3회 무작위 변동(±0.1% ~ 0.3%) 틱을 생성하여 동일한 Redis 채널로 발행할 수 있어야 합니다.

---

## 2. 작업 순서 (Step by Step)

1. **설정 및 클라이언트 확장**:
   - `backend/shared/kis_config.py`에 `ws_url` 프로퍼티 추가
   - `backend/apps/collector/kis/ws_client.py` 생성:
     - `Approval Key` 발급 메서드 구현
     - `websockets` 라이브러리(asyncio)를 사용한 단일 커넥션 관리
     - 핑퐁(Ping-Pong) 및 연결 끊김 시 자동 지연 재연결(Exponential backoff) 로직 구현
2. **시세 파서 및 Redis Publisher 구현**:
   - `backend/apps/collector/kis/ws_parser.py`: 한투 `H0STCNT0` 수신 스트링 파서
   - `backend/apps/collector/game_ws/publisher.py`: Redis 클라이언트와 연동하여 JSON 직렬화 후 `PUBLISH` 호출
3. **수집 데몬 진입점 작성 (`backend/apps/collector/run_game_ws.py`)**:
   - DB에서 현재 `status='ACTIVE'`인 시즌의 종목 코드(`ticker`)를 조회하여 구독 대상 설정
   - `MOCK_TICK_STREAM=true` 또는 `KIS_APP_KEY` 부재 시 자동으로 Mock Tick Generator로 분기
   - Graceful Shutdown (SIGINT, SIGTERM 시 세션 및 소켓 정상 해제)
4. **검증 및 구독 테스트 스크립트 작성 (`backend/scripts/test_game_ws_sub.py`)**:
   - Redis 채널 `stock:tick:*`을 `PSUBSCRIBE`하여 수신되는 틱 데이터를 콘솔에 출력하는 테스트 스크립트 작성
   - 실행 검증:
     ```bash
     # 터미널 1: 데몬 실행 (Mock 모드로 테스트)
     MOCK_TICK_STREAM=true uv run python -m apps.collector.run_game_ws

     # 터미널 2: 구독 검증
     uv run python -m scripts.test_game_ws_sub
     ```

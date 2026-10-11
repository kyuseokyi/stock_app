# 트레이딩 게임 Phase 2 — KIS 실시간 WebSocket 수집 데몬 설계 (Spec)

> 작성일: 2026-10-12
> 상위 기획: `docs/trading_game_plan.md` (Phase 2)
> 단계 프롬프트: `docs/prompts/trading_game/02_phase2_kis_ws_collector.md`
> 선행: Phase 1 DB 스키마 완료(`game_seasons` 등, 시즌1기 005930 ACTIVE 시드됨)
> 대상: `backend/` (asyncio · websockets · redis.asyncio · httpx)

---

## 1. 개요 & 범위

현재 `status='ACTIVE'`인 시즌의 지정 종목 **실시간 체결틱**을 한국투자증권(KIS) OpenAPI
WebSocket(`H0STCNT0`)으로 수집하여, 파싱 후 **Redis Pub/Sub** 채널 `stock:tick:{ticker}`로
초저지연 발행하는 **백엔드 수집 데몬**을 구축한다. 장외/휴장/키 미설정 시 동일 채널로 틱을 쏘는
**Mock 생성기**를 내장해 장외 시간에도 전체 파이프라인을 검증한다.

### 1.1 산출물
- `shared/kis_config.py` 수정 — `ws_url` 프로퍼티 추가
- `apps/collector/kis/ws_client.py` — async KIS WS 클라이언트(approval_key·구독·핑퐁·재연결)
- `apps/collector/kis/ws_parser.py` — H0STCNT0 수신 문자열 파서(순수 함수)
- `apps/collector/game_ws/publisher.py` — Redis 틱 발행기(async)
- `apps/collector/game_ws/mock_stream.py` — Mock 틱 생성기
- `apps/collector/run_game_ws.py` — 데몬 진입점(ACTIVE 시즌 조회 → Mock/실WS 분기 → graceful shutdown)
- `scripts/test_game_ws_sub.py` — `PSUBSCRIBE stock:tick:*` 수동 검증 스크립트
- `tests/test_game_ws_parser.py` — 파서·Mock 생성기 단위 테스트
- `pyproject.toml` — `websockets` 의존성 추가

### 1.2 범위 밖 (명시적 제외)
- 클라이언트용 WebSocket 게이트웨이(브라우저/앱 중계) → **Phase 3**
- 가상 주문/체결 엔진, 랭킹 → Phase 3~4
- 프론트엔드 변경
- 실 KIS WS 라이브 통합 테스트 → 장중+키 확인 시 수동(2.4)

---

## 2. 확정된 설계 결정

### 2.1 시즌 추적 = 시작 시 1회 조회 (startup-only)
데몬 기동 시 DB에서 `status='ACTIVE'` 시즌의 `ticker`를 **한 번** 읽어 구독 대상으로 고정한다.
시즌이 바뀌면 데몬을 재시작해 반영한다. (시즌 교체는 월 1회 수준이라 재시작 비용 미미.)
**연기(기록):** 주기적 DB 재확인 + 자동 종목 전환은 추후(Phase 4 시즌 정산 이후) 추가.

### 2.2 신규 async 모듈 (기존 동기 REST 클라이언트 불변)
기존 `apps/collector/kis/client.py`는 동기(`requests`) 기반 일봉/토큰용이다. 실시간 WS는
`asyncio` + `websockets`가 필요하므로 **새 async 모듈**로 짓고 기존 클라이언트는 수정하지 않는다.
- `KISConfig`(shared/kis_config.py)와 `is_configured`(Mock 폴백 판단)는 재사용.
- approval_key 발급은 **async httpx**로, 캐싱은 기존 토큰 패턴을 따라 Redis에 저장.

### 2.3 Mock-first 검증
`MOCK_TICK_STREAM=true` 또는 `KISConfig.is_configured`가 False면 Mock 생성기로 분기한다.
Mock은 기준가(시즌 종목 최근 종가 또는 상수 폴백)에서 ±0.1~0.3% 랜덤워크로 초당 1~3틱을
동일 채널에 발행한다. 자동 테스트와 수동 검증은 Mock으로 수행한다.

### 2.4 실 KIS WS 라이브 검증은 수동/추후
실제 WS 연결은 한국 정규장(09:00~15:30 KST) + 유효 KIS 키 + WS 권한이 있어야 하며, 결정적이지
않아 자동 테스트 대상이 아니다. 장중에 `scripts/test_game_ws_sub.py`로 수동 검증한다.

### 2.5 재연결·시그널
WS 끊김 시 지수 백오프(예: 1s → 2s → 4s … 상한 30s)로 자동 재연결. SIGINT/SIGTERM 수신 시
graceful shutdown(구독 해제 시도 → 소켓·Redis 정상 종료).

---

## 3. 컴포넌트 & 인터페이스

### 3.1 `shared/kis_config.py` (수정)
`KISConfig`에 WebSocket URL 프로퍼티 추가:
```python
_WS_URLS = {
    "prod": "ws://ops.koreainvestment.com:21000",   # 실서버
    "vps":  "ws://ops.koreainvestment.com:31000",   # 모의투자
}

@property
def ws_url(self) -> str:
    return _WS_URLS.get(self.mode, _WS_URLS["vps"])
```
(approval_key는 `base_url`(HTTPS REST)로 발급, 데이터는 `ws_url`로 수신.)

### 3.2 `apps/collector/kis/ws_parser.py` (신규, 순수 함수)
- `parse_message(raw: str) -> list[dict] | None`:
  - 제어 프레임(JSON, 예: `PINGPONG`/`SUBSCRIBE SUCCESS`)이면 `None` 반환(데이터 아님).
  - 데이터 프레임 `0|H0STCNT0|{count}|{payload}` 파싱:
    - 1번째 필드 `0`=평문/`1`=암호화(H0STCNT0은 평문), 2번째=TR id, 3번째=레코드 수, 4번째=`^`구분 필드열.
    - `count`가 2 이상이면 여러 틱이 연속되므로 리스트로 반환.
  - 각 tick dict: `{ticker, time(HHMMSS), price(int), change_price(int), change_rate(float), volume(int)}`.
  - 알 수 없는/깨진 형식은 `None`(호출부가 로그 후 skip).
- KIS H0STCNT0 필드 인덱스는 구현 시 공식 문서 기준으로 매핑하고, 테스트 샘플 문자열로 고정한다.

### 3.3 `apps/collector/kis/ws_client.py` (신규, async)
- `issue_approval_key(cfg) -> str`: `POST {cfg.base_url}/oauth2/Approval` (httpx async),
  body `{"grant_type":"client_credentials","appkey":...,"secretkey":...}` → `approval_key`.
  Redis 키 `kis:approval:{mode}:{appkey[:10]}`에 캐싱(유효기간 보수적으로 TTL 적용).
- `class KISWebSocketClient`:
  - `__init__(cfg, ticker)`.
  - `async def stream() -> AsyncIterator[str]`: 연결→approval_key로 H0STCNT0 구독 프레임 전송→
    수신 메시지를 yield. 핑퐁 프레임은 내부 처리. 끊기면 지수 백오프로 재연결 후 재구독.
- 구독 프레임은 프롬프트 문서 §1.3 포맷(header.approval_key/custtype/tr_type, body.input.tr_id/tr_key).

### 3.4 `apps/collector/game_ws/publisher.py` (신규, async)
- `class TickPublisher`:
  - `__init__(redis_url)`: `redis.asyncio.from_url`.
  - `async def publish(tick: dict) -> None`: JSON 직렬화(스키마 아래) 후 `PUBLISH stock:tick:{ticker}`.
  - `async def close()`.
- 발행 JSON: `{"ticker","price","change_price","change_rate","volume","timestamp"(ISO8601 +09:00)}`.

### 3.5 `apps/collector/game_ws/mock_stream.py` (신규)
- `async def mock_ticks(ticker, base_price) -> AsyncIterator[dict]`: ±0.1~0.3% 랜덤워크,
  초당 1~3틱, publisher가 쓰는 tick dict와 동일 구조로 생성(change_price/rate는 base 대비 계산).

### 3.6 `apps/collector/run_game_ws.py` (신규, 데몬 진입점)
- 기동 시 DB에서 `GameSeason(status='ACTIVE')` 1건의 `ticker` 조회(없으면 로그 후 종료).
- 분기: `MOCK_TICK_STREAM=true` 또는 `not cfg.is_configured` → `mock_ticks`,
  아니면 `KISWebSocketClient.stream()` → `parse_message`.
- 각 tick → `TickPublisher.publish`.
- SIGINT/SIGTERM → graceful shutdown.
- 실행: `uv run python -m apps.collector.run_game_ws` (Mock: `MOCK_TICK_STREAM=true ...`).

### 3.7 `scripts/test_game_ws_sub.py` (신규)
`redis.asyncio`로 `PSUBSCRIBE stock:tick:*` 하여 수신 JSON을 콘솔 출력(수동 검증용).

---

## 4. 데이터 흐름

```
KIS WS(H0STCNT0) ─┐
                  ├─► ws_parser.parse_message ─► tick dict ─► TickPublisher.publish
Mock generator ───┘                                              │
                                                                 ▼
                                                 Redis PUBLISH stock:tick:{ticker}
                                                                 │
                                                                 ▼  (Phase 3)
                                                    Client WS Gateway 가 SUBSCRIBE
```

---

## 5. 에러 처리
- approval_key 만료/실패 → 재발급(캐시 무효화 후 재시도).
- WS 끊김/예외 → 지수 백오프 재연결(상한 30s), 재연결 후 재구독.
- 깨진/알 수 없는 메시지 → 로그 후 skip(데몬 유지).
- Redis 발행 실패 → 로그 후 계속(틱 유실 허용, 데몬 유지).
- 종료 시그널 → 소켓·Redis 핸들 정상 해제.

---

## 6. 테스트
- **단위(`tests/test_game_ws_parser.py`)**:
  - `parse_message`: 단일 틱 샘플, 다중 틱(count>1) 샘플, 제어 프레임(PINGPONG/구독성공)→None, 깨진 입력→None.
  - 추출 값 타입/정확성(price int, change_rate float 등).
  - Mock 생성기: 생성 틱이 base 대비 ±0.3% 이내, 필드 구조가 publisher 입력과 일치.
- **통합(선택, 로컬 Redis 가동 중일 때)**: publisher로 1건 발행 → 동일 프로세스에서 SUBSCRIBE로 수신 확인.
- **수동**: Mock 데몬 + `test_game_ws_sub.py` (프롬프트 §2.4 터미널 검증).
- **실 WS 라이브**: 장중+키 확인 시 수동(자동 테스트 아님).

---

## 7. 연기(추후 Phase로 기록)
- 주기적 ACTIVE 시즌 재확인 + 자동 종목 전환(현재 startup-only).
- 실 KIS WS 라이브 통합 테스트 자동화.
- 다종목 동시 구독(현재 시즌당 1종목).
- 틱 영속화(ClickHouse 등) — 현재는 Pub/Sub 발행만(휘발).

---

## 8. 컨텍스트 & 의존성
- 재사용: `KISConfig`(app_key/secret/mode/is_configured), 토큰 Redis 캐싱 패턴(`kis:token:...` → `kis:approval:...`).
- 의존성 추가: `websockets`. 이미 보유: `httpx`(async approval), `redis>=8.0.1`(`redis.asyncio`).
- DB: `shared.database.AsyncSessionLocal`로 ACTIVE 시즌 조회(`shared.game_models.GameSeason`).
- 환경변수: `KIS_APP_KEY/SECRET/MODE`, `REDIS_URL`, `MOCK_TICK_STREAM`.

---

## 9. 검증 기준 (Definition of Done)
- [ ] `ws_url` 추가, `websockets` 의존성 추가(`uv sync`).
- [ ] `ws_parser` 단위 테스트 통과(단일/다중/제어/깨진 입력).
- [ ] Mock 데몬 실행 → `test_game_ws_sub.py`가 `stock:tick:005930` 틱 JSON 수신 확인.
- [ ] graceful shutdown(SIGINT) 정상 동작.
- [ ] 기존 테스트 회귀 없음.
- [ ] 실 WS 라이브 검증은 장중 수동(이 Phase의 DoD 아님).

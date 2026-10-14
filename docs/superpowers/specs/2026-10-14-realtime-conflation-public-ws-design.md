# 실시간 틱 묶기(conflation) + 비로그인 공개 시세 채널 설계 스펙

> 작성일: 2026-10-14 · 상태: 승인됨(사용자: "비로그인도 실시간 시세 보이게 설계해줘" → "①+② 0.25초로 진행해줘")
> 범위 밖: ③ 다중 워커/수평 확장(Redis Pub/Sub 기반 연결 분산) — 동시 접속 ~1,000명 이상에서 별도 진행.

## 0. 현재 문제(코드 기준)
- `tick_listener._handle_tick`: 틱마다 `liquidate_for_tick` 가 OPEN 포지션 DB 조회.
- `fanout_worker`: 틱마다 전체 broadcast + `_push_personal_pnl`(OPEN 포지션 DB 재조회 + 보유자별 ROI·ZADD·send).
- 장중 틱 수십/초 → 사용자 1명이어도 DB 조회 수십/초, 전송량 = 틱 빈도 × 접속자.
- WS 는 토큰 필수 → 비로그인은 실시간 시세 없음.

## 1. 포지션 메모리 캐시 `services/position_cache.py`
- 활성 시즌 종목의 OPEN 포지션 스냅샷: position_id → {account_id, user_id, season_id, side, entry_price, leverage, size_amount, stop_loss_price, take_profit_price} + 계좌별 {cash_balance, principal(=reward_service.principal)} + 시즌 창(start_at,end_at).
- 갱신: (a) `mark_dirty()` — 같은 프로세스의 주문 체결·청산·보상 지급(orders 라우터, 자동청산, 퀘스트/streak/퀴즈 보상 grant 후) 호출 → 다음 사용 시 DB 재적재, (b) 주기 재적재 5초(`GAME_POSITION_CACHE_TTL_SEC`, Celery 정산 등 다른 프로세스 변경 반영).
- 단일 워커 전제(기존과 동일). 재적재는 asyncio.Lock 으로 중복 방지.

## 2. 자동청산 — 모든 틱, DB 조회 없음
- `_handle_tick`: 캐시에서 `pricing.liquidation_reason(...)` 로 **후보만** 고르고, 후보가 있을 때만 DB 세션으로 `order_engine.close_position`(DB 가 OPEN 확인 — 이미 닫혔으면 None, 안전). 청산 후 `mark_dirty`, 기존 넛지·랭킹 동기화 유지.
- 틱마다 검사 유지(손절가 통과 틱 누락 금지). 결과 동작은 기존 `liquidate_for_tick` 과 동일해야 함(회귀 테스트).

## 3. 화면 전송 묶기
- 리스너는 최신 틱만 `latest_tick` 에 저장(덮어쓰기).
- **브로드캐스트 루프 0.25초**(`GAME_WS_TICK_INTERVAL_SEC=0.25`): 마지막 전송 이후 새 틱이 있으면 최신 1개를 전체(로그인+공개)에 `{"type":"tick",...}` 전송. 없으면 전송 안 함. 메시지 형식 불변.
- **개인 손익·랭킹 루프 1초**(`GAME_WS_PNL_INTERVAL_SEC=1.0`): 새 가격이 있을 때 캐시+최신가로 보유자별 ROI → `ranking_service.update_rank`(주간 포함, season_window) + 접속자에게 `position_pnl` 전송. DB 조회 없음.
- 기존 fan-out 큐(256, oldest-drop)는 넛지 전달용으로 유지, 틱 경로는 위 루프로 대체.
- 거래창 밖에는 틱 자체가 없으므로(수집기 게이트) 루프는 유휴.

## 4. 비로그인 공개 채널
- `/ws/game/stream` 의 `token` 을 **선택**으로: 없음 → 공개 연결(틱·시장심리만 수신), 있음 → 기존 검증(잘못된 토큰은 기존대로 4401 — 공개로 강등하지 않음).
- `ConnectionManager`: 공개 연결 집합 분리. `broadcast` = 로그인+공개, `send_to_user` = 로그인만.
- 남용 방지: IP당 공개 연결 최대 3(`GAME_WS_PUBLIC_PER_IP=3`), 전체 공개 최대 2,000(`GAME_WS_PUBLIC_MAX=2000`) 초과 시 accept 후 close 4429. IP = `CF-Connecting-IP` 헤더 우선, 없으면 client host.
- 공개 연결도 클라이언트 keep-alive 수신 루프 동일.

## 5. 클라이언트(web_client·mobile)
- 비로그인: 게임 화면이 시즌 로드되면 토큰 없이 연결 → 틱으로 차트 마지막 캔들·현재가 갱신, 시장심리 표시. 로그인 시 토큰 연결로 교체(기존 재연결 로직), 로그아웃 시 공개로 복귀.
- 비로그인 안내 문구 "로그인하면 실시간 시세와 주문이 열려요" → "로그인하면 주문할 수 있어요"(시세는 이제 보임).
- 4429 수신 시 재연결 백오프(무한 재시도 폭주 금지), 4401 은 기존대로 로그인 만료 처리(로그인 상태일 때만).

## 6. 검증
- backend TDD: 캐시 적재·dirty·TTL 재적재, 청산 후보 판정 = 기존 결과 동일(SL/TP/마진콜·SHORT), 이미 닫힌 포지션 안전, 브로드캐스트 루프 0.25초 묶기(틱 10개 → 1회 전송, 새 틱 없으면 0회), PnL 루프 DB 미조회·update_rank 호출, 공개 연결(토큰 없음 수락·잘못된 토큰 4401·IP 제한·전체 상한 4429·개인 메시지 미수신).
- 전체 pytest 회귀, web tsc/build, mobile tsc/jest.
- 로컬 스모크: `MOCK_TICK_STREAM=true` 수집 데몬 + 일회용 DB/Redis DB5, 비로그인 웹/에뮬레이터에서 차트 실시간 갱신 확인(DevTools WS 메시지 ~4회/초), 끝나면 정리.
- 문서: README 게임 섹션(공개 채널·간격 env), pending_checks(장중 확인 항목), ROADMAP 백로그(③ 수평 확장 설계 메모).

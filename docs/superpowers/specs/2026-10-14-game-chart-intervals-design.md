# 게임 차트 단위(일봉·분봉) — 관리자 기본값 + 사용자 전환 설계 스펙

> 작성일: 2026-10-14 · 상태: 승인됨(사용자: "게임에서 차트 캔들을 일봉, 분봉으로 변경할수 있게 가능한가? 관리자가 변경." → 선택 "관리자 기본값 + 사용자 전환", "게임 틱 집계 + 당일 KIS 보충" → "좋아 그대로 진행해줘")

## 1. 저장 — ClickHouse `game_minute_bars`
- `shared/clickhouse_schema.py` 에 테이블 추가(`init_clickhouse` 로 생성, IF NOT EXISTS):
  `ticker String, ts DateTime('Asia/Seoul')(분 시작), open/high/low/close Float64, volume UInt64, source LowCardinality(String) ('tick'|'kis'), ingested_at DateTime64(3)` — `ReplacingMergeTree(ingested_at) ORDER BY (ticker, ts)`, `PARTITION BY toYYYYMM(ts)`.
- 조회는 항상 `FINAL`.

## 2. 게임 틱 → 1분봉 (`apps/collector/game_ws`)
- 순수 집계기 `minute_bars.py`: `MinuteBarAggregator.add(tick) -> list[Bar]`(분이 바뀌면 직전 분 확정 바 반환), `snapshot()`(진행 중 바). 틱 시각은 틱의 체결 시각(KST) 우선, 없으면 수신 시각. 가격 OHLC, 거래량은 틱 체결량 합(없으면 0).
- 저장기: 확정 바 즉시 insert(`source='tick'`), 진행 중 바 15초마다 insert(같은 키 → Replacing 으로 덮어씀). CH 장애 시 로그 후 계속(틱 발행·게임 동작을 절대 막지 않음 — 별도 태스크/큐, 실패 무시).
- 대상: 현재 구독 중인 게임 종목. 거래창 밖에는 틱이 없으므로 자연히 정지.

## 3. 당일 KIS 보충
- `game_ws` 시작 시와 시즌 종목 전환 시 1회: KIS 주식당일분봉조회(`/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`, tr_id `FHKST03010200`)로 **오늘 09:00 ~ (첫 틱 분 직전 또는 현재)** 분봉을 역순 페이지네이션(30개 단위)으로 수집해 `source='kis'` insert. 이미 `source='tick'` 행이 있는 분은 넣지 않는다.
- 시장 구분 `FID_COND_MRKT_DIV_CODE` = `UN` 먼저, 빈 응답이면 `J`(CLAUDE.md KIS 규칙). 거래일이 아니거나 09:00 이전이면 건너뜀. 실패해도 game_ws 동작에 영향 없음(로그만).
- KIS 응답 필드명·페이지네이션 방식은 KIS 공식 문서/기존 `kis/client.py` 패턴을 따른다. 모의(vps)·실전 도메인 모두 기존 client 설정 재사용.

## 4. 조회 API `GET /api/game/candles?interval=1m|5m|15m|60m`(공개)
- 활성 시즌 종목. 1분봉 → `toStartOfInterval(ts, INTERVAL n MINUTE)` 로 묶어 OHLC(open=argMin(open, ts), close=argMax(close, ts), high=max, low=min, volume=sum).
- 범위: 데이터가 있는 최근 거래일 기준 1m=2일, 5m=5일, 15m=10일, 60m=20일. 응답 `{"interval":"5m","ticker":"005930","candles":[{"t": epoch_seconds(UTC), "open","high","low","close","volume"}]}`. 데이터 없으면 `candles: []`.
- trading_game 이 ClickHouse 에 접근 가능해야 함(compose env 확인, 없으면 추가). CH 장애 시 503.
- router → service → CH query 모듈 분리.

## 5. 관리자 기본값
- `game_settings` 키 `chart_interval_default`: `"day"|"1m"|"5m"|"15m"|"60m"`, 기본 `"day"`, 검증 422.
- `/api/game/rules` 에 `chart_interval_default`, `chart_intervals: ["day","1m","5m","15m","60m"]` 추가.
- admin "게임 설정"에 "차트 기본 단위" 선택 + 안내 "사용자는 차트 위에서 잠시 바꿔 볼 수 있어요".

## 6. 클라이언트(web_client `TradingChart`, mobile `candle-chart`)
- 차트 위 칩 `일 · 1분 · 5분 · 15분 · 60분`. 초기값 = rules.chart_interval_default(로드 전/실패 시 일봉). 사용자 선택은 화면 상태로만(재진입 시 기본값).
- 일봉: 기존 경로 그대로. 분봉: `/candles?interval=` 로드, 실시간 틱은 `mergeTickIntraday(last, bucketStart(nowKST, interval), price)`(새 버킷이면 새 캔들) — 순수 함수 + 테스트.
- lightweight-charts: 분봉은 `time` = UTC epoch seconds, 축 라벨은 KST 로 표시. 모바일 echarts 도 KST 라벨.
- 진입가선·손절선·코치 지지/저항선은 모든 단위에서 유지.
- 분봉 빈 상태: "분봉은 오늘부터 쌓이고 있어요".

## 7. 검증
- backend TDD: 집계기(분 경계·OHLC·거래량·진행 중 스냅샷), 저장 실패가 발행을 막지 않음, KIS 보충 범위(첫 틱 이전만·UN→J 폴백·비거래일 건너뜀, HTTP 대역), 단위 묶기 쿼리, settings·rules.
- web tsc·build, mobile tsc·jest(버킷·병합 함수).
- 로컬 스모크: 로컬 docker ClickHouse + `MOCK_TICK_STREAM=true` 수집 데몬 + 일회용 PG/Redis DB5 → 분봉 쌓임·웹 단위 전환·실시간 갱신 확인. 끝나면 테스트 행 정리.
- 장중 실제 KIS 보충은 pending_checks.
- 문서: README(테이블·API·설정), pending_checks.

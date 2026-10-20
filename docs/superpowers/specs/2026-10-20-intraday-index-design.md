# 장중 주요 지수 30초 갱신(A안) 설계

- **작성일**: 2026-10-20
- **상태**: 설계 검토 대기
- **관련**: [`2026-10-20-mobile-screener-design.md`](2026-10-20-mobile-screener-design.md), [`2026-10-20-market-close-schedule-design.md`](2026-10-20-market-close-schedule-design.md)

## 1. 목표와 범위

스크리너 시장 칩의 국내 지수·환율이 장중에도 최신 값을 보여 주게 한다. 지금은 15:40 확정 종가만 있어서 장중에는 전날 종가가 보인다.

| 범위 안 | 범위 밖 |
|---|---|
| 코스피·코스닥·코스피200·원/달러 4개 | 미국 지수(한국 낮에는 미국 장이 닫혀 있음) |
| 서버가 30초마다 KIS REST 로 조회 → Redis | KIS 웹소켓(B안) — 게임과 실시간 등록 한도를 나눠 써야 해서 제외 |
| 시장 개요 응답에 장중 값 덧씌우기 | 확정 종가 이력(ClickHouse) 변경 |
| 모바일·웹 시장 칩: "장중 HH:MM" 표시, 화면이 보이는 동안 30초 자동 새로고침 | 거시 지표(FRED) |

**왜 A안인가**: 호출량이 사용자 수와 무관하다(서버가 한 번 가져와 모두가 Redis 값을 읽음). 4건/30초 = 초당 약 0.13건으로, 실전 상한 20 TPS·우리 상한 15 TPS(`apps/collector/tasks/universe.py`)의 1% 미만. 장중에 REST 를 대량으로 쓰는 작업이 없고(일봉 대량 수집은 20:30), 게임 실시간 시세는 웹소켓이라 겹치지 않는다.

## 2. 전체 흐름

```
celery beat (30초)
  └─ collector.poll_intraday_indices
       ├─ 거래일·장 시간 아니면 즉시 종료(KIS 호출 없음)
       ├─ KIS REST 4건(지수 3 + 환율 1) — 기존 KISClient·RateLimiter
       └─ Redis  market:intraday  ← {code: {value, date, ts}}  (TTL 10분)

stock_api  marketOverview
  └─ _indices(): ClickHouse 확정 종가 60일 + Redis 장중 값 덧씌우기(순수 함수)
       → MarketIndex.live = true, asOf = "14:32"

모바일·웹 시장 칩
  └─ 화면이 보이고 앱이 앞에 있을 때만 30초마다 overview 다시 조회
```

## 3. 수집기 — `collector.poll_intraday_indices`

- **일정**: celery beat `schedule=30.0`(초). 큐에 밀린 작업이 몰려 실행되지 않게 `options={"expires": 25}`.
- **실행 조건**: KST 기준 거래일이고 09:00 ≤ 현재 < 15:35 일 때만 KIS 를 부른다.
  - 거래일·휴장일 판정은 게임이 쓰는 `apps/trading_game/services/market_calendar.is_trading_day` 를 재사용한다. collector 가 trading_game 을 직접 import 하지 않도록 판정 함수만 `shared/` 로 옮기고 양쪽이 쓰게 한다(게임 동작 불변 — 기존 테스트로 확인).
  - 장 시간은 이 기능 전용 상수 `INTRADAY_WINDOW = (09:00, 15:35)`. 게임의 `TRADING_WINDOWS`(애프터마켓 포함)와는 목적이 달라 공유하지 않는다.
  - 15:35 이후는 장중 값을 갱신하지 않는다. 15:40 확정 종가 수집이 끝나면 확정 값이 그대로 보인다(4절 규칙).
- **조회**: 기존 `index_specs` 의 `KR:0001`·`KR:1001`·`KR:2001`·`FX:USDKRW` 4개. 기존 일별 조회 함수(국내 `FHKUP03500100`, 환율 `FHKST03030100`)를 오늘 날짜 범위로 불러 **오늘 날짜 봉의 현재값**을 쓴다.
  - ⚠️ 구현 1단계에서 확인: 장중 호출 시 두 TR 이 오늘 진행 중인 값을 주는지. 국내 지수가 안 주면 업종 현재지수 조회 TR 로 바꾼다. 환율이 지연 시세면 문서·화면 문구에 "지연" 을 밝힌다.
  - KIS 수집 규칙(국내 시세는 UN 우선 → J 폴백)은 종목 시세용이다. 지수 TR 은 기존 일별 수집과 같은 시장 코드(`U`)를 그대로 쓴다.
- **저장**: Redis 키 `market:intraday` 하나에 JSON `{code: {"value": float, "date": "YYYY-MM-DD", "ts": epoch}}`. TTL 10분 — 수집이 멈추면 값이 저절로 사라져 확정 종가로 돌아간다.
  - 한 코드가 실패하면 그 코드만 이전 값 유지(덮어쓰지 않음). 전부 실패하면 로그만 남긴다.
- **호출 한도**: 이 태스크 전용 `RateLimiter` 를 초당 2건으로 낮게 둔다(4건이 2초에 나뉨). 장중 다른 REST 대량 작업이 생기면 한도를 나눠야 한다는 주석을 남긴다.
- **ClickHouse 에는 쓰지 않는다** — 장중 값이 확정 종가 이력을 오염시키지 않게(15:40 수집이 실패해도 장중 마지막 값이 종가로 남지 않음).

## 4. API — 시장 개요에 장중 값 덧씌우기

- `apps/stock_api/services/market_query._indices()` 가 ClickHouse 결과를 만든 뒤 Redis `market:intraday` 를 읽어 **순수 함수** `overlay_intraday(series, intraday, today)` 로 합친다. Redis 오류는 무시하고 확정 값만 돌려준다.
- 덧씌우는 조건(코드별): 장중 값의 `date == 오늘` 이고, 확정 종가의 마지막 날짜 `< 오늘`(= 아직 오늘 종가가 확정되지 않음).
  - 맞으면: 추세선 끝에 장중 값을 한 점 붙이고 `close` = 장중 값, `chg1d` = 장중 값 ÷ 마지막 확정 종가 − 1, `date` = 오늘, `live = true`, `asOf` = 장중 값 시각(KST "HH:MM").
  - 아니면(오늘 확정 종가가 이미 있거나 장중 값이 어제 것): 지금과 똑같이 확정 값만, `live = false`, `asOf = null`.
- GraphQL `MarketIndex` 에 필드 2개 추가: `live: Boolean!`, `asOf: String`. 기존 필드는 그대로라 하위 호환. 웹·모바일 쿼리 계약 테스트(`test_mobile_queries_match_schema` 등)에 새 필드를 넣는다.
- 30초마다 여러 사용자가 overview 를 부르므로 ClickHouse 지수 조회(11개 코드 × 60일)에 프로세스 메모리 캐시 30초를 둔다(Redis 장중 값은 캐시하지 않음 — 덧씌우기는 매번).

## 5. 화면

- **지수 카드**(모바일 `components/index-card.tsx`, 웹 `IndexCards.tsx`): `live` 이면 날짜 자리에 "장중 14:32" 배지(파스텔 블루). 아니면 지금처럼(국내는 날짜 없음, 해외는 MM/DD).
- **자동 새로고침**: 시장 칩이 화면에 보이고 앱이 앞에 있을 때만 30초마다 `useMarketOverview` 의 조용한 새로고침(스피너 없음, 실패해도 토스트 없음 — 다음 주기에 다시 시도). 모바일은 `useFocusEffect` + `AppState`, 웹은 `document.visibilityState`. 장 시간이 아니어도 돌지만 서버가 같은 값을 돌려줄 뿐이라 해가 없다.
  - 늦게 온 옛 응답 무시는 기존 요청 번호(`latest.ts`) 방식을 그대로 쓴다.
- **기준일 안내**(모바일·웹 `BasisNote`): "국내 지수 장중 30초 · 15:40 확정 · 종목·테마·업종 20:30 · 미국 06:30 갱신 · 투자 권유가 아닙니다".

## 6. 오류·경계 상황

| 상황 | 동작 |
|---|---|
| KIS 장중 조회 실패 | 이전 장중 값 유지, 10분 지나면 사라져 확정 종가 표시 |
| Redis 장애 | 수집기는 로그만, API 는 확정 값만 — 화면은 지금과 같음 |
| 휴장일·주말 | 수집기가 KIS 를 부르지 않음 → 장중 값 없음 → 확정 종가 |
| 15:35~15:40 | 장중 마지막 값이 남아 "장중 15:34" 로 보임 → 15:40 확정 후 확정 값 |
| 15:40 확정 수집 실패 | 장중 값은 10분 뒤 사라지고 전날 종가로 돌아감(장중 값을 종가로 쓰지 않음) |
| 워커가 다른 긴 작업으로 바쁨 | `expires=25` 로 밀린 실행은 버림 — 다음 주기에 정상 |

## 7. 테스트

- 수집기: 실행 조건(거래일·시간 경계 09:00/15:35, 휴장일), 일부 실패 시 이전 값 유지, Redis 저장 형식·TTL — KIS 클라이언트·Redis 는 가짜로.
- `shared` 로 옮긴 거래일 판정: 기존 게임 테스트가 그대로 통과.
- `overlay_intraday` 순수 함수: 덧씌움/안 함 조건, chg1d 계산, 추세선 점 추가, asOf 형식.
- GraphQL 계약 테스트에 `live`·`asOf`.
- 모바일·웹: 배지 표시 함수, 자동 새로고침이 화면 밖·백그라운드에서 멈추는지(훅 단위).

## 8. 배포·운영

- 배포 후 celery beat 가 새 일정을 읽도록 재기동(배포 워크플로가 이미 함께 재기동).
- 확인: 장중에 `market:intraday` 키 값과 TTL, 앱 시장 칩의 "장중 HH:MM" 배지.
- 끄는 방법: env `INTRADAY_INDICES_ENABLED=false` 면 태스크가 바로 종료(기본 true). `.env.example` 에 추가.
- README·`docs/server_setup.md` 일정 표에 "장중 30초" 한 줄 추가.

## 9. 나중에 할 수 있는 것

- 미국 장중(한국 밤 22:30~06:00) 같은 방식으로 확장 — 해외 지수 장중 값의 지연 여부 확인 후.
- 초 단위가 필요해지면 B안(웹소켓)을 이 구조 위에 얹기: 수집 경로만 바꾸고 Redis·API·화면은 그대로 둔다.

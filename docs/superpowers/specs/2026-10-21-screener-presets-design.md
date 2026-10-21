# 스크리너 프리셋·커스텀 필터(조건검색) 설계

- 작성: 2026-10-21 · 상태: 승인(사용자 "1번 진행해줘, 꼭 필요한 사항이 아니라면 물어보지 말고 계속 진행" — 아래 결정은 문서·코드 조사로 정함)
- 근거: `docs/screener_plan.md`(프리셋·필터 정의), CANSLIM 설계 `2026-10-18-canslim-design.md`(§9 "일반 프리셋은 이후"), ROADMAP Phase 1 "정배열/역배열·매물대 CH 컬럼 영속화"·Phase 2 프리셋/커스텀 필터

## 1. 목표와 범위

매일 장 마감 후 전 분석 대상 종목의 기술·재무 지표를 미리 계산해 두고, 웹·앱 스크리너의 새 탭 **'조건검색'** 에서 **프리셋 4종**과 **커스텀 필터**로 종목을 고른다.

**범위**: 사전 계산 테이블 `screener_daily` + 계산 단계(매일 파이프라인·백필), GraphQL `screenerScreen`, 웹 탭, 앱 칩, 문서.
**범위 밖**: 배당수익률(데이터 출처 없음), MACD, 차트 패턴(컵·쌍바닥 — 별도 로드맵), 사용자 저장 필터, 알림, ETF·우선주(분석 대상 아님).

## 2. 결정 사항 (문서·코드 차이 정리)

| 항목 | 결정 | 이유 |
|---|---|---|
| 대상 종목 | `market_repo.analysis_universe`(보통주 ~2,664) | CANSLIM·시장 탭과 같은 범위. 재무·투자자 데이터도 이 범위만 있음 |
| 기준일 | `screener_daily` 의 최신 date 하나(as_of). 응답 `date` 로 노출, null 이면 "준비 중" | 테이블 간 하루 어긋남 방지 |
| 거래량 급증 | 당일 거래량 ≥ **직전 20거래일 평균 × 2** | 퀴즈 신호(`VOLUME_SURGE_RATIO=2.0`)와 같은 기준. 전일 대비는 전일이 이상치면 흔들림 |
| 골든크로스 | **MA20 이 MA60 을 상향 돌파, 최근 3거래일 이내** | 기획서 정의(20/60). ma60 은 계산 단계에서 직접 구함 |
| 과매도 | **RSI(14, Wilder) ≤ 30** | 기획서. `wilder_rsi` 재사용 |
| 신고가 | **당일 고가 > 직전 251거래일 최고가**(52주 신고가 경신) | `n_high_52w` 는 당일 포함이라 "경신" 판정 불가 → 직전 고가를 따로 계산 |
| 매물대 | 최근 120거래일 종가 구간별 거래량(20구간) 중 **현재가보다 위 구간의 비율(%)** = `vp_above_pct`. 필터는 "위쪽 매물 ≤ N%"(돌파 후 저항 적음) | 기획서에 정의 없음 → 해석이 쉬운 한 지표로 고정. `chart.volume_profile` 로직 재사용 |
| 볼린저 | `std20`(모집단 표준편차) 저장, σ(1·1.5·2·2.5·3)는 **조회 시 계산**: 위치(상단 돌파 / 하단 이탈 / 밴드 안), 밴드폭 ≤ N% | σ 가변을 컬럼 하나로. `daily_prices.bb_*` 는 비어 있고 덮어써지므로 안 씀 |
| 배열 | 정배열(MA5>20>50>120) / 역배열 / 무관 — `ma_order` 저장 | 기존 `chart.ma_order` 와 같은 정의 |
| 재무 | 최신 **연간(Y)** 값: ROE·EPS·매출성장·영업이익성장·부채비율, PER=종가/EPS, PBR=종가/BPS (EPS·BPS ≤ 0 이면 null) | 분기 누적 여부 미확인 → 연간만 안전 |
| 저장 위치 | 새 테이블 `screener_daily` — `daily_prices` 에 컬럼 추가 금지 | 일봉 30일 겹침 재수집이 다른 단계가 채운 컬럼을 NULL 로 덮음 |

## 3. 데이터

### 3.1 `screener_daily` (ClickHouse)
`ReplacingMergeTree(ingested_at)`, `PARTITION BY toYYYYMM(date)`, `ORDER BY (date, ticker)`. 조회는 `FINAL`.

컬럼: `date, ticker, market, close, chg_1d, volume, value(거래대금), mcap, vol_ratio20(당일/직전20일평균, Nullable), rsi14, ma5, ma20, ma50, ma60, ma120, std20, ma_order(Int8: 1 정배열·-1 역배열·0 혼합), high_52w_prev, is_new_high(UInt8), gc_days(Nullable Int16: MA20/60 골든크로스 이후 경과 거래일, 3일 초과·없으면 NULL), vp_above_pct, roe, eps, per, pbr, sales_growth, op_growth, debt_ratio, liquid(UInt8: 20일 평균 거래대금 ≥ 10억·종가 ≥ 1,000원 — CANSLIM `is_liquid` 와 같음), ingested_at`.
데이터가 모자라면(상장 직후 등) 해당 지표만 NULL — 그 지표 조건이 걸리면 결과에서 빠진다.

### 3.2 계산 단계
- 순수 `collector/screener/compute.py`(종목별 지표) + `repositories/clickhouse_screener.py`(봉 로드: date·open·high·low·close·volume 약 400일, 저장) + `tasks/screener.py`(`compute_screener(as_of=None)`, `backfill_screener(days=60)`).
- 지표 함수는 기존 것을 재사용하거나 같은 정의로 옮긴다: Wilder RSI(`trading_game/services/rsi_service.wilder_rsi`), 볼륨 프로파일(`stock_api/services/chart.volume_profile`), 유동성(`canslim/rules.is_liquid`). 서비스 간 import 가 어색하면 collector 쪽에 같은 정의로 두고 테스트로 값 일치를 고정.
- `daily_market_pipeline` 마지막(시장 그룹 다음)에 단계 추가. 앞 단계 실패와 무관하게 실행, 결과는 `pipeline_record` 에 기록. 재실행해도 같은 결과(멱등).

## 4. API — GraphQL(stock_api)

```
screenerScreen(preset: String, filters: ScreenerFilterInput, sort: String = "value", limit: Int = 50, offset: Int = 0): ScreenerScreen
```
- `preset`: `volume_surge` · `golden_cross` · `oversold` · `new_high` (또는 null). 프리셋은 **서버 상수**(필터 묶음)이고 `filters` 와 AND 로 결합.
- `ScreenerFilterInput`(모두 선택): `market`(ALL/KOSPI/KOSDAQ), `priceMin/Max`, `mcapMin/Max`(억 원), `valueMin`(억 원), `liquidOnly`(기본 true), `volRatioMin`, `rsiMin/Max`, `maOrder`(PERFECT/REVERSE), `bbSigma`(1~3) + `bbPosition`(ABOVE/BELOW/INSIDE) + `bbWidthMax`(%), `vpAboveMax`(%), `roeMin`, `perMin/Max`, `pbrMin/Max`, `debtRatioMax`, `salesGrowthMin`.
- `sort`: `value`(거래대금, 기본) · `chg`(등락률) · `vol_ratio` · `rsi` · `mcap` · `vp_above`(오름차순). 그 밖의 값은 `value`.
- 응답 `ScreenerScreen { date, total, items: [ScreenerItem] }`, `ScreenerItem { ticker name market sectorName close chg1d value mcap volRatio20 rsi14 maOrder isNewHigh gcDays vpAbovePct per pbr roe }`.
- 구현: `services/screener_query.py` — `canslim_query.screen` 패턴(화이트리스트 WHERE·값은 바인딩·count 별도·LIMIT/OFFSET, `MAX_LIMIT=200`, 이름·업종은 PG). 범위 값 검증(음수·뒤집힌 min/max 는 무시).
- `screenerPresets` 같은 별도 쿼리는 두지 않는다 — 프리셋 이름·설명은 클라이언트 상수(서버 키와 같은 문자열).

## 5. 화면

### 5.1 웹 — 스크리너 탭 '조건검색'(`/screener/finder`, 탭 순서: 시장·테마·업종·일정·주도주·**조건검색**)
- 상단 **프리셋 칩** 4개(누르면 선택/해제, 하나만) + 한 줄 설명.
- **필터 패널**(접기 가능): 시장·가격·시총·거래대금·거래량 비율·RSI·배열·볼린저(σ·위치·폭)·매물대·재무. [적용]/[초기화]. 적용 필터 수 표시.
- **정렬** 칩 + **목록**(종목명·티커·시장·종가·등락률·거래대금·지표 배지: 신고가·골든크로스 n일·RSI·정배열) + "더 보기"(50).
- 넓은 화면: 오른쪽 상세 = 기존 `StockDailyChart` + 지표 표(RSI·볼린저 위치·매물대·재무). 좁은 화면: 행 펼침. 주도주 페이지 골격 재사용.
- 상태: 준비 중(date null)·0건("조건을 줄여 보세요")·오류. 하단 "기준일 종가 · 매일 20:30 갱신 · 투자 권유가 아닙니다".

### 5.2 앱 — 스크리너 칩 '조건검색'
- 프리셋 칩 가로 스크롤 + [필터] 버튼(바텀시트, 웹과 같은 항목) + 정렬 칩 + FlatList 무한 스크롤. 행 → `/stock/[ticker]`(기존 종목 상세).
- 주도주 구조(요청 게이트 `createLatest`·`inflight` 잠금·같은 값 재조회 방지·`mergeLeaderPage` 일반화)를 따른다.

## 6. 테스트
- 백엔드: 지표 계산 순수 함수(RSI·std·ma60·골든크로스 경과일·신고가 경신·매물대 위쪽 비율·PER/PBR·유동성) 값 고정, 프리셋→WHERE 조합, 화이트리스트(임의 정렬·필드 무시), 범위 검증, 페이징, date null, 파이프라인 단계 추가(실패 격리). CH 는 기존 테스트처럼 가짜 클라이언트.
- 계약 테스트: 웹·모바일 쿼리 문자열을 실제 스키마로 실행(`test_market_query.py` 방식).
- 모바일 jest: 필터 수·같은 필터 비교·페이지 병합·프리셋 상수. 웹: 타입 검사(+ 기존 테스트 방식이 있으면 순수 함수).
- 실데이터: 배포 후 `backfill_screener(60)` 실행, 프리셋별 건수가 0도 전종목도 아닌지 확인(사용자/운영).

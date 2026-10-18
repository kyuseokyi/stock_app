# CANSLIM 분석 (스크리너 프로젝트 2) — 설계

> 상태: 검토 대기 · 작성 2026-10-18
> 선행: 프로젝트 1 시장 데이터 수집 기반(`2026-10-18-market-data-foundation-design.md`, main 반영·배포 2026-10-18)
> 기획 원본: `docs/screener_plan.md`(일반 스크리너) — 이 문서는 그중 윌리엄 오닐 CANSLIM 하나를 구체화한다.

## 1. 사용자 결정 (2026-10-17~18 브레인스토밍)

| 항목 | 결정 |
|---|---|
| 제공 형태 | **둘 다** — 스크리너 목록(통과 종목) + 종목별 7항목 점수표 |
| 범위 | 단계적 — 이번 프로젝트에서 7항목 모두 계산하되, 데이터 확인이 끝난 항목부터 켠다(C 는 분기 EPS 형식 확인 뒤) |
| 판정 표시 | 항목별 ✅/❌ + 근거 수치 **그리고** 0~100 종합 점수 |
| 플랫폼 | **웹 먼저**(앱은 다음) |
| 범위 경계 | CANSLIM 만(일반 프리셋·커스텀 필터는 이후) |
| 계산 방식 | **A안 — 매일 사전 계산해 CH 에 저장**, API 는 읽기만 |

## 2. 판정 기준 (오닐 원전 기준, 상수로 모아 조정 가능)

| 항목 | 의미 | 통과 기준 | 근거로 보여줄 값 | 데이터 |
|---|---|---|---|---|
| **C** | 최근 분기 실적 | 최근 분기 EPS 가 전년 같은 분기보다 **25% 이상** 증가(전년 적자→올해 흑자 = "흑자 전환" 통과) | 성장률 %, 두 분기 EPS | `fundamentals_periodic`(Q) |
| **A** | 연간 실적 | 최근 3년 EPS 가 **매년 증가**하고 연평균 **25% 이상**, 최근 ROE **17% 이상** | 연평균 성장률, ROE | `fundamentals_periodic`(Y) |
| **N** | 신고가 근처 | 종가가 52주(252봉) 최고가의 **85% 이상** | 고점까지 남은 % | `daily_prices` |
| **S** | 수급(거래량) | 최근 50봉 상승일 거래량 합 ÷ 하락일 거래량 합 **1.0 이상** | 상승/하락 거래량 비율 | `daily_prices` |
| **L** | 주도주 | RS 등급(아래) **80 이상** | RS 1~99, 업종 RS 순위(참고) | `daily_prices`·`stock_profile` |
| **I** | 기관·외국인 | 최근 20거래일 기관+외국인 순매수 합 > 0 **그리고** 순매수한 날 ≥ 10일 | 순매수 합(주), 순매수 일수 | `investor_daily` |
| **M** | 시장 방향 | 그 종목 시장 지수(KOSPI/KOSDAQ)가 50일선 위, 50일선 > 200일선, 최근 25거래일 분산일 **5일 미만** | 상승 추세 / 조정 / 하락 | `market_index_daily` |

- **RS 등급**: 원값 = 0.4×3개월 + 0.2×6개월 + 0.2×9개월 + 0.2×12개월 수익률(63·126·189·252봉 전 종가 대비). 그날 원값이 있는 분석 대상 종목 안에서 백분위 1~99. 253봉 미만(상장 1년 미만)은 L "데이터 부족".
- **업종 RS**(참고 표시, 판정 아님): 같은 `sector_m` 종목 RS 원값의 중앙값 → 업종 순위. 오닐의 "주도 업종 안의 주도주"를 화면에서 보여주기 위함.
- **분산일**: 지수가 전일 대비 0.2% 이상 하락하고 거래량이 전일보다 많은 날.
- **M 상태 문구**: 세 조건 모두 → "상승 추세", 종가 < 200일선 → "하락", 그 외 → "조정".
- **N 은 60봉 이상이면 계산**(신규 상장주도 신고가 판단 — 오닐은 신규 상장 주도주를 선호). 60봉 미만은 "데이터 부족".
- **분기 EPS 누적 여부(C)**: KIS 재무비율 분기값이 연초부터 누적인지 미확인(프로젝트 1 배포 후 확인 항목). 환경 변수 `FUNDAMENTALS_Q_CUMULATIVE` = `true`(누적 → 결산월 기준 같은 회계연도 직전 분기를 빼서 단독 분기 EPS 로) / `false`(단독) / **미설정이면 C 는 "준비 중"**. 연간(A)은 영향 없음.

### 종합 점수
- 가중치 C 20 · A 15 · N 15 · S 10 · L 20 · I 10 · M 10 = 100. 통과 항목의 가중치 합.
- 데이터 부족·준비 중 항목은 0점이고 상태로 구분해 표시. 통과 개수 "n/7" 함께.
- 유동성 표시: 20봉 평균 거래대금(종가×거래량) **10억 원 이상** 그리고 종가 **1,000원 이상** → `liquid`. 목록은 기본으로 유동성 종목만(퀴즈 생성과 같은 기준).

## 3. 계산·저장 (collector)

- 태스크 `collector.compute_canslim(as_of=None)` — 기준일 = `daily_prices` 의 최신 거래일(또는 인자).
  - **일일 파이프라인 끝에 추가**: 일봉 → 국내 지수 → 투자자 → **CANSLIM**(20:30 시작, 약 15분 뒤).
  - 토요일 재무 수집 뒤에도 한 번(같은 기준일 재계산 — 멱등).
  - `collector.backfill_canslim(days=60)` — 최근 60거래일을 한 번 채워 점수 추이·"언제부터 통과"를 보여준다(과거 날짜의 재무는 현재 값 사용 — 화면에 "실적은 최신 기준" 표기).
- 입력: 분석 대상(`market_repo.analysis_universe` — 보통주) 종목의 최근 260봉, 지수 최근 260봉, 투자자 최근 20일, 재무(연 5개·분기 9개), 프로필(시장·업종·결산월).
- 계산은 순수 함수 모듈(`apps/collector/canslim/`)로 — 항목별 함수 + RS 백분위 + 시장 상태 + 점수. CH 조회·저장과 분리해 경계값 테스트.
- 저장 CH:
  - `canslim_daily(date, ticker, market, sector_m, close, score UInt8, pass_count UInt8, liquid UInt8, c/a/n/s/l/i/m Int8(1 통과·0 미달·-1 부족·-2 준비 중), 근거 수치 Nullable(Float64) 컬럼들(c_growth, a_cagr, a_roe, n_pct_from_high, n_high_52w, s_ud_ratio, l_rs, l_rs_raw, sector_rs_rank, i_net_qty, i_buy_days, avg_value_20d), ingested_at)` ReplacingMergeTree(ingested_at), ORDER BY (date, ticker), PARTITION BY toYYYYMM(date).
  - `canslim_market(date, market, close, ma50, ma200, dist_days, status, ingested_at)` — 배너용(시장 2행/일).

## 4. API (stock_api GraphQL, 공개 — 로그인 불필요)

```graphql
canslimMarket: [CanslimMarket!]!            # 최신 기준일 KOSPI·KOSDAQ 상태
canslimScreen(market: String = "ALL", minPass: Int = 0, required: [String!] = [],
              sort: String = "score", liquidOnly: Boolean = true, limit: Int = 50, offset: Int = 0): CanslimScreen!
#   → { date, total, items: [{ ticker, name, market, sectorName, close, score, passCount,
#                             letters { c a n s l i m },  rs, pctFromHigh }] }
#   sort: score | rs | passCount, required: ["L","N"] 처럼 반드시 통과할 항목
canslimScore(ticker: String!): CanslimScore     # 없으면 null
#   → { date, ticker, name, market, sectorName, score, passCount,
#       letters: [{ key, status, value, threshold, label, explanation }],
#       history: [{ date, score, passCount }]  (최근 60거래일) }
```

- 항목 설명(`label`·`explanation`)은 서버 상수 — 초보자용 한 줄(예: L "최근 1년 수익률이 전체 종목 중 상위 20% 안에 드는지 봅니다").
- 조회는 `canslim_daily FINAL` 의 최신 date. 종목명·업종명은 PG `stock_meta`·`sectors` 조인(서비스 계층).

## 5. 웹 (web_client)

- 메뉴에 **"스크리너"** 추가(`/screener`) — 홈·커뮤니티·게임·스크리너·내정보.
- 화면 `/screener`(CANSLIM 탭 하나로 시작 — 이후 다른 프리셋이 탭으로 붙는다):
  - 맨 위: **시장 상태 배너**(KOSPI·KOSDAQ 각각 상승 추세/조정/하락 + 분산일) + "기준일 YYYY-MM-DD 종가 · 투자 권유가 아닙니다".
  - 필터: 시장(전체/KOSPI/KOSDAQ), 최소 통과 수(칩 0~7), 반드시 통과(C·A·N·S·L·I·M 토글), 정렬(점수·RS·통과 수), 유동성만(기본 켬).
  - **lg 이상 스플릿 뷰**: 왼쪽 목록(종목·점수·`C A N S L I M` 배지 ✅❌—·RS), 오른쪽 상세(일봉 차트 + 52주 고점선 + 50일선, 7항목 점수표, 점수 추이 미니 차트).
  - **lg 미만**: 목록 → 누르면 그 자리에서 펼쳐 상세(기획서의 아코디언).
  - 일봉 차트는 새 컴포넌트(`StockDailyChart`) — 게임 `TradingChart` 는 코치·포지션·분봉에 묶여 있어 재사용하지 않고, 데이터는 기존 `api/stock.getDailyCandles`·`lib/indicators` 를 쓴다.
- 비로그인 공개(차트·블로그와 같은 공개 범위). 디자인은 기존 토스 스타일 토큰.

## 6. 오류·빈 상태
- 아직 계산된 날이 없음 → "분석 데이터를 준비하고 있어요(매일 장 마감 후 갱신)".
- 조건에 맞는 종목 0 → 조건 완화 안내.
- 종목 점수 없음(ETF·우선주 등) → 상세에 "CANSLIM 분석 대상(보통주)이 아니에요".
- 계산 태스크는 종목 단위 실패 격리, 시장 지수 부족 시 M "데이터 부족"으로 나머지는 계속.

## 7. 테스트
- 순수 계산: 항목별 경계값(25%·85%·1.0·80·17%·5일·10일), 데이터 부족, 흑자 전환, 누적→단독 분기 변환(결산월 12·3·6), RS 백분위(동률·소수 종목), 분산일, M 상태 3종, 점수·통과 수.
- 저장·조회: 가짜 CH, 로컬 CH 임시 DB 로 DDL·FINAL.
- 태스크: 가짜 입력으로 한 기준일 전체 계산 → 행 수·값.
- GraphQL: 리졸버(필터·정렬·required·없는 종목).
- 웹: tsc·빌드, 화면은 브라우저(chrome-devtools MCP)로 목록·상세·좁은 화면 확인.

## 8. 배포 후 확인 (pending_checks)
- 첫 계산 로그(종목 수·통과 분포), 점수 상위 종목이 상식적인지(대형 주도주 L 상위 등), M 상태가 실제 시장 흐름과 맞는지.
- `FUNDAMENTALS_Q_CUMULATIVE` 를 재무 확인 결과로 설정 → C 켜짐.

## 9. 범위 밖
일반 프리셋(거래량 급증·골든크로스 등)·커스텀 필터, 앱 화면, 미국 종목 CANSLIM, 알림(새로 통과한 종목 푸시), 백테스트 화면.

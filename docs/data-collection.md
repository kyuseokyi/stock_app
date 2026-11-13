# 주식·시장 데이터 수집 — 전체 정리

> 2026-11-13 기준 코드(`backend/apps/collector`, `backend/apps/ai_analyst`)를 읽고 정리했다.
> 시각은 모두 한국 시간(KST). 스케줄 원본: `backend/apps/collector/celery_app.py` (celery beat).

## 1. 한눈에 보기

```
외부 원천                         수집(Celery 워커)                       저장                    쓰는 곳
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
KIS 마스터 파일(.mst, 키 불필요) → 종목 목록·프로필·업종·테마 동기화   → PostgreSQL            → 검색·업종·테마
KIS REST(실전 키)               → 일봉·지수·수급·재무·공모주·분봉      → ClickHouse            → 차트·시황·스크리너
KIS WebSocket                   → 게임 실시간 체결                     → Redis(틱)·CH(1분봉)   → 트레이딩 게임
KIS REST(장중 30초)             → 장중 지수·환율                       → Redis(10분 TTL)        → 시황 전광판
FRED API                        → 미국 거시 지표·발표일                → ClickHouse·PG 일정    → 시황·일정
pykrx(KRX 로그인, 선택)          → 투자자 수급 확정치                   → Redis                  → 시황 수급
네이버 검색 API·OpenDART·Gemini  → 뉴스·공시 → AI 해설                  → PostgreSQL·Redis       → AI 시황·종목 평가
                                 ↓ 매일 20:30 수집이 끝나면 같은 작업에서 계산
                                 CANSLIM → 시장 그룹(업종·테마) → 스크리너 → 차트 패턴 → ClickHouse
```

- 펀드 리포트는 서버가 수집하지 않는다. 앱이 사용자가 저장한 펀드 리포트 페이지(`fund.ivyro.net/dataroom/…`)를 **기기에서 직접** 받아 해석한다(`mobile/src/features/fund`).

## 2. 외부 원천과 키

| 원천 | 무엇 | 키·환경변수 | 없으면 |
|---|---|---|---|
| KIS 마스터 파일 `new.real.download.dws.co.kr/common/master/` | 전종목(`kospi_code.mst`·`kosdaq_code.mst`), 업종(`idxcode.mst`), 테마(`theme_code.mst`), 해외 지수 코드 | 없음(공개 파일) | `STOCK_MASTER_SOURCE=auto` 면 코드 안 대형주 목록으로 대체(검증용) |
| KIS Open API (REST·WS) | 시세·지수·수급·재무·공모주·순위·실시간 체결 | `KIS_APP_KEY`·`KIS_APP_SECRET`·`KIS_MODE`(prod=실전 / vps=모의) | 수집 실패. 게임 실시간은 가짜 틱(Mock)으로 동작 |
| FRED | 미국 CPI·실업률·금리 등 + 발표 예정일 | `FRED_API_KEY` | 거시 지표 수집 건너뜀 |
| pykrx (KRX 정보데이터시스템) | 시장 전체 투자자 순매수(연기금 포함) | `KRX_ID`·`KRX_PW` | KIS 수급(`investor_daily`)으로 대체 — 연기금 없음, 전 거래일일 수 있음 |
| 네이버 검색 API(API HUB) | 종목·급등락 뉴스 | 네이버 검색 키 | AI 해설이 뉴스 없이 생성되거나 건너뜀 |
| OpenDART | 공시 | DART 키 | 종목 정성 평가에서 공시 제외 |
| Gemini | AI 시황·해설 생성 | `GEMINI_API_KEY` | AI 태스크가 skipped 로 바로 끝남 |

KIS 키는 개발·상용이 **따로** 있어야 한다 — 초당 요청 한도와 실시간 연결이 키 단위라 같이 쓰면 서로 방해한다(→ 9장).

### 사용하는 KIS API

| API | 용도 |
|---|---|
| `quotations/inquire-daily-itemchartprice` | 종목 일봉(수정주가, 시장 UN→J 폴백) |
| `quotations/inquire-daily-indexchartprice` | 국내 지수(KOSPI·KOSDAQ·KOSPI200) 일봉·장중값 |
| `overseas-price/v1/quotations/inquire-daily-chartprice` | 미국 지수·원/달러·미국 대표 종목(기본 NVDA·MU·AAPL·MSFT·TSLA, `MARKET_INDEX_EXTRA` 로 추가) |
| `quotations/inquire-investor` | 종목별 개인·외국인·기관 순매수 |
| `finance/financial-ratio` | 연간·분기 재무비율(EPS·ROE 등) |
| `ksdinfo/pub-offer` | 공모주 청약·상장 일정 |
| `quotations/inquire-time-itemchartprice`·`inquire-time-dailychartprice` | 당일·과거 분봉(게임 분봉 보충) |
| `ranking/fluctuation` | 등락률 순위(급등락 AI) |
| WS `H0UNCNT0`(통합) / `H0STCNT0`(KRX) | 게임 실시간 체결 |

FRED 기본 시리즈: CPI·근원 CPI·근원 PCE·실업률·비농업 고용·기준금리·국채 10년·2년·10년-2년(`MACRO_SERIES_EXTRA` 로 추가).

## 3. 하루 일정 (celery beat)

| 시각 | 작업(태스크 이름) | 내용 |
|---|---|---|
| 06:30·07:30 화~토 | `collector.collect_market_indices` (US) | 미국 지수·환율·대표 종목. 07:30 은 안전망 |
| 08:00 매일 | `collector.collect_macro_series` | FRED 거시 지표 + 발표 예정일 → 일정 |
| 08:30 평일 | `ai.generate_morning_briefing` | AI 모닝 브리핑 |
| 08:30 토 | `ai.generate_weekly_briefing` | 주간 마감 브리핑 |
| 09:00~15:35 30초마다 | `collector.poll_intraday_indices` | 장중 KOSPI·KOSDAQ·KOSPI200·원/달러 → Redis. 장 밖이면 바로 끝남 |
| 09:10~15:30 2분마다 | `ai.refresh_market_movers_list` | 급등락 순위(KIS) |
| 09:10~15:30 10분마다 | `ai.analyze_market_movers` | 급등락 원인 AI 해설 |
| 15:40 평일 | `collector.collect_market_indices` (KR) | 국내 지수 확정 종가 |
| 15:45·18:10·22:00 평일 | `ai.collect_investor_flow` | 시장 수급(잠정 → 확정 → 파이프라인 뒤 당일 값) |
| 16:00 평일 | `ai.evaluate_screener_stocks` | 스크리너 통과 종목 정성 평가(DART·뉴스·Gemini) |
| **20:30 매일** | **`collector.daily_market_pipeline`** | **핵심 — 4장** |
| 21:30 매일 | `collector.collect_ipo_events` | 공모주 일정 |
| 토 10:00 | `collector.collect_fundamentals` | 재무비율(분석 대상 전종목, 약 6분) |
| 토 10:40 | `collector.compute_canslim` | 바뀐 재무로 CANSLIM 재계산 |

게임·알림 작업(시즌 정산 20:40, 퀴즈 21:00, 주간·월간 마감, 예약 푸시 1분마다)도 같은 스케줄에 있지만 데이터 수집은 아니다.
상시 실행 데몬: `apps/collector/run_game_ws.py` (게임 실시간 시세, 6장).

## 4. 일일 파이프라인 (20:30, `daily_market_pipeline`)

NXT 애프터마켓이 20:00 에 끝나야 통합(UN) 일봉이 확정되므로 20:30 에 돈다. 한 작업 안에서 **차례로** 실행해 KIS 초당 한도를 단계끼리 나눠 쓰지 않는다. 앞 단계가 실패해도 다음 단계는 진행하고, 단계별 성공·시간·요약은 Redis 에 남아 관리자 "데이터 현황"에 보인다.

| 순서 | 단계 | 하는 일 | 저장 |
|---|---|---|---|
| 0 | 마스터 동기화 | `.mst` 를 받아 `stock_meta` 갱신(신규상장 추가·상장폐지 비활성), 같은 원문으로 종목 프로필·업종·테마 동기화(실패해도 수집 계속) | PG `stock_meta`·`stock_profile`·`sectors`·`themes`·`theme_stocks` |
| 1 | 전종목 일봉 | 최근 30일 ~ +2일 **겹쳐서** 다시 받기 → 이동평균 계산 → 적재. 스레드 `KIS_WORKERS`(기본 4) 병렬, 초당 `KIS_RATE_PER_SEC`(실전 기본 15) | CH `daily_prices` |
| 2 | 국내 지수 | 15:40 수집의 안전망(같은 날짜 덮어쓰기) | CH `market_index_daily` |
| 3 | 종목별 투자자 수급 | 분석 대상 보통주, 최근 약 30거래일(UN→J 폴백) | CH `investor_daily` |
| 4 | CANSLIM | 종목·시장 점수 | CH `canslim_daily`·`canslim_market` |
| 5 | 시장 그룹 | 업종·테마별 등락률·순위 | CH `market_group_daily`·`market_stock_daily` |
| 6 | 스크리너 | 조건검색 지표 | CH `screener_daily` |
| 7 | 차트 패턴 | 기준일 하루를 지우고 다시 적재 | CH `chart_pattern_daily` |

## 5. 수집 규칙 (반드시 지킬 것 — CLAUDE.md 와 같음)

1. **국내 시세는 UN(KRX+넥스트레이드 통합) 먼저, 빈 응답이면 J(KRX)** — MTS 차트와 같은 값. NXT 미상장 종목은 UN 이 비어 있다.
2. **수정주가** `FID_ORG_ADJ_PRC='0'` — 액면분할·병합만 반영, 배당은 반영 안 됨.
3. **전종목 목록은 매 수집마다 `.mst` 재로드** — KIS 시세 API 는 목록을 주지 않는다.
4. **멱등 적재** — `daily_prices` 는 `ReplacingMergeTree(ingested_at)`, 조회는 항상 `FINAL`. 겹쳐 다시 받아도 날짜당 1행.
5. **지수는 UN→J 대상이 아니다** — 업종 지수 TR(시장 코드 U)을 쓴다.
6. **장중 값은 ClickHouse 에 쓰지 않는다** — 확정 종가 이력을 오염시키지 않게 Redis 에만(10분 TTL).
7. **백필의 이동평균은 전체 시계열을 이어 붙인 뒤 한 번에 계산** — 청크마다 계산하면 MA120 이 깨진다.

## 6. 실시간 — 트레이딩 게임 (`run_game_ws.py`)

- 진행 중인 시즌 종목을 60초마다 확인해 바뀌면 구독을 갈아탄다.
- 체결 TR: 기본 `H0UNCNT0`(통합, NXT 애프터마켓 20:00 까지 틱), NXT 미상장이면 `H0STCNT0`. `GAME_WS_TR_ID` 로 강제 가능.
- 틱 → Redis `stock:tick:{ticker}` 발행, 1분봉으로 묶어 CH `game_minute_bars`. 장 상태는 `stock:status:{ticker}`(실전 키만).
- 시작·종목 전환 때 오늘 분봉과 과거 30거래일 분봉을 KIS 로 보충한다(보조지표 준비).
- KIS 키가 없거나 `MOCK_TICK_STREAM=true` 면 가짜 틱으로 동작한다.

## 7. 저장소 정리

| 저장소 | 테이블·키 | 내용 |
|---|---|---|
| PostgreSQL | `stock_meta` | 전종목 단일 마스터(수집 대상·검색 공용) |
| | `stock_profile`·`sectors`·`themes`·`theme_stocks` | 종목 프로필(시가총액·업종 코드 등)·업종 이름·테마(관리자 보정 포함) |
| | `stock_events` | 일정(공모주·FRED 발표일) |
| | `ai_daily_briefings`·`ai_stock_evaluations` | AI 브리핑·종목 평가 |
| ClickHouse | `daily_prices` | 종목 일봉 + 이동평균 |
| | `market_index_daily` | 국내·미국 지수·환율·미국 대표 종목 |
| | `investor_daily` | 종목별 투자자 순매수 |
| | `fundamentals`·`fundamentals_periodic` | 재무비율(연간·분기) |
| | `macro_series` | FRED 거시 지표 |
| | `canslim_*`·`market_group_daily`·`market_stock_daily`·`screener_daily`·`chart_pattern_daily` | 계산 결과 |
| | `game_minute_bars` | 게임 1분봉 |
| Redis | `kis:token:*`·`kis:approval:*` | KIS 토큰 공유 캐시(워커끼리 발급 제한 회피) |
| | `market:intraday` | 장중 지수·환율 |
| | `stock:tick:*`·`stock:status:*` | 게임 실시간 |
| | `admin:bootstrap:progress`, 파이프라인 기록 | 관리자 진행 현황 |

## 8. 처음 채우기·다시 채우기·점검

| 작업 | 어떻게 | 비고 |
|---|---|---|
| **초기 데이터 준비** | 관리자 화면 버튼 → `collector.bootstrap_data` | 새 서버용. 수집 1~7 → 계산 8~11 을 순서대로. 16:00~21:30 에는 시작 안 함(정기 수집과 KIS 한도 충돌 방지). 다시 누르면 이어서 채움 |
| 전종목 장기 백필 | `collector.backfill_all_daily` | 개월 수 지정, 청크로 받아 이동평균은 한 번에 |
| 계산 60일 백필 | CANSLIM·시장 그룹·스크리너 태스크 | 과거 날짜도 **현재** 재무·테마·상장주식수로 계산(근사) |
| 표본 점검 | `apps/collector/verify/spot_check.py` | 우리 UN 일봉 vs KRX(pykrx): 고가 ≥, 저가 ≤, 거래량 ≥ 이면 정상. 내부 테이블끼리도 비교 |
| 수동 1종목 | `collect_daily_ohlcv(ticker)`, `backfill_domestic_daily(ticker, months)` | 확인·복구용 |

## 9. 운영 주의

- **KIS 키는 환경마다 따로.** 초당 한도(실전 약 20건/초)와 실시간 연결이 키 단위다. 개발·상용이 한 키로 20:30 수집을 같이 돌리면 합계가 한도를 넘는다. 상용 출시 때 계좌를 추가해 상용 키를 새로 받는다.
- **모의투자 키(vps)는 권하지 않는다.** 초당 한도가 낮고(기본 8), 장운영정보 등 일부 API 가 지원되지 않는다.
- **부분 실패는 숨지 않는다.** 종목 하나의 실패는 격리되고(나머지 계속), 단계 결과는 관리자 "데이터 현황"에서 본다. 연결 오류는 적응형 쿨다운 후 재시도, 4xx 는 즉시 실패.
- 공휴일은 따로 거르지 않는다 — KIS 가 빈 응답을 준다.

## 10. 알려진 한계·남은 일

- 배당 수정주가 미반영(KIS 한계).
- 업종은 KIS 분류(중분류, 비제조업은 대분류 — `shared/sector_group.py`). 거래소 새 분류 **KRICS**(섹터 9·산업 60, 2026-12 지수 적용) 확정 후 섹터·업종 분리 검토.
- pykrx 수급 컬럼명은 실호출 미검증.
- 다우(.DJI) 코드는 마스터에 없어 실호출로만 확인.
- 장중 지수 KIS 응답 실측(Task 4) 결과 대기.
- 과거 날짜 계산 백필은 현재 소속·재무 기준 근사.

## 관련 문서

- 장중 지수 설계: `docs/superpowers/specs/2026-10-20-intraday-index-design.md`
- 초기 데이터 준비 설계: `docs/superpowers/specs/2026-10-22-data-bootstrap-design.md`
- 스크리너: `docs/screener_plan.md`, 트레이딩 게임: `docs/trading_game_plan.md`
- 배치(Celery) 입문: `docs/handover/07-batch-celery.md`

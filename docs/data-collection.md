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
  - 펀드공시(`operating_margin(v3.0).files/sheet001.htm`, 모든 펀드 공통, **EUC-KR**)도 기기에서 받아, 리포트 기준일과 같은 날의 **당일 연환산 수익률·장중 거래내용**을 첫 섹션 `총 계` 카드에 붙인다(`core/disclosure.ts`). 앱은 Hermes 가 euc-kr 을 몰라 CP949 표(`euc-kr-table.ts`, `scripts/gen-euc-kr-table.py`)로 해독, 웹은 `TextDecoder('euc-kr')`. 못 받거나 같은 날짜가 없으면 표시만 생략.

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
| 4 | 세부 투자자 수급(`investor_detail`) | 같은 분석 대상 보통주의 연기금(기금)·사모·투신·은행·보험·기타금융 순매수 — KIS `FHPTJ04160001`, UN→J 폴백. ⚠️ **KST 00:00~15:40 조회 불가**(rt_cd=2 `TIME LIMIT 00:00 ~ 15:40`, 2026-11-16 상용 실측) — 그 시간엔 호출 없이 건너뛰고(초기 데이터 준비에서는 이 단계만 "건너뜀"), 수동 백필은 15:40 이후에 실행. 매일은 최근 5거래일을 겹쳐 받고(하루 실패가 연속 일수 구멍으로 남지 않게), 30거래일 백필은 매일 단계에서 하지 않고 **수동 `collector.backfill_investor_detail` 또는 관리자 '초기 데이터 준비'**로 낮 시간에 한다(뒤 단계가 밀리지 않게) | CH `investor_detail_daily` |
| 4-1 | 대차잔고(`lending`, 키움) | 같은 분석 대상 보통주의 종목별 대차잔고 추이 — 키움 `ka20068`, 매일 최근 5거래일 겹침. **키움 키가 있을 때만**(상용) — 없으면 `{"skipped": "키움 키 없음"}`(개발 서버). 60거래일 백필은 수동 `collector.backfill_lending` | CH `stock_lending_daily` |
| 5 | CANSLIM | 종목·시장 점수 | CH `canslim_daily`·`canslim_market` |
| 5-1 | 테마(`themes_kiwoom`, 키움) | 키움 `ka90001`(전체 테마)·`ka90002`(테마별 구성 종목) 스냅숏 교체 — 아래 "테마 출처". **키움 키가 있을 때만**(상용) — 없으면 `{"skipped": "키움 키 없음"}`(개발 서버, KIS 마스터 그대로). 실패하면 지난 스냅숏 유지 | PG `themes`·`theme_stocks`(`source=kiwoom`) |
| 6 | 시장 그룹 | 업종·테마별 등락률·순위(테마는 "테마 출처"가 고른 멤버십) | CH `market_group_daily`·`market_stock_daily` |
| 7 | 스크리너 | 조건검색 지표(연기금 연속 순매수 일수 `pension_buy_days`·대차잔고 5거래일 증감률 `lending_chg5` 포함) | CH `screener_daily` |
| 8 | 차트 패턴 | 기준일 하루를 지우고 다시 적재 | CH `chart_pattern_daily` |

### 세부 투자자 수급(`investor_detail_daily`)

설계 `docs/superpowers/specs/2026-11-16-pension-buy-preset-design.md`. 기존 `investor_daily`(개인·외국인·기관 3분류)는 그대로 두고 따로 쌓는다.

- **TR**: `FHPTJ04160001` 종목별 투자자매매동향(일별), `GET /uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily`. 파라미터 `FID_COND_MRKT_DIV_CODE`(UN→J)·`FID_INPUT_ISCD`·`FID_INPUT_DATE_1`(YYYYMMDD)·`FID_ORG_ADJ_PRC`·`FID_ETC_CLS_CODE`(둘 다 공란). 일자별 행은 `output2`(`output1` 은 현재가 요약이라 안 씀). 출처: 한투 공식 예제 `koreainvestment/open-trading-api` `examples_llm/domestic_stock/investor_trade_by_stock_daily/`.
- **연속조회**: 예제는 응답 헤더 `tr_cont` 로 다음 장을 받지만, 우리 클라이언트는 `FID_INPUT_DATE_1` 을 '받은 가장 이른 날짜 − 1일' 로 옮겨 다시 부른다(0행·더 이른 날 없음·최대 40장에서 멈춤). 시장코드는 첫 장에서 정한 것을 유지.
- **컬럼**(모두 `Int64`, 순매수 = KIS 의 `*_ntby_*` 값 그대로):

| 컬럼 | KIS 필드(수량 / 금액) | 뜻 |
|---|---|---|
| `pension_qty`·`pension_amt` | `fund_ntby_qty` / `fund_ntby_tr_pbmn` | 기금(연기금) |
| `private_eq_qty`·`private_eq_amt` | `pe_fund_ntby_vol` / `pe_fund_ntby_tr_pbmn` | 사모 펀드(수량 필드만 `_vol`) |
| `invtrust_qty`·`invtrust_amt` | `ivtr_ntby_qty` / `ivtr_ntby_tr_pbmn` | 투자신탁 |
| `bank_qty`·`bank_amt` | `bank_ntby_qty` / `bank_ntby_tr_pbmn` | 은행 |
| `insurance_qty`·`insurance_amt` | `insu_ntby_qty` / `insu_ntby_tr_pbmn` | 보험 |
| `other_fin_qty`·`other_fin_amt` | `mrbn_ntby_qty` / `mrbn_ntby_tr_pbmn` | 종금(기타금융으로 추정 — **명세 확인 필요**) |

- `ReplacingMergeTree(ingested_at)`, `PARTITION BY toYYYYMM(date)`, `ORDER BY (ticker, date)` — 조회는 `FINAL`. 수집 태스크가 처음 돌 때 자동 생성.
- **명세 확인 필요**: 한 번 호출에 몇 거래일을 주는지, 금액(`*_tr_pbmn`) 단위(백만원으로 가정 — `investor_detail.DETAIL_AMT_TO_WON`, 저장은 원값), 기타금융 필드. 프리셋은 **수량**으로 판정해 금액 단위와 무관.
- **호출량**: 종목당 1장(UN) + NXT 미상장 종목은 J 1장 더. 한 장이 30거래일 이상을 주면 백필도 같은 비용이고, 하루씩만 주면 백필은 종목당 최대 30장이 된다. 소요 ≈ 호출 수 ÷ `KIS_RATE_PER_SEC`(실전 15/초).
- **수동 백필**: `collector.backfill_investor_detail`(기본 `days=30`, `end` 생략 시 오늘 KST).
- **첫 실행 판정은 테이블 전체 기준** — 첫 백필이 일부 종목만 성공해도 다음부터는 5거래일 모드다. 배포 직후 20:30 전 낮에 수동 백필을 한 번 돌리는 것을 권한다(안 하면 첫 20:30 파이프라인 안에서 30거래일 백필이 돌아 뒤 단계가 늦어진다).

### 대차잔고(`stock_lending_daily`, 키움)

설계 `docs/superpowers/specs/2026-11-16-kiwoom-lending-design.md`. 키움은 상용 서버 IP 만 허용돼 **상용에서만 행이 생긴다**.

- **TR**: `ka20068` 대차거래추이요청(종목별), `POST /api/dostk/slb`, body `strt_dt`·`end_dt`(YYYYMMDD)·`all_tp="0"`(입력 종목만)·`stk_cd`(**6자리, 접미사 없음** — 명세 length 6, 일봉 `ka10081` 의 `_AL` 과 다름). 응답 배열 `dbrt_trde_trnsn`(예시는 최신→과거). 연속조회 `cont-yn`·`next-key`(최대 10쪽). 출처: 키움 공식 명세 GitHub `Kiwoom-Securities/Kiwoom-REST-API` `kiwoom/_data/kiwoom_api_spec.json`(c7a3d25).
- **컬럼**(모두 `Int64`):

| 컬럼 | 키움 필드 | 명세 단위 → 저장 |
|---|---|---|
| `new_qty` | `dbrt_trde_cntrcnt` 대차거래체결주수 | 1주 |
| `repay_qty` | `dbrt_trde_rpy` 대차거래상환주수 | 1주 |
| `net_qty` | `dbrt_trde_irds` 대차거래증감 | 1주(부호 유지, 상환이 많으면 음수) |
| `balance_qty` | `rmnd` 잔고주수 | 1주 |
| `balance_amt` | `remn_amt` 잔고금액 | 백만원 → **원**(× 1,000,000) |

- `ReplacingMergeTree(ingested_at)`, `PARTITION BY toYYYYMM(date)`, `ORDER BY (ticker, date)` — 조회는 `FINAL`. `ensure_market_tables` 가 만들므로 개발 서버에도 빈 테이블이 생긴다.
- **기간**: 거래일 → 달력일 `거래일 × 7/5 + 4`(`kiwoom/lending.calendar_start`) — 매일 5거래일 = 11일, 백필 60거래일 = 88일.
- **오류 처리**: 키움 키 없음 → 아무것도 건드리지 않고 skipped. 8010(등록 IP 밖)·미설정 → 경고 1회, 나머지를 부르지 않고 skipped. **첫 종목**에서 키움 논리 오류(시간 제한 등) → 나머지를 부르지 않고 `error`(헛호출 방지). 그 뒤 종목의 오류는 그 종목만 실패로 세고 계속. 0행(대차 없음)은 정상.
- **호출량**: 종목당 1쪽(5·60거래일 모두 대개 1쪽 — 쪽당 행 수는 명세에 없어 probe 로 확인) × 약 2,600종목 ÷ `KIWOOM_RATE_PER_SEC`(기본 4/초) ≈ **11분**. 20:30 파이프라인의 CANSLIM·스크리너가 그만큼 늦게 끝난다.
- **스크리너** `screener_daily.lending_chg5` = (기준점 잔고 − 5거래일 전 잔고) ÷ 5거래일 전 잔고 × 100. 기준점은 기준일부터 **최대 2거래일 늦은** 대차 행까지 허용(20:30 계산 때 당일 대차가 아직 공시되지 않았을 수 있어서 — probe 의 "최신 행" 날짜로 확인), 5거래일 전 잔고가 0·없으면 NULL. 프리셋 `lending_drop` = `lending_chg5 <= -20`.
- **조회**: `GET /api/v1/stocks/{ticker}/lending?days=120`(stock_api 공개) → `[{date, balance_qty, net_qty, balance_amt}]` 오래된 순, 없으면 `[]`. 웹·앱 종목 상세 '대차잔고' 섹션(데이터 없으면 숨김).
- **수동 백필**: `collector.backfill_lending`(기본 `days=60`, `end` 생략 시 오늘 KST). 끝나면 `collector.backfill_screener` 로 `lending_chg5` 과거 값을 채운다. 초기 데이터 준비(`bootstrap_data`)에도 '대차잔고 60거래일' 단계로 들어 있다.

### 테마 출처 (키움 스냅숏 ↔ KIS 마스터, 2026-11-17)

설계: [`docs/superpowers/specs/2026-11-17-kiwoom-themes-design.md`](superpowers/specs/2026-11-17-kiwoom-themes-design.md). KIS `theme_code.mst` 는 2025-11 이후 갱신이 없어 오래된 테마가 섞인다 → 키움 키가 있는 서버(상용)는 키움 테마로 교체.

- **가져오는 것**: 테마 목록(코드·이름)과 테마별 구성 종목뿐. 순위·등락·기간수익률은 지금처럼 우리 일봉(UN)으로 계산 — 키움 등락률은 저장·표시하지 않는다. 시장 그룹 계산·화면·API 응답 구조는 그대로, **테마 멤버십의 출처만** 바뀐다.
- **저장**: 기존 PG `themes`·`theme_stocks` 를 그대로 쓴다(마이그레이션 없음). 키움 테마는 `themes.source='kiwoom'`, 코드는 `kis_code` 에 **`KW` 접두사**(예 `KW319` — KIS 3자리 코드와 겹치지 않게), 연결은 `theme_stocks.source='kiwoom'`. KIS 동기화는 `source=kis` 행만, 키움 동기화는 `source=kiwoom` 행만 바꾼다.
- **스냅숏 교체**(`market_repo.sync_kiwoom_themes`, 한 트랜잭션·멱등): 스냅숏에 없는 키움 테마는 행을 지우지 않고(숨김 등 보정 보존) 키움 연결만 지운다 → 계산에서 빠짐. 성공할 때마다 키움 테마 `updated_at` 을 갱신해 **스냅숏 날짜**(KST)로 쓴다.
- **검증 후 쓰기**(`kiwoom/themes.run_themes`): 테마 수 < 100, 목록(ka90001) 실패, **첫 테마** ka90002 에서 키움 논리 오류(→ 나머지 호출 중단), 구성 종목 실패 > 5% 이면 **쓰지 않는다**(지난 스냅숏 유지). 5% 이하면 쓰되 실패 테마는 기존 연결 유지. 키 없음·8010 → skipped.
- **출처 선택**(`market_repo.active_theme_source`): 구성 종목이 있는 키움 테마가 **100개 이상**이면 `kiwoom`, 아니면 `kis`(키움 스냅숏이 한 번도 없거나 너무 적을 때의 안전한 폴백). 데이터만 보고 정하므로 키 없는 개발 서버는 늘 `kis` 로 지금과 같다. 관리자 테마(`source=admin`)는 어느 출처든 함께 쓴다. `market_repo.theme_groups` 가 이 규칙으로 거르므로 시장 그룹 계산·마켓 테마 상세·데이터 검증·표본 점검이 같은 멤버십을 본다.
- **관리자 테마 보정**: 목록은 지금 출처 + 관리자 테마만. 키움 테마는 코드가 달라 KIS 테마에 했던 숨김·제외가 이어지지 않는다(정상 — 필요하면 키움 테마에 다시). 화면 위에 출처·스냅숏 날짜(`GET /api/v1/admin/themes/source`).
- **호출량**: ka90001 연속조회 몇 쪽 + 테마 수(수백) × ka90002 1쪽 ÷ `KIWOOM_RATE_PER_SEC`(기본 4/초) → 테마 300개면 약 **1.5분**, 500개면 약 2분.
- **한계**: 과거 테마 구성 이력은 없다 — 60일 백필도 현재 스냅숏으로 계산(근사). 출처가 바뀐 첫날은 테마 id 가 달라 `market_group_daily` 의 KIS 테마 행이 숨김 행으로 덮이고, 순위 추이는 `backfill_market_groups` 로 다시 채운다.
- **수동 실행**: `collector.collect_themes_kiwoom`(인자 없음) → `collector.backfill_market_groups`.

## 5. 수집 규칙 (반드시 지킬 것 — CLAUDE.md 와 같음)

1. **국내 시세는 UN(KRX+넥스트레이드 통합) 먼저, 빈 응답이면 J(KRX)** — MTS 차트와 같은 값. NXT 미상장 종목은 UN 이 비어 있다.
2. **수정주가** `FID_ORG_ADJ_PRC='0'` — 액면분할·병합만 반영, 배당은 반영 안 됨.
3. **전종목 목록은 매 수집마다 `.mst` 재로드** — KIS 시세 API 는 목록을 주지 않는다.
4. **멱등 적재** — `daily_prices` 는 `ReplacingMergeTree(ingested_at)`, 조회는 항상 `FINAL`. 겹쳐 다시 받아도 날짜당 1행.
5. **지수는 UN→J 대상이 아니다** — 업종 지수 TR(시장 코드 U)을 쓴다.
6. **장중 값은 ClickHouse 에 쓰지 않는다** — 확정 종가 이력을 오염시키지 않게 Redis 에만(10분 TTL).
7. **백필의 이동평균은 전체 시계열을 이어 붙인 뒤 한 번에 계산** — 청크마다 계산하면 MA120 이 깨진다.

### 일봉 키움 폴백 (2026-11-16)

전종목 일봉(`collect_all_daily`, 20:30 1단계)과 전종목 백필(`backfill_all_daily`)에만 붙는다. 지수·수급·분봉, 단일 종목 태스크(`collect_daily_ohlcv`·`backfill_domestic_daily`)는 대상이 아니다.

- **언제**: KIS 1차·2차 패스(쿨다운·연결계열 재시도 포함)가 **다 끝난 뒤**, 최종 실패 종목과 UN·J 모두 빈 응답(기간 전체 0행)이었던 종목만 키움 `ka10081` 로 같은 기간을 받는다. KIS 정상 경로의 동작·호출 횟수는 그대로다. 백필에서 일부 청크만 빈 건(상장 전 구간) 대상이 아니다.
- **어떻게**: 종목코드는 항상 `{ticker}_AL`(= KIS UN, NXT 미상장도 KRX 값 — 실측), 수정주가(`upd_stkpc_tp=1`), `base_dt`=기간 끝(미래면 오늘 KST). 시작보다 이른 행이 나올 때까지 연속조회(상한 10쪽) 후 기간으로 자르고, KIS 일봉과 같은 모양으로 바꿔 같은 MA 계산·저장 함수로 `source='kiwoom'` 적재. 키움 클라이언트는 실행당 1개, 순차, 초당 `KIWOOM_RATE_PER_SEC`. 대상이 없으면 클라이언트를 만들지 않는다.
- **켜짐**: 키움 키가 있고 `KIWOOM_FALLBACK_ENABLED` 가 `false`/`0`/`no`/`off` 가 아님(기본 켜짐). 개발 서버는 키가 없어 꺼진다 — 결과 dict 도 예전과 같다.
- **실패**: 키움도 못 채우면 그 종목은 KIS 실패 그대로. 8010(등록 IP 밖)·미설정은 경고 1회 후 그 실행의 폴백을 끈다. 빈 응답 종목은 키움도 비면 그대로 성공(0행).
- **출처**: `daily_prices.source LowCardinality(String) DEFAULT 'kis'` — 첫 키움 적재 직전에 `ALTER … ADD COLUMN IF NOT EXISTS` 로 보장(`init_clickhouse` 도). KIS 적재는 컬럼을 생략해 `kis`. 다음 날 KIS 겹침 수집이 같은 날짜를 다시 넣으면 `ingested_at` 이 최신인 KIS 행이 이겨 출처가 `kis` 로 돌아온다.
- **집계**: 결과 dict 에 `kiwoom_fallback`(키움으로 채운 종목 수 — 실패 회복 + 빈 응답 채움)·`kiwoom_failed`(키움도 실패). 키움으로 회복한 실패 종목은 `ok` 에 더하고 `failed_count`·`failed_sample` 에서 뺀다. 관리자 파이프라인 카드는 요약 JSON 을 그대로 보여 준다.
- **점검(상용)**: `SELECT source, count(), uniqExact(ticker) FROM stock_data.daily_prices FINAL WHERE date >= today() - 7 GROUP BY source`

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
| ClickHouse | `daily_prices` | 종목 일봉 + 이동평균. `source`(`kis` 기본 / `kiwoom` 폴백) — 조회·응답에는 안 씀 |
| | `market_index_daily` | 국내·미국 지수·환율·미국 대표 종목 |
| | `investor_daily` | 종목별 투자자 순매수(개인·외국인·기관) |
| | `investor_detail_daily` | 종목별 세부 투자자 순매수(연기금·사모·투신·은행·보험·기타금융) |
| | `stock_lending_daily` | 종목별 대차잔고 추이(키움 ka20068, 상용에서만 행이 생김) |
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
| **초기 데이터 준비** | 관리자 화면 버튼 → `collector.bootstrap_data` | 새 서버용. 수집 1~9('연기금 등 세부 수급 30거래일'·'대차잔고 60거래일' 포함) → 계산(CANSLIM → '테마(키움)' → 시장 그룹 → 조건검색 → 패턴)을 순서대로. 16:00~21:30 에는 시작 안 함(정기 수집과 KIS 한도 충돌 방지). 세부 수급은 15:40 전, 대차잔고·테마(키움)는 키움 키가 없으면(개발 서버) 그 단계만 '건너뜀'. **21:30 이후에 누르면 모든 단계가 한 번에 채워진다**. 다시 누르면 이어서 채움 |
| 전종목 장기 백필 | `collector.backfill_all_daily` | 개월 수 지정, 청크로 받아 이동평균은 한 번에 |
| 세부 투자자 30거래일 백필 | `collector.backfill_investor_detail` | `{"days": 30}` 기본. 끝나면 `collector.backfill_screener` 로 `pension_buy_days` 과거 값을 채운다 |
| 키움 테마 스냅숏(상용) | `collector.collect_themes_kiwoom` | 인자 없음, 키움 키 없으면 skipped. 끝나면 `collector.backfill_market_groups` 로 순위 추이를 새 테마로 채운다 |
| 대차잔고 60거래일 백필(상용) | `collector.backfill_lending` | `{"days": 60}` 기본, 키움 키 없으면 skipped. 끝나면 `collector.backfill_screener` 로 `lending_chg5` 과거 값을 채운다 |
| 계산 60일 백필 | CANSLIM·시장 그룹·스크리너 태스크 | 과거 날짜도 **현재** 재무·테마·상장주식수로 계산(근사) |
| 표본 점검 | `apps/collector/verify/spot_check.py` | 우리 UN 일봉 vs KRX(pykrx): 고가 ≥, 저가 ≤, 거래량 ≥ 이면 정상. 내부 테이블끼리도 비교 |
| 수동 1종목 | `collect_daily_ohlcv(ticker)`, `backfill_domestic_daily(ticker, months)` | 확인·복구용 |

## 9. 운영 주의

- **KIS 키는 환경마다 따로.** 초당 한도(실전 약 20건/초)와 실시간 연결이 키 단위다. 개발·상용이 한 키로 20:30 수집을 같이 돌리면 합계가 한도를 넘는다. 상용 출시 때 계좌를 추가해 상용 키를 새로 받는다.
- **모의투자 키(vps)는 권하지 않는다.** 초당 한도가 낮고(기본 8), 장운영정보 등 일부 API 가 지원되지 않는다.
- **부분 실패는 숨지 않는다.** 종목 하나의 실패는 격리되고(나머지 계속), 단계 결과는 관리자 "데이터 현황"에서 본다. 연결 오류는 적응형 쿨다운 후 재시도, 4xx 는 즉시 실패.
- 공휴일은 따로 거르지 않는다 — KIS 가 빈 응답을 준다.
- 키움 폴백을 잠시 끄려면 `KIWOOM_FALLBACK_ENABLED=false` 후 collector 재시작(키움 키는 그대로 둬도 된다).

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
- 키움증권 REST API 연동: `docs/kiwoom_setup_and_dev_spec.md`
- 스크리너: `docs/screener_plan.md`, 트레이딩 게임: `docs/trading_game_plan.md`
- 배치(Celery) 입문: `docs/handover/07-batch-celery.md`

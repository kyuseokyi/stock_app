# 시장 데이터 수집 기반 (프로젝트 1) — 설계

> 상태: 설계 확정 대기 · 작성 2026-10-18
> 상위 맥락: 스크리너 기획 브레인스토밍. 스크리너·주달 기능을 독립 프로젝트 3개로 분해했고 이 문서는 그중 **프로젝트 1(데이터 수집 기반)**.
> - 프로젝트 2 — CANSLIM 분석(계산 `canslim_daily`·GraphQL·웹 화면). 이 문서의 데이터를 사용
> - 프로젝트 3 — 주달 화면(업종·테마 트리맵, 테마 랭킹, 관리자 테마 보정 UI, 일정 캘린더, 뉴스·AI 요약)
> - 별도 로드맵 — 미국 개별 주식 + 미국 CANSLIM(재무 출처 조사 포함)

## 1. 목표

CANSLIM(프로젝트 2)과 주달 화면(프로젝트 3)이 쓰는 데이터를 **공식 경로로만** 매일·매주 자동 수집해 저장한다.
화면·분석 로직은 범위 밖이며, 이 프로젝트가 끝나면 "데이터가 쌓이고 있다"가 완료 기준이다.

### 사용자 결정 (2026-10-17~18)
- CANSLIM 은 단계적 → 이번 수집으로 7개 항목 모두의 데이터를 확보(재무 포함)
- 네이버 증권 크롤링 안 함(`robots.txt` `Disallow: /`) — 로드맵 "추후 확인"에 등록
- 지수: 국내 + 해외 주요. **미국이 중요** — 미국 전 종목은 아니고 주요 지표(반도체지수 등)·거시 경제지표(CPI 등)
- 미국 개별 주식·미국 CANSLIM 은 다음 프로젝트
- 추가 API 키가 필요하면 무엇을 어디서 발급하는지 기록해 둔다(값은 저장하지 않음) → 10절

## 2. 데이터 기간 점검 (2026-10-18)

로컬 CH 측정(개발 서버는 터널 미기동으로 미측정 — 같은 백필 + 매일 수집이라 약 2개월 더 김).

| 데이터 | 현재 | 필요 | 판정 |
|---|---|---|---|
| 종목 일봉 `daily_prices` | 2025-05-29 ~ 2026-08-18, 종목당 중앙값 298봉, 253봉 이상 3,360/3,932(85%) | N 52주 252봉 · L RS 253봉 · S 50봉 | 충분. 나머지는 상장 1년 미만 → 프로젝트 2 에서 "데이터 부족" 표시. 더 길게 필요하면 기존 `backfill_all_daily(months=24)` 1회 |
| 지수 | 없음 | M 200일선 + 분산일 25일 ≈ 230봉 | 신규 — 첫 실행 2년 백필 |
| 재무 | `fundamentals` 비어 있음 | C 분기 5개(가속 8개) · A 연간 4개 | 신규 — KIS 가 주는 기간 수는 첫 실호출로 확인 |
| 투자자별 매매 | 없음 | I 최근 20거래일 | 신규 — KIS 응답이 최근 약 30일이라 첫날 30일, 이후 매일 누적 |

## 3. 수집 항목

| # | 항목 | 출처 | 저장 | 주기 | 호출 수 |
|---|---|---|---|---|---|
| 1 | 종목 프로필(업종·시총·상장주식수·상장일·상태 표시) | `.mst` 뒤쪽 필드(이미 매일 다운로드) + `idxcode.mst` | PG `stock_profile`, `sectors` | 매일(기존 마스터 동기화 때) | 0 |
| 2 | 테마 | KIS `theme_code.mst` + 관리자 보정 | PG `themes`, `theme_stocks` | 매일 | 0 |
| 3 | 지수·시장지표(국내·해외·환율·금리·대표 종목) | KIS `FHKUP03500100`(국내), `FHKST03030100`(해외) | CH `market_index_daily` | 매일 | 지표 수만큼(≈15) |
| 4 | 투자자별 순매수 | KIS `FHKST01010900` | CH `investor_daily` | 매일 | ≈ 분석 대상 종목 수 |
| 5 | 재무비율(연간·분기 EPS·ROE 등) | KIS `FHKST66430300` | CH `fundamentals_periodic` | 매주 토 + 수동 | ≈ 분석 대상 × 2 |
| 6 | 공모주 청약 일정 | KIS 예탁원 `HHKDB669108C0` | PG `stock_events` | 매일 | 1~수 회 |
| 7 | 미국 거시 경제지표(CPI 등) | FRED API(`FRED_API_KEY`, 없으면 건너뜀) | CH `macro_series` + PG `stock_events`(발표 예정일) | 매일 | 지표 수만큼(≈10) |

**분석 대상 종목(공통 유니버스)**: `stock_profile` 기준 ETP·SPAC·우선주 제외(관리종목·거래정지는 포함하되 표시). 4·5번은 이 범위만 호출해 낭비를 줄인다(약 2,500개 예상 — 첫 동기화 후 실측).

## 4. 항목별 설계

### 4.1 종목 프로필 — `.mst` 확장
- 근거: KIS 공식 `stocks_info/kis_kospi_code_mst.py`·`kis_kosdaq_code_mst.py` 의 `field_specs`·`part2_columns`.
- **뒤쪽 고정폭 길이가 다르다**: KOSPI 228, KOSDAQ 222. 현재 `_parse_front` 는 둘 다 228 로 자른다 — 이름은 공백 패딩이라 지금까지 영향이 없었지만(2026-10-18 실파일 확인), 뒤쪽 필드는 시장별 길이·폭으로 파싱해야 한다.
- 읽는 필드: 지수업종 대·중·소분류, 시가총액 규모, ETP, SPAC(기업인수목적회사), 우선주, 관리종목, 거래정지, 시장경고, 상장일자, 상장주수(KOSDAQ 은 천 주 단위), 전일기준 시가총액(억), 결산월, 매출액·영업이익·당기순이익·ROE·기준년월.
- 저장: 새 테이블 `stock_profile`(ticker PK → `stock_meta.ticker`). `stock_meta`·`sync_master` 는 건드리지 않는다(기존 검색·차트·수집 경로 회귀 방지).
- `sectors(code PK, name)` ← `idxcode.mst`(KIS `stocks_info/sector_code.py` 형식).
- 파싱 실패 줄은 건너뛰고 개수만 로그. 프로필 동기화 실패는 기존 마스터 동기화를 막지 않는다(별도 try).

### 4.2 테마
- `theme_code.mst`: 줄마다 `[0:3]` 테마코드, `[3:-10]` 테마명, `[-10:]` 종목코드. 2026-10-18 실파일: 302 테마·5,528 연결. **zip 안 수정일 2025-11-06**, "2021 신규 상장주" 같은 오래된 테마 포함 → 갱신이 드묾.
- `themes(id, kis_code UNIQUE NULL, name, source kis|admin, is_hidden, description, created_at, updated_at)`
- `theme_stocks(theme_id, ticker, source kis|admin, is_excluded, reason, PK(theme_id, ticker))`
- 동기화 규칙: KIS 동기화는 `source='kis'` 행만 추가·삭제. 관리자 행(`source='admin'`)과 `is_hidden`·`is_excluded` 표시는 유지. 마스터에서 사라진 KIS 테마는 삭제하지 않고 연결만 정리(관리자 보정 보존).
- 관리자 보정 API(admin 권한, 기존 관리자 인증 사용): 테마 목록·생성·이름/설명 수정·숨김, 종목 추가·제외. **UI 는 프로젝트 3**.
- 위치: 기존 admin 이 stock_api GraphQL 을 쓰므로 stock_api **GraphQL query·mutation** 으로 맞춘다.

### 4.3 지수·시장지표
- 테이블 `market_index_daily(code, date, open, high, low, close, volume Nullable, ingested_at)` ReplacingMergeTree(ingested_at), ORDER BY (code, date).
- 코드 체계 `출처:심볼` — 설정 목록 한 줄로 추가 가능:

| 코드 | 이름 | API·인자 |
|---|---|---|
| `KR:0001` | KOSPI | `FHKUP03500100`, `U`, `0001` |
| `KR:1001` | KOSDAQ | 〃 `1001` |
| `KR:2001` | KOSPI200 | 〃 `2001` |
| `US:SPX` | S&P500 | `FHKST03030100`, `N`, `SPX` |
| `US:COMP` | 나스닥 종합 | 〃 `COMP` |
| `US:NDX` | 나스닥100 | 〃 `NDX` |
| `US:SOX` | 필라델피아 반도체 | 〃 `SOX` |
| `US:VIX` | VIX | 〃 `VIX` |
| `US:DJI` | 다우존스 산업 | 〃 — 해외지수 마스터(`frgn_code.mst`)에 다우 산업 항목이 보이지 않아 **첫 실호출로 코드 확인**(실패 시 이 항목만 끔) |
| `FX:USDKRW` | 원/달러 | `FHKST03030100`, `X`, `FX@KRW` |
| `US:UST10Y`·`US:UST2Y` | 미 국채 10·2년 | `FHKST03030100`, `I`, 코드 첫 실호출로 확인(FRED `DGS10`·`DGS2` 로도 확보되므로 실패해도 무방) |
| `USSTK:NVDA` 등 | 대표 종목(설정) | `FHKST03030100`, `N` — 다우30·나스닥100·S&P500 편입 종목만 조회 가능(KIS 명세) |

- 대표 종목 기본값: `NVDA, MU, AAPL, MSFT, TSLA`(반도체·빅테크 연동 확인용). 환경 변수 `MARKET_INDEX_EXTRA` 로 추가.
- 첫 실행(테이블에 해당 코드 없음): 2년 백필(기간 청크). 이후 매일: 최근 10일 겹침 재수집(멱등).
- 시점: 국내 지표는 일봉 수집 흐름(20:30) 뒤, 미국 지표는 미국 장 마감 뒤인 **매일 07:30 KST**.
- 지표 하나가 실패해도 나머지 계속(종목 수집과 같은 격리).

### 4.4 투자자별 순매수
- 응답 필드(공식 예제): `stck_bsop_date`, `prsn/frgn/orgn_ntby_qty`(순매수 수량), `*_ntby_tr_pbmn`(순매수 대금).
- `investor_daily(ticker, date, prsn_qty, frgn_qty, orgn_qty, prsn_amt, frgn_amt, orgn_amt, ingested_at)` ReplacingMergeTree.
- 일봉 수집 흐름 뒤 실행, 기존 `_run_universe`(스레드·공유 레이트리밋·쿨다운) 재사용. 시장코드 UN→J 폴백 규칙 적용.

### 4.5 재무비율
- 응답 필드(공식 예제): `stac_yymm`, `grs`(매출 증가율), `bsop_prfi_inrt`, `ntin_inrt`, `roe_val`, `eps`, `sps`, `bps`, `rsrv_rate`, `lblt_rate`.
- `fundamentals_periodic(ticker, period Enum('Y','Q'), stac_yymm, eps, bps, sps, roe, sales_growth, op_growth, ni_growth, debt_ratio, ingested_at)` ReplacingMergeTree, ORDER BY (ticker, period, stac_yymm).
- 기존 `fundamentals`(PER·PBR) 테이블은 그대로 둔다.
- **분기 EPS 누적 여부는 미확인** — 저장은 원값 그대로, 해석(누적이면 직전 분기 차감)은 프로젝트 2 계산에서. 첫 실호출 결과로 확정해 pending_checks 에 기록.
- 주기: 매주 토 10:00 + Celery 수동 태스크.

### 4.6 공모주 청약 일정
- 응답 필드(공식 예제): `record_date`, `sht_cd`, `fix_subscr_pri`, `subscr_dt`(청약기간), `pay_dt`, `refund_dt`, `list_dt`, `lead_mgr`.
- `stock_events(id, event_date, title, category, ticker NULL, source, source_key UNIQUE, payload JSONB, created_at, updated_at)` — 주달 기획서 4절 `stock_events` 에 출처·멱등 키 추가. 청약 시작·상장일을 각각 행으로(`source_key=ipo:{sht_cd}:subscr` 등) upsert.
- 조회 범위: 오늘-7일 ~ +60일.

### 4.7 미국 거시 경제지표 (FRED)
- FRED API(미 세인트루이스 연준 공식). `FRED_API_KEY` 없으면 태스크가 "키 없음 — 건너뜀" 로그 후 종료(실패 아님).
- 기본 시리즈: `CPIAUCSL`(CPI), `CPILFESL`(근원 CPI), `PCEPILFE`(근원 PCE), `UNRATE`(실업률), `PAYEMS`(비농업 고용), `FEDFUNDS`(기준금리 실효), `DGS10`, `DGS2`(국채), `T10Y2Y`(장단기 차). 환경 변수 `MACRO_SERIES_EXTRA` 로 추가.
- `macro_series(series_id, date, value Nullable(Float64), ingested_at)` ReplacingMergeTree.
- 발표 예정일: FRED releases/dates 로 CPI·고용 등 다음 발표일을 `stock_events(category='경제지표')` 에 upsert — 주달 캘린더용.
- 매일 08:00 KST, 시리즈별 최근 2년(첫 실행)·최근 90일(이후).

## 5. 스케줄 (Celery beat, KST)

| 시각 | 태스크 | 비고 |
|---|---|---|
| 07:30 | `collector.collect_market_indices(region="US")` | 미국·환율·금리·대표 종목 |
| 08:00 | `collector.collect_macro_series` | FRED, 키 없으면 건너뜀 |
| 20:30 | 기존 `collect_all_daily` → 끝나면 이어서 `collect_market_indices(region="KR")` → `collect_investor_daily` | 체인. 마스터 동기화 단계에서 프로필·테마도 갱신 |
| 21:30 | `collector.collect_ipo_events` | |
| 토 10:00 | `collector.collect_fundamentals` | |

체인은 앞 단계 실패와 무관하게 다음 단계를 실행한다 — 투자자 수집이 일봉 실패로 멈추지 않게.

## 6. 공통 규칙
- KIS 호출은 기존 `KISClient`·`RateLimiter`·쿨다운·스레드 병렬 그대로. 신규 메서드는 `client.py` 에 TR 별로 추가.
- 국내 종목 시세는 UN 우선·빈 응답이면 J(프로젝트 규칙). 지수(`U`)·해외(`N/X/I`)는 해당 없음.
- CH 는 모두 ReplacingMergeTree(ingested_at) + 조회 FINAL. PG 는 alembic 마이그레이션 1개.
- 실패 격리: 항목·종목 단위 try/except, 요약 로그(`ok/fail/skip/elapsed_sec`).

## 7. 테스트
- 파서: 공식 필드명으로 만든 가짜 응답·가짜 `.mst` 줄(KOSPI 228 / KOSDAQ 222 경계, 깨진 줄).
- 저장소: 로컬 CH 임시 DB(생성→DROP), PG 는 일회용 docker PG 로 마이그레이션 왕복.
- 태스크: 가짜 KIS 클라이언트·가짜 FRED 응답, 키 없음 건너뜀, 지표 하나 실패 격리.
- 테마 동기화: 관리자 행·숨김·제외가 KIS 동기화 뒤에도 유지.
- 실제 KIS·FRED 호출 없음. 배포 후 확인 항목을 `docs/pending_checks.md` 에 추가.

## 8. 배포 후 확인 (pending_checks 에 추가)
- 재무: KIS 가 주는 연간·분기 기간 수, 분기 EPS 누적 여부, 모의 키 지원 여부
- 투자자: 응답 일수(≈30), UN/J 차이
- 지수: `US:DJI`·국채 코드, 미국 지수 날짜가 미국 현지 날짜인지
- 프로필: 분석 대상 종목 수 실측, 시가총액 단위(억)
- FRED: 키 발급 후 첫 수집, 발표 예정일 반영

## 9. 범위 밖
CANSLIM 계산·화면(프로젝트 2), 트리맵·테마 랭킹·관리자 테마 UI·캘린더 UI·뉴스·Ollama(프로젝트 3), 미국 개별 주식 전체·미국 재무(별도 로드맵), 네이버 크롤링(로드맵 추후 확인).

## 10. 필요한 API 키 (값은 저장하지 않음 — 서버 `.env.production` 에 운영자가 넣음)

| 키(환경 변수) | 용도 | 발급처 | 없을 때 |
|---|---|---|---|
| 기존 KIS 키 | 1~6번 전부 | 이미 사용 중 | — |
| `FRED_API_KEY` | 7번 미국 거시 지표·발표일 | fred.stlouisfed.org 계정 → My Account → API Keys(무료) | 7번만 건너뜀 |
| `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET` | 뉴스(프로젝트 3) | developers.naver.com → 애플리케이션 등록 → 검색 API(무료, 일 25,000건) | 프로젝트 3 때 필요 |

`.env.example`·README·`docs/server_setup.md` 에 이름과 발급 방법을 적고, `docs/pending_checks.md` "외부 준비" 에 발급 항목을 추가한다.

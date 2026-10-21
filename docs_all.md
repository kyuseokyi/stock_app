# 📚 docs 통합 문서 (docs_all.md)

> 생성일: 2026-10-07 · `docs/` 및 모든 하위 폴더의 Markdown 문서 39개를 경로 제목과 함께 하나로 합친 파일입니다.
> 각 문서는 `# 📄 <파일 경로>` 제목 아래에 원본 그대로 수록됩니다. (스냅샷 — docs 변경 시 `bash scripts/build-docs-all.sh` 로 재생성)

## 목차

1. `docs/ams-reference/00-index.md`
2. `docs/ams-reference/01-architecture.md`
3. `docs/ams-reference/02-data-collection.md`
4. `docs/ams-reference/03-overseas-stocks.md`
5. `docs/ams-reference/04-indicators-rs-ta.md`
6. `docs/ams-reference/05-clickhouse-data-layer.md`
7. `docs/ams-reference/06-screener.md`
8. `docs/ams-reference/07-scheduling.md`
9. `docs/ams-reference/08-tech-debt-and-adoption.md`
10. `docs/architecture_plan.md`
11. `docs/claude_system_context.md`
12. `docs/cloudflare_termius_guide.md`
13. `docs/custom_candle_chart_idea.md`
14. `docs/db_access.md`
15. `docs/deployment_guide.md`
16. `docs/deployment/clickhouse-backup.md`
17. `docs/intel_macmini_server_setup.md`
18. `docs/macmini_setup_progress.md`
19. `docs/prompts/00_master_prompt.md`
20. `docs/prompts/01_backend_pipeline.md`
21. `docs/prompts/02_backend_api.md`
22. `docs/prompts/03_mobile_app.md`
23. `docs/prompts/04_admin_web.md`
24. `docs/prompts/05_user_web.md`
25. `docs/prompts/06_stock_api.md`
26. `docs/ROADMAP.md`
27. `docs/run_and_deploy.md`
28. `docs/screener_plan.md`
29. `docs/server_setup.md`
30. `docs/superpowers/plans/2026-09-14-featured-posts.md`
31. `docs/superpowers/specs/2026-07-11-admin-chart-capture-design.md`
32. `docs/superpowers/specs/2026-07-11-admin-chart-drawing-design.md`
33. `docs/superpowers/specs/2026-07-11-web-client-temp-login-comments-design.md`
34. `docs/superpowers/specs/2026-07-21-phase1-kis-ohlcv-vertical-slice-design.md`
35. `docs/superpowers/specs/2026-08-06-phase1b-universe-collection-design.md`
36. `docs/superpowers/specs/2026-08-06-stock-meta-master-unification-design.md`
37. `docs/superpowers/specs/2026-09-14-featured-posts-design.md`
38. `docs/trading_game_plan.md`
39. `docs/windows_setup.md`

---

# 📄 `docs/ams-reference/00-index.md`

# AMS 참고 분석 — stock_app 설계 레퍼런스 (인덱스)

> **이 문서 묶음의 목적**
> `ams/workspace/api`(AMS, *Advance Market Surge*)는 지금 만드는 **stock_app과 거의 동일한 도메인**(한국투자증권 데이터 수집 → 지표 계산 → ClickHouse 적재 → 스크리너/차트 API)을 이미 운영 수준으로 구현한 선행 프로젝트다.
> 이 묶음은 AMS를 정밀 분석해 stock_app이 **채택 / 각색 / 회피**할 패턴을 용도별로 정리한 레퍼런스다. AMS 자체 상세 분석은 그 프로젝트의 `docs/ams-api-analysis.md`에 있으므로, 여기서는 **stock_app에 적용할 관점**에 집중한다.
>
> 분석 기준일: 2026-07-10 · 대상: AMS `ams/workspace/api` 현재 트리

---

## 파일 지도

| 파일 | 다루는 것 | stock_app 단계 |
|---|---|---|
| [01-architecture.md](01-architecture.md) | 프로세스 분리(API/Worker/캐시), 데이터 스토어 구조 | 전반 |
| [02-data-collection.md](02-data-collection.md) | KIS 클라이언트(토큰/재시도), 수집 계층(fetcher/writer), 국내 일봉 필드 매핑 | **3단계(수집)** |
| [03-overseas-stocks.md](03-overseas-stocks.md) | 해외 주식: 거래소 코드 매핑, 국내 vs 해외 엔드포인트 차이 | 3단계+ (해외 확장) |
| [04-indicators-rs-ta.md](04-indicators-rs-ta.md) | SMA/RS/TA 계산 공식 + 스크리너 필수 지표 우선순위 | 3~4단계(지표) |
| [05-clickhouse-data-layer.md](05-clickhouse-data-layer.md) | 멱등 적재(ReplacingMergeTree), 스키마, 리샘플링, 펀더멘털 | 2~3단계 |
| [06-screener.md](06-screener.md) | 저장형 스크리너 데이터 모델 + 안전한 QueryBuilder | 4단계(API) |
| [07-scheduling.md](07-scheduling.md) | 멀티마켓 야간 배치 스케줄, 의존성 순서 | 3단계+ |
| [08-tech-debt-and-adoption.md](08-tech-debt-and-adoption.md) | AMS 기술부채(회피) + Adopt/Adapt/Avoid 종합 로드맵 | 전반 |

---

## AMS 한눈에

AMS는 이름은 "api 서버"지만 실제로는 **배치 계산형 주식 분석 백엔드 플랫폼**이다.

- 야간에 KIS에서 OHLCV·펀더멘털을 수집하고
- SMA / RS(상대강도) / 광범위한 TA 지표를 배치로 계산해 저장하며
- 미리 계산된 결과를 캐시(DuckDB, 향후 ClickHouse)에 올려 **조회 시점이 아니라 계산 시점에 비용을 앞당긴다**
- 클라이언트에는 GraphQL(스크리너/분석) + REST(차트)로 제공한다
- **국내(KRX)뿐 아니라 미국·일본·홍콩·중국·베트남 등 7개 시장을 지원**한다 (→ [03](03-overseas-stocks.md), [07](07-scheduling.md))
- 실주문(자동매매)은 없으나 `strategy`/`backtest` 도메인과 `bt_server`는 존재한다

→ stock_app이 지향하는 "수집 → 지표 → 스크리너" 파이프라인의 **성숙한 참조 구현**이다.

---

## 채택 요약 (전체 종합 — 상세는 [08](08-tech-debt-and-adoption.md))

| 구분 | 항목 | 참조 |
|---|---|---|
| ✅ Adopt | API/Worker 계산-조회 분리 | [01](01-architecture.md) |
| ✅ Adopt | ClickHouse `ReplacingMergeTree` + dedup view 멱등 적재 | [05](05-clickhouse-data-layer.md) |
| ✅ Adopt | 2단계 KIS 토큰 캐시(로컬+Redis), 백오프, sandbox | [02](02-data-collection.md) |
| ✅ Adopt | `AsyncLimiter` 레이트리밋 + fetch/write 분리 + 청킹 | [02](02-data-collection.md) |
| ✅ Adopt | 수정주가(FID_ORG_ADJ_PRC=0) 사용 | [02](02-data-collection.md) |
| 🔧 Adapt | 국가/거래소 추상화(country_code + exchange) | [03](03-overseas-stocks.md) |
| 🔧 Adapt | RS(상대강도) 도메인 확장 | [04](04-indicators-rs-ta.md) |
| 🔧 Adapt | 저장형 스크리너 + 단계별 통계 | [06](06-screener.md) |
| 🔧 Adapt | 5+ 프로세스 → Celery 단일 통합 | [01](01-architecture.md) |
| ⛔ Avoid | 동적 문자열 SQL 남용 → 파라미터/화이트리스트 | [06](06-screener.md), [08](08-tech-debt-and-adoption.md) |
| ⛔ Avoid | 다중 스토어(DuckDB) 동기화 → ClickHouse 직결 | [01](01-architecture.md), [05](05-clickhouse-data-layer.md) |
| ⛔ Avoid | api_server 책임 과다 / 네이밍 부채 | [08](08-tech-debt-and-adoption.md) |
</content>


---

# 📄 `docs/ams-reference/01-architecture.md`

# 01. 아키텍처 — 프로세스 분리와 데이터 스토어

← [인덱스](00-index.md)

## 1. 프로세스 아키텍처 — AMS vs stock_app

AMS는 하나의 서버가 아니라 **역할별 독립 프로세스**로 쪼개져 있다 (`app/*.py` 엔트리포인트).

| AMS 프로세스 | 역할 | stock_app 대응 |
|---|---|---|
| `api_server` | GraphQL/REST 클라이언트 API | `backend/api` (FastAPI) |
| `kis_worker` | KIS 수집 + SMA/RS 스케줄 | `backend/worker` (Celery, 수집 태스크) |
| `ta_worker` | TA 지표 계산 → DB 적재 | `backend/worker` (Celery, 지표 태스크) |
| `ta_server` | DuckDB 인메모리 TA 조회 캐시 | *(stock_app은 ClickHouse 직결로 대체)* |
| `chart_pattern_worker` | 차트 패턴 탐지 | *(향후 확장 후보)* |
| `bt_server` | 백테스트 | *(향후 확장 후보)* |
| `misc_worker` / `job_runner` | 잡 러너/운영 | Celery beat + worker |

**핵심 원칙(그대로 채택)**: `api_server`는 무거운 계산을 절대 직접 하지 않는다. 계산은 워커가, 조회는 서버가. stock_app의 API/Worker 분리 설계와 정확히 일치한다.

**차이(각색)**: AMS는 프로세스를 5개 이상으로 잘게 나눴고 자체 잡 프레임워크(`amscore.task.BaseResultJob` + `job_worker(...).dispatcher`)를 쓴다. stock_app은 **Celery 하나로 통합**하는 편이 초기 운영 부담이 훨씬 적다. AMS 수준의 프로세스 분리는 트래픽/데이터가 커진 뒤에 고려하면 된다.

## 2. 데이터 계층 — 3-스토어 vs 2-스토어

| | AMS | stock_app |
|---|---|---|
| 관계형(마스터/원천) | **MySQL** | **PostgreSQL** |
| 시계열/분석 | **ClickHouse** (히스토리) | **ClickHouse** |
| 조회 캐시 | **DuckDB** (인메모리, 향후 ClickHouse로 이전 예정) | *(별도 캐시 없이 ClickHouse 직결)* |
| 브로커/캐시 | Redis + RabbitMQ | Redis |

AMS는 "MySQL(원천) → 계산 → MySQL(지표) → ClickHouse 동기화 → DuckDB 캐시"의 다단 구조인데, 이는 역사적 이유(DuckDB 먼저 도입 후 ClickHouse로 이전 중)로 복잡해진 것이다. AMS 스스로도 *"DuckDB 캐시는 안정화 후 ClickHouse로 전환 예정"*이라 명시한다.

→ **stock_app 교훈**: 처음부터 **ClickHouse를 조회+저장 단일 계층으로** 쓰면 AMS가 겪는 "MySQL↔ClickHouse↔DuckDB 3중 동기화" 복잡도를 통째로 건너뛴다. 지금 stock_app 설계(Postgres=마스터/유저, ClickHouse=시계열 직결)가 이미 옳은 방향이다. (상세: [05-clickhouse-data-layer.md](05-clickhouse-data-layer.md))

## 3. stock_app 권장 백엔드 구조

```
backend/
├── api/                 # FastAPI (조회 전담)
├── worker/
│   ├── celery_app.py    # Celery 부트스트랩(설정+beat)
│   ├── datasources/     # StockDataSource 인터페이스 + KIS/Mock 구현
│   ├── tasks/
│   │   ├── collector/   # 수집 잡 (OHLCV/지수/시장데이터/펀더멘털)
│   │   └── indicator/   # 지표 계산 잡 (SMA/RS/TA)
│   ├── services/        # 지표 계산 등 순수 로직
│   └── repositories/    # ClickHouse/Postgres 적재
└── shared/              # models.py(Postgres), clickhouse_schema.py
```

이 구조의 근거는 [02-data-collection.md](02-data-collection.md)의 AMS 수집 계층 분리(fetcher/writer/job)를 stock_app의 Celery 위에 얹은 것이다.


---

# 📄 `docs/ams-reference/02-data-collection.md`

# 02. 데이터 수집 — KIS 클라이언트 & 수집 계층 (국내 중심)

← [인덱스](00-index.md) · 관련: [03-overseas-stocks.md](03-overseas-stocks.md), [07-scheduling.md](07-scheduling.md)

> stock_app **3단계(수집 파이프라인)** 에 가장 직접적인 참고. 해외 주식 특이사항은 [03](03-overseas-stocks.md)에서 별도로 다룬다.

## 1. 계층 구조 (실제 파일)

```
app/libs/external_api/kis_client.py          # ① 저수준 HTTP + OAuth 토큰 (KoreaInvestmentBackend)
  └ schemas/kis/domestic_stock/*.py          #   엔드포인트별 타입 요청/응답 스키마(Pydantic)
app/services/kis_stock.py                    # ② 서비스 래퍼(토큰 보장, client 노출)
app/services/stock_metrics/ohlcv/
  ├ kis_fetcher.py   (KISStockPriceFetcher)   # ③ 수집: KIS 응답 → 도메인 객체(OHLCVData)
  └ kis_writer.py                             # ④ 적재: 도메인 객체 → DB
app/tasks/collector/
  ├ daily_ohlcv_fetcher.py                    # ⑤ 잡(스케줄): 위 계층 오케스트레이션
  ├ daily_index_fetcher.py / daily_fundamental_fetcher.py / daily_marketdata_fetcher.py
  └ ohlcv/{domestic_bulk_import_job, periodic_import_job, resample_job}.py
```

→ **stock_app 매핑**: ① `KISDataSource`(인터페이스) + `KISClient`(HTTP/토큰), ③ fetcher = 수집→도메인 변환, ④ = `ClickHouseRepository`(Bulk Insert), ⑤ = Celery 태스크. 이 **fetch/write 분리 + 도메인 객체 경유**를 그대로 채택하면 KIS↔Mock 교체가 자연스럽다.

## 2. KIS 클라이언트 핵심 패턴 (`kis_client.py`) — `KISDataSource`에 내장할 것

1. **2단계 토큰 캐시** ⭐ — 로컬 인프로세스 캐시(`LocalTTLCache`, 12h) + **Redis 공유 캐시**(키 `kis:{mode}:{appkey}`). 순서: 로컬 → Redis → 없으면 `oauth2/tokenP` 신규 발급 후 양쪽에 저장. **KIS 접근토큰은 발급 횟수/빈도 제한**이 있어 여러 워커가 토큰을 공유해야 한다. stock_app은 이미 Redis가 있으니 **Redis 토큰 공유**를 강력 권장.
2. **요청마다 토큰 보장** — `request()`가 매번 `_ensure_valid_token()` 후 호출.
3. **재시도 + 지수 백오프** — `MAX_RETRIES=7`, `sleep(1.5**attempt)`. **5xx·연결오류·타임아웃만 재시도**하고 4xx는 즉시 실패(무의미한 재시도 방지).
4. **sandbox/production 분리** — `BASE_URL`: 실서버 `openapi.koreainvestment.com:9443`, 모의투자 `openapivts.koreainvestment.com:29443`. stock_app도 처음부터 **sandbox 모드**를 지원하면 키 없이/안전하게 테스트 가능(지금 Mock 골격과도 맞음).
5. **엔드포인트별 타입 스키마** — 요청 헤더(`tr_id`)/파라미터, 응답을 Pydantic으로 타입화(`response_handler` 데코레이터가 dict→스키마 매핑). KIS 응답 필드 오타/누락을 조기에 잡는다.
6. **연결 특성** — 단일 `aiohttp.ClientSession` 재사용, `ssl=False`(KIS 서버 특성), 페이지네이션은 응답 헤더 `tr_cont`(→ `result['_context']['tr_cont']`).

## 3. 수집 잡 패턴 (`kis_fetcher.py`) — 대량 수집의 정석

1. **레이트리밋 = `aiolimiter.AsyncLimiter`** ⭐ — `async with self.rate_limit:`로 각 호출을 감싼다. naive `asyncio.sleep`보다 정확히 초당 호출수 제어. AMS는 `AsyncLimiter(18, 1)`(18 req/s) + 종목을 10청크로 나눠 청크당 asyncio task(1초 stagger). **stock_app도 `asyncio.sleep` 대신 AsyncLimiter를 쓸 것.**
2. **producer/consumer 큐** — fetcher가 `asyncio.Queue`에 결과를 넣고 writer가 소비. 수집(I/O)과 적재(배치 쓰기)를 분리해 처리량↑.
3. **날짜 구간 청킹** — KIS 국내 일봉은 1회 호출당 최대 ~100행. 긴 백필은 `_build_date_range()`로 구간을 쪼개 반복 호출. **백필 구현 시 필수.**
4. **종목별 실패 격리** — 각 종목 수집은 `ResultContext(error)`를 갖고, 실패 시 `continue` + 경고 로그. 한 종목 실패가 전체를 멈추지 않음.
5. **대량 적재 버퍼** — `LargeBatch.insert_large_batch()`가 10,000행씩 버퍼링 후 flush.

## 4. KIS 국내 일봉 필드 매핑 (stock_app이 바로 쓸 표)

엔드포인트: `uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` (응답 배열 `output2`)

| KIS 필드 | 의미 | stock_app `daily_prices` |
|---|---|---|
| `stck_bsop_date` | 영업일(거래일) | `date` |
| `stck_oprc` | 시가 | `open` |
| `stck_hgpr` | 고가 | `high` |
| `stck_lwpr` | 저가 | `low` |
| `stck_clpr` | 종가 | `close` |
| `acml_vol` | 누적 거래량 | `volume` |

호출 파라미터 핵심: `FID_INPUT_DATE_1/2`(기간), `FID_PERIOD_DIV_CODE`(D/W/M), **`FID_ORG_ADJ_PRC='0'`(수정주가)**.
→ **수정주가('0') 사용**이 중요: 액면분할/유무상증자 왜곡을 제거해야 지표(MA/RSI)가 정확하다.

## 5. 수집 잡 종류 & 겹침 재수집

- **잡 종류별 분리**: OHLCV / 지수 / 시장데이터(시총·유동주식) / 펀더멘털을 각각 다른 잡으로(`worker/tasks/collector/` 하위).
- **겹침 재수집**: AMS는 매 실행 시 `today-30d ~ today+2d`를 다시 긁어 누락/정정분을 흡수. 이 "겹침 재수집"은 [05](05-clickhouse-data-layer.md)의 `ReplacingMergeTree` 멱등 적재와 짝을 이룬다(중복 삽입 없이 최신으로 대체).
- **백필 vs 정기수집 분리**: 최초 과거 적재(`bulk_import`)와 매일 증분(`periodic_import`)을 다른 잡으로.
- **리샘플링**: 일봉만 수집하고 주/월/연봉은 내부 리샘플(`OHLCVResampleJob`)로 생성 → KIS 호출 절약. (상세: [05](05-clickhouse-data-layer.md))

## 6. stock_app 3단계 즉시 적용 요약

`MockDataSource`/`KISDataSource` 공통 인터페이스는 위 1절의 **fetch → 도메인(OHLCVData) → write** 형태로 잡고, KIS 구현 시:
- 2절(2단계 토큰 캐시·백오프·sandbox·타입스키마)
- 3절(AsyncLimiter·큐·청킹·실패격리·배치버퍼)
- 4절(필드 매핑·수정주가)
를 그대로 이식한다. 해외까지 필요하므로 인터페이스는 처음부터 `country_code`/`exchange`를 파라미터로 받게 설계할 것 → [03](03-overseas-stocks.md).


---

# 📄 `docs/ams-reference/03-overseas-stocks.md`

# 03. 해외 주식 지원 — 거래소 매핑 & 국내/해외 차이

← [인덱스](00-index.md) · 관련: [02-data-collection.md](02-data-collection.md), [07-scheduling.md](07-scheduling.md)

> stock_app이 **해외 주식을 지원**하려면 국내와 다른 몇 가지 구조적 차이를 처음부터 반영해야 한다. AMS는 KRX + 미국(NYSE/NASDAQ/AMEX) + 일본(TSE) + 홍콩(HKEX) + 중국(SSE/SZSE) + 베트남(HOSE/HNX)을 지원한다.

## 1. 핵심 원칙 — `country_code` + `exchange` 추상화

수집 경로는 `country_code`로 분기한다: `KR` → 국내 엔드포인트, 그 외 → 해외 엔드포인트. `Exchange` 테이블 하나가 **라우팅 + 스케줄링의 단일 소스**다.

- `Exchange`: `code`, `country_code(CHAR2)`, `currency_code(CHAR3)`, `local_timezone`, `close_time`, `main_index_id`
→ **stock_app 권장**: `stock_meta`에 `country_code`, `exchange` 컬럼을 두고, 별도 `exchange` 마스터 테이블(코드/통화/타임존/대표지수)을 둔다. 지금 `stock_meta`는 국내 전용(KOSPI/KOSDAQ)이라, 해외 대비 **`market` enum을 `exchange` 참조로 일반화**해야 한다.

## 2. 거래소 코드 매핑 (내부 코드 → KIS 코드)

`app/common/constant.py`의 `EXCHANGE_CODE_MAP`:

| 내부 코드 | KIS 코드 | 시장 |
|---|---|---|
| `KRX` | `KRX` | 한국 |
| `NASDAQ` | `NAS` | 미국 나스닥 |
| `NYSE` | `NYS` | 미국 뉴욕 |
| `AMEX` | `AMS` | 미국 아멕스 |
| `TSE` | `TSE` | 일본 도쿄 |
| `HKEX` | `HKS` | 홍콩 |
| `SSE` | `SHS` | 중국 상하이 |
| `SZSE` | `SZS` | 중국 선전 |
| `HOSE` | `HSX` | 베트남 호치민 |
| `HNX` | `HNX` | 베트남 하노이 |

부가 매핑: `KIS_PRODUCT_TYPE_CODE_MAP`(상품유형 숫자코드, `search_info`용), `COUNTRY_TO_TIMEZONE`, `COUNTRY_TO_CURRENCY`, `COUNTRY_ALPHA2_to_ALPHA3`. KIS 해외 enum(`OverseasExchangeCode`)에는 미국 **주간거래 세션** 변형(`BAY`=NYSE주간, `BAQ`=NASDAQ주간, `BAA`=AMEX주간)도 있음.
> ⚠️ AMEX 상품코드가 `ProductTypeCode`에선 `514`, `OverseasProductTypeCode`에선 `529`로 **불일치** — 포팅 시 정리 필요.

## 3. ⭐ 국내 vs 해외 — 결정적 차이

| 항목 | 국내 (KR) | 해외 |
|---|---|---|
| OHLCV 엔드포인트 | `inquire-daily-itemchartprice` | `dailyprice` (`uapi/overseas-price/v1/quotations`) |
| 날짜 파라미터 | **start~end 범위** (`FID_INPUT_DATE_1/2`) | **end_date만** (`BYMD`) + period(`GUBN`) |
| 1회 응답량 | ~100행 | ~30행(D) |
| period 코드 | D/W/M/Y | **D/W/M만** (`OverseasPeriodCode` 0/1/2, **연봉 없음**) |
| 수정주가 플래그 | `FID_ORG_ADJ_PRC` | `MODP`('1'=수정주가 기본) |
| 백필 방식 | 날짜 범위 청킹 | **간격 둔 end_date 반복 호출** (`generate_period_end_dates`) |
| 소수 자릿수 | 정수 원화 | `zdiv`(소수 자릿수) 스케일링 필요, 통화 상이 |

### 해외 일봉 필드 매핑 (`daily_price` → `output2`)

| KIS 필드 | 의미 | OHLCV |
|---|---|---|
| `xymd` | 일자 | `date` |
| `open` | 시가 | `open` |
| `high` | 고가 | `high` |
| `low` | 저가 | `low` |
| `clos` | 종가 | `close` |
| `tvol` | 거래량 | `volume` |

`output1`엔 `zdiv`(소수 자릿수), `rsym`(실시간심볼) 등. **국내(`stck_*`)와 필드명이 완전히 다르므로** fetcher에서 국내/해외 매핑을 분리해야 한다.

### 해외 지수는 또 다른 엔드포인트
`inquire_daily_chartprice`(FID 방식) → `output2` 필드 `ovrs_nmix_oprc/hgpr/lwpr/prpr`(거래량 없음). 지수코드는 KIS `OverseasSectorCode`(`SPX`, `JP#NI225`, `HK#HS`, `SHANG`, `VN#VNI`, `KOSPI` 등).

## 4. 해외 백필의 핵심 — end_date 반복

해외 `daily_price`는 시작일이 없어 한 번에 ~30행(끝일 기준)만 준다. 긴 히스토리는 **간격을 둔 여러 end_date로 반복 호출**해야 한다(AMS `generate_period_end_dates`: 90일 이내면 `[end_date]`, 아니면 분기 경계 end_date들 생성).
→ **stock_app 권장**: "간격 둔 end_date 생성기"를 **1급 함수로 테스트**해 두고, 간격은 ~30행/호출 윈도우에 맞춰 정한다(분기 경계 맹신 금지).

## 5. 타임존 스케줄 — 시장별 로컬 22:00

각 거래소를 **자기 로컬 타임존 22:00**에 수집한다: `CronTrigger(hour=22, minute=0, timezone=exchange.local_timezone)`, 잡 id `f'{exchange.code}_OHLCV'`. 미국은 서머타임(EDT/EST)에 따라 KST 수집시각이 11시/12시로 달라진다. (전체 타임라인: [07-scheduling.md](07-scheduling.md))

## 6. 해외 특이사항 / 주의

- **수정주가 플래그(`MODP`)를 설정값으로** — AMS는 기본 수정주가 하드코딩. stock_app은 config로.
- **`zdiv` 소수 스케일링 + 통화** — 해외 가격은 문자열로 오고 소수 자릿수가 다름. Decimal로 스케일 저장 + 거래소별 통화 보관. AMS는 raw 문자열 저장(개선 여지).
- **해외는 `chk_holiday` 없음** — 국내에만 휴일조회 API 존재. 해외 휴일은 별도 소스 필요(AMS는 admin이 `ExchangeHoliday` 수기 입력). **처음부터 해외 휴일 데이터 소스를 정할 것.**
- **`kis_stock('production')` 하드코딩** — 해외 잡은 항상 production. mode를 config로 빼서 sandbox 사용 가능하게.
- **페이지네이션** — `tr_cont`/`NEXT`/`KEYB`. OHLCV 벌크는 페이지네이션 대신 end_date 반복에 의존(장기/분봉은 실제 페이지네이션 구현 권장).
- **엔드포인트 prefix 함정** — 해외 클래스 기본 prefix는 `overseas-stock`인데 실제 메서드는 매번 `overseas-price`로 override. 메서드 추가 시 override 누락 주의.

## 7. stock_app 채택 요약

**Adopt**
- 내부코드→KIS코드 간접 매핑(`EXCHANGE_CODE_MAP`) + `Exchange` 마스터(코드/국가/통화/타임존/대표지수)를 라우팅+스케줄 단일 소스로.
- 거래소별 **로컬 타임존 cron** 스케줄.
- 엔드포인트별 Pydantic 스키마(`tr_id`/params/`output1·output2`).
- 토큰 캐시(로컬+Redis) + 5xx 백오프, `tr_cont` 캡처, `LargeBatch` 버퍼 upsert.

**Adapt / 개선**
- 해외 백필을 **end_date+period 기반**으로 처음부터 설계(시작일 없음). 간격 생성기를 테스트된 1급 헬퍼로.
- `PeriodCode → OverseasPeriodCode` 변환을 **한 곳**으로 중앙화(현재 fetcher/job 중복), 해외 연봉은 명시적으로 거부.
- `zdiv` 소수 + 통화, `MODP` config, 실제 페이지네이션, 해외 휴일 소스, sandbox mode.


---

# 📄 `docs/ams-reference/04-indicators-rs-ta.md`

# 04. 지표 / RS / TA — 계산 로직과 확장 로드맵

← [인덱스](00-index.md) · 관련: [05-clickhouse-data-layer.md](05-clickhouse-data-layer.md), [06-screener.md](06-screener.md)

> stock_app은 현재 MA/BB/RSI/MACD(고전 오버레이/오실레이터)만 계산한다. AMS는 **상대강도(RS) + 베이스 단계 스크리너**(Minervini/CANSLIM) 패러다임이다. 이 문서는 그쪽으로 확장하는 로드맵이다.

## 0. 아키텍처 원칙 (그대로 채택)

AMS는 두 종류의 계산을 분리한다:
- **종목별 pandas TA** (심볼 단위, 이식성 높음) — SMA·RS라인·ATR·수익률 등
- **모집단 전체 랭킹은 DB 윈도우 함수** (날짜별 전 종목 대상) — RS Rating, 산업/섹터 순위

→ **핵심 교훈**: RS *Rating*·산업/섹터 순위는 본질적으로 **횡단면(cross-sectional)** 이다. 심볼별 Python이 아니라 **날짜로 파티션한 SQL 윈도우 함수**로 전 종목 테이블에 대해 계산하라. 템플릿: `ntile(99) OVER (PARTITION BY country, date ORDER BY score, id)`. Postgres/ClickHouse 모두 동일하게 동작.

## 1. SMA (이동평균)

- **가격 SMA**: `10, 21, 50, 150, 200` / **거래량 VSMA**: `5, 50`
- **완결성 게이트** ⭐: 윈도우가 다 차야만 값을 낸다 (200-SMA는 200행 있어야 계산, 부분 평균 없음):
  ```sql
  CASE WHEN COUNT(close) OVER (... ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) = 200
       THEN ROUND(AVG(close) OVER (...), 2) ELSE NULL END
  ```
- **저장**: `stock_sma_daily`를 **long 레이아웃**으로 — `(stock_id, date, interval_days, value_type)` (PRICE/VOLUME 구분). 기간별 wide 컬럼이 아님.
- stock_app 참고: 150·200 SMA가 Minervini Trend Template의 핵심. 기존 MA 인프라에 기간만 추가.

## 2. ⭐ RS Score & Rating — 핵심 차별점

### RS Score (시장 대비 모멘텀 비율)
두 방식이 공존:

**(a) 레거시 가중 RS** (`stock_rs_daily`) — 5개 구간(12m/6m/3m/1m/9m) 가중, **시장 상대**:
```
rs_score = (stock_1d/stock_1y)/(index_1d/index_1y)*w1   # 12m
         + (stock_1d/stock_6m)/(index_1d/index_6m)*w2   # 6m
         + (stock_1d/stock_3m)/(index_1d/index_3m)*w3   # 3m
         + (stock_1d/stock_1m)/(index_1d/index_1m)*w4   # 1m
         + (stock_1d/stock_9m)/(index_1d/index_9m)*w5   # 9m
```
각 항 = (종목 수익률)/(지수 수익률) = 시장 상대 강도. 가중치는 `rs_weight_set` 테이블.

**(b) 분기 가중 RS(IBD식)** (`stock_rs_daily_qtr_weighted`) — **가격만(지수 나눗셈 없음)**, 최근 분기 2배 가중:
```
rs_score = (c/3m)*0.4 + (3m/6m)*0.2 + (6m/9m)*0.2 + (9m/1y)*0.2
```
→ **stock_app 시작점 추천**: (b)가 지수 불필요·CANSLIM 표준이라 도입이 쉽다.

### 참조일 사전계산 (`rs_ref_date_stock2`)
캘린더 오프셋(1d/1m/3m/6m/9m/1y)을 **실제 거래일**로 미리 변환해 저장 → score 쿼리가 join만 하면 됨. 1d는 과거로(`&lt;=`), 나머지는 가장 가까운 미래 거래일(`&gt;=`). (ta.md의 "가장 가까운 미래 날짜" 규칙과 일치)

### RS Rating (1~99) — 백분위
날짜×그룹 파티션에서 `rs_score`를 1~99로 랭크. **이중 방식**:
- 그룹 ≥99개 → `NTILE(99) OVER (PARTITION BY date, country_code ORDER BY rs_score, stock_id)`
- 그룹 &lt;99개 → `ROUND(1 + PERCENT_RANK() * 98)` (소그룹 NTILE 왜곡 방지)

국가/산업/섹터 각각에 대해 산출(`rs_rating_in_country/industry/sector`). 헤드라인은 country.

### 산업/섹터 RS
- `industry_rs_daily`: 산업별 `avg_rs_score` + **breadth 트리오**(`rs_90_count`=RS≥90 종목수, `rs_90_ratio`, `rs_90_avg_rs`), 그 후 국가 내 랭크.
- `sector_rs_daily`: 섹터별 평균 후 랭크.

## 3. 종목별 TA 컬럼 (카테고리별)

행 의미: 각 행의 "price"=`close`, `date = 거래일 + 1일`(계산일), 비거래일은 최대 30일 carry-forward.

**A. 위치/52주/ATH** — `price_52w_high/low`(+date), `is_new_52w_high`, `vs_52w_high`(52주고가 대비 %), `days_since_52wh`, `ath_price/date`, `is_new_ath`, `cr_daily`/`cr_weekly`(종가 위치 = (close−low)/(high−low)×100)
**B. 모멘텀** — `price_change`, `change_pct`, `change_pct_diff`(가속도), `change_1w/1m/3m/6m/12m/ytd_pct`, `high_low_1w/2w/3w/4w/8w_pct`(N주 저점 대비 런업 = HP 입력)
**C. RS 라인** — `rs_line`(=close/index_close), `rs_line_52w_high/low`, `rs_line_proximity`(52주고가 근접도, 신고가 선행신호), `is_rs_line_new_high/low`, `rs_score_1m/3m/6m/12m`(구간별), `rs_vs_index_*`
**D. 이평 위치** — `sma10/21/50/150/200`, `vs_smaN`(=(close−smaN)/smaN×100)
**E. 변동성** — `tr`(True Range %), `atr5/10/21/30/50`
**F. 거래량** — `vol_sma5/50`, `day_vs_vsma50`, `week_vs_vwsma10`
**G. 캔들/분산** — `dn_candle_cnt_5d`, `bad_dn_cnt_5d`(고거래량 하락일=분산일)
**H. 펀더멘털** — `eps_yoy`, `sales_yoy`, `eps_qoq`(EPS Rating용), `eps_cagr`(2년: `(eps_3y/eps_5y)^(1/2)−1`×100)

(공식 상세는 AMS `docs/ta.md` 참고 — 52주고가 대비, 각 기간 수익률, RS Line/Rating, ATR, EPS Rating 등 24항목)

## 4. ClickHouse 싱크 시점 레이팅 재계산

랭킹은 **스냅샷 날짜별 전 종목** 대상이라(임의 과거일 스크리닝/백테스트), ClickHouse에서 `PARTITION BY (country_code, date)` 윈도우로 재계산: `rs_rating*`, `eps_qoq_rating`, `eps_cagr_rating`, `eps_rating`, `industry/sector_rs_rating`, `industry_rs_rank`. **전체 행 재삽입**(ReplacingMergeTree 전체행 대체 안전). 헤드라인 `rs_rating`은 MySQL 권위값을 직접 가져와 GraphQL과 일치시킴. ClickHouse엔 `percent_rank()`가 없어 `(rank−1)/(n−1)` 수동 계산 + `round()`(banker's)로 DuckDB와 일치.

## 5. 차트 패턴 & HP (고난도, 후순위)

- **패턴**(`chart_pattern/`): cup / cup_with_handle / double_bottom(W) / flat_base / htf / ascending_base / consolidation. 핵심 엔진 `consolidation.py`의 `find_base`(~600줄 튜닝 휴리스틱: ATR 스케일 프로미넌스, 포물선 R² 적합, SMA50 추세 게이트). 출력 `{kind, hp_price, base_price, depth%, pivot_price, confidence, is_active}`. 베이스 단계(1st/2nd/3rd) 카운팅 → `stock_pattern_daily`.
- **HP(High Point)**: 최근 런업의 고점 앵커. 런업 조건 `high_low_8w_pct>=100 OR high_low_4w_pct>=30`(O'Neil 선행상승 게이트), gaps-and-islands로 최근 런 고점 앵커링. `vs_runup_hp`, `max_drawdown_runup`, `days_since_runup`. 52wh/ath 고정앵커 버전도 존재.
- **VCP**(Minervini 변동성 수축): VCP-A = 최근 N일 매일 거래량 ≤ 50일 거래량SMA(dry-up), VCP-B = 단기/장기 거래량SMA 비율.

## 6. ⭐ stock_app 확장 로드맵 (우선순위)

**Tier 0 — 토대 (먼저)**
1. SMA 10/21/50/150/200 + 거래량 50/10w (기존 MA 인프라에 기간 추가)
2. **종목별 벤치마크 지수 시계열** — RS의 필수 입력. 지수 join 없으면 RS 불가 (가장 큰 결핍)

**Tier 1 — RS 엔진 (핵심 차별점)**
3. `rs_line`(=close/index) + 52w고저 + `rs_line_proximity` + 신고가 플래그 (저비용·고신호, 순수 pandas)
4. 구간별 RS + **분기가중 블렌드**(`0.4·(c/3m)+0.2·(3m/6m)+0.2·(6m/9m)+0.2·(9m/1y)`, 지수 불필요)
5. **RS Rating 1~99** — 날짜별 전 종목 percentile (NTILE99 / 소그룹 percent_rank). CANSLIM "RS≥80" 게이트

**Tier 2 — 위치/추세 템플릿**
6. 52주 고가 + `price_vs_52w_high_pct` + `vs_smaN` (Minervini 8점 Trend Template)
7. `cr_daily/cr_weekly` + `tr`/`atr` (진입 품질/변동성 사이징)

**Tier 3 — 수급/펀더멘털**
8. 거래량 vs VSMA + 분산일 카운트(`bad_dn_cnt_5d`)
9. EPS QoQ/YoY/CAGR + EPS Rating (CANSLIM의 C·A, 펀더멘털 필요 → [05](05-clickhouse-data-layer.md))

**Tier 4 — 산업/섹터 RS & 베이스 (고급)**
10. 산업/섹터 RS (구성종목 평균 후 랭크, 산업 분류 체계 필요)
11. 런업 HP + 베이스/피벗 탐지 + VCP (최고 난도, 돌파 스크리닝 원할 때만. VCP-A가 가성비 최고)

**MVP 스크리너 최소셋**: SMA 50/150/200 + 52주고가 거리(Trend Template) + RS Rating 1~99 + EPS Rating. → 항목 1~6 + 9면 동작하는 스크리너.


---

# 📄 `docs/ams-reference/05-clickhouse-data-layer.md`

# 05. ClickHouse 데이터 계층 — 멱등 적재 · 리샘플링 · 펀더멘털

← [인덱스](00-index.md) · 관련: [02-data-collection.md](02-data-collection.md), [04-indicators-rs-ta.md](04-indicators-rs-ta.md)

> stock_app의 `shared/clickhouse_schema.py`(현재 plain MergeTree)를 개선할 **최고가치 항목**이 여기 있다. AMS의 실제 테이블은 6개이며 **전부 `ReplacingMergeTree`**, 날짜 테이블은 **전부 `PARTITION BY toYYYYMM(date)`**, **TTL은 어디에도 없음**.

## A. ClickHouse 계층

### A.1 테이블 인벤토리

| 테이블 | 엔진(버전컬럼) | ORDER BY | dedup 뷰 | 용도 |
|---|---|---|---|---|
| `stock_ta_daily` | `ReplacingMergeTree(updated_at)` | `(country_code, date, stock_id)` | `..._dedup` (`SELECT * … FINAL`) | 종목별 일 TA 스냅샷 + 비정규화 차원/레이팅 |
| `industry_ta_daily` | `ReplacingMergeTree(updated_at)` | `(country_code, date, industry_id)` | `..._dedup` | 산업/섹터 RS 집계 |
| `stock_pattern_daily` | `ReplacingMergeTree(created_at)` | `(country_code, date, pattern_type, stock_id)` | 없음(`FINAL` 인라인) | 차트 패턴 탐지 |
| `stock_pattern_weekly` | `ReplacingMergeTree(created_at)` | 동일 | 없음 | 주봉 패턴 |
| `stock_hp_cache` | `ReplacingMergeTree(updated_at)` | `(country_code, stock_id, horizon, date)` | 없음 | 런업 HP(파티션 없음, date가 정렬키라 ALTER 불가→rebuild 필요) |
| `stock_anchor_hp_cache` | `ReplacingMergeTree(updated_at)` | `(country_code, stock_id, date)` | `..._dedup` | 52wh/ath HP 사전계산 |

**타입 규칙**:
- `country_code`/`horizon`/`pattern_type`/식별문자열(`symbol`,`name`,`exchange_code`,…) → **`LowCardinality(String)`** (파트별 딕셔너리 인코딩 → 날짜별 비정규화 비용 거의 0)
- 지표 대부분 **`Nullable(Float32)`**, 금액/집계(시총/주식수/percent-rank)만 `Float64`
- 레이팅 `Nullable(Int16)`, 랭크 `Nullable(Int32)`, bool `Nullable(UInt8)`
- `created_at`/`updated_at` = `DateTime DEFAULT now()`

### A.2 ⭐ 멱등 스키마 레시피 (기동 시 — 최우선 채택 패턴)

기동 순서(엄격):
1. 각 테이블 `CREATE TABLE IF NOT EXISTS …`
2. `*_ALTERS` 실행 — 각각 `ALTER TABLE t ADD COLUMN IF NOT EXISTS col type` (배포 시 신규 컬럼 무중단 반영)
3. **dedup 뷰를 마지막에 재생성** — `CREATE OR REPLACE VIEW v AS SELECT * FROM t FINAL`

**핵심 인사이트**: ClickHouse 뷰는 **생성 시점에 컬럼 목록을 고정**하므로, `ADD COLUMN` 후엔 `SELECT *`를 다시 펼치도록 뷰를 재생성해야 한다 → "컬럼 추가에 강한" dedup 뷰. 조회는 항상 `_dedup` 뷰(또는 `FINAL`)로, raw 테이블 직접 조회 금지.

**드리프트 방지**: 컬럼명→타입 dict **하나**가 `CREATE TABLE` splice와 `ALTERS` 목록을 **둘 다** 구동 → DDL과 마이그레이션이 절대 어긋나지 않음.

### A.3 rebuild (temp 테이블 + 원자적 스왑)

`ADD COLUMN`으로 안 되는 변경(정렬키 변경, 잘못된 join 백필 정정)용: `create_temp → populate → verify → swap`.
- **verify 게이트**: temp 비어있으면 중단; 컬럼별 **NULL 비율 >2%**(잘못된 join/날짜오프셋 의심), `zero_check` 컬럼(고가/저가는 0 불가)의 **0 비율** 검사(NULL이 못 잡는 LEFT JOIN 기본채움 탐지)
- **swap**: temp가 live의 **90% 미만이면 중단**(부분빌드 데이터 손실 방지, `force` 예외). Atomic DB면 **`EXCHANGE TABLES`**(원자적), 아니면 `RENAME` 폴백
- 테이블명은 바인드 불가 → `^[A-Za-z0-9_]+$` 검증 후 삽입

### A.4 스키마 비의존 클라이언트

- 제네릭 API만: `execute/fetch_all/fetch_one/insert_records`. 클라이언트는 **스키마를 모름**(DDL은 테이블 모듈이 소유). stock_app의 `clickhouse_schema.py` 철학과 동일.
- read/write 클라이언트 분리(write는 300s 타임아웃, 수분짜리 벌크 싱크용), 지수 백오프(1s→60s)
- **at-least-once** 삽입 의미 → 멱등성은 **ReplacingMergeTree dedup에 의존**(재시도 벌크 삽입이 안전한 이유)
- `autogenerate_session_id=False`(무세션 동시요청 잠금 방지)

### A.5 (Postgres→ClickHouse 싱크) — stock_app 각색
AMS는 MySQL `mysql()` 테이블함수로 ClickHouse 안에서 MySQL을 읽어 싱크한다. stock_app은 **`postgresql()` 테이블함수**로 대체. 유지할 기법:
- carry-forward 고가/저가용 **ASOF LEFT JOIN**(`ta.date > ohlcv.date`, 직전 거래일 상속), `join_use_nulls=1`
- 최신 지표용 `argMax(metric, date) … GROUP BY id` + 최근 윈도우(35일) 제한
- **WHERE를 소스 서브쿼리 안에 직접** 삽입(ClickHouse가 join 2개 넘으면 외부 소스로 WHERE push-down 안 함)

> 단, stock_app 초기엔 Postgres는 마스터/유저만, 시계열은 ClickHouse 직결이라 이 복잡한 싱크가 불필요할 수 있음. RS Rating 같은 횡단면 랭킹을 ClickHouse에서 계산할 때만 참고.

## B. OHLCV 리샘플링

> ⚠️ pandas 아님, ClickHouse 아님 — **MySQL SQL 윈도우 함수**, 결과는 MySQL `stock_ohlcv_weekly/monthly/yearly`.

**캐스케이드**: weekly←daily, monthly←daily, **yearly←monthly**(연봉은 월봉에서, 더 저렴)

| 타임프레임 | 버킷키 | 앵커 | 소스 |
|---|---|---|---|
| 주봉 | `YEARWEEK(date,1)` | ISO 월요일 시작 | daily |
| 월봉 | `DATE_FORMAT(date,'%Y-%m')` | 캘린더 월 | daily |
| 연봉 | `YEAR(start_date)` | 캘린더 연 | monthly |

**필드 집계**(3개 타임프레임 동일): open=`FIRST_VALUE`, close=`LAST_VALUE`(UNBOUNDED), high=`MAX`, low=`MIN`, volume=`SUM`, start/end_date=`MIN/MAX(date)`. `INSERT … ON DUPLICATE KEY UPDATE`(멱등). `start_date`는 버킷 시작으로 snap해 부분(최신) 버킷 전체 재계산.

→ **stock_app 각색(Postgres)**: `YEARWEEK(date,1)`→`date_trunc('week',date)`(Postgres 주=월요일, 일치), `%Y-%m`→`date_trunc('month')`, `YEAR`→`date_trunc('year')`; `ON DUPLICATE KEY UPDATE`→`ON CONFLICT DO UPDATE`. 집계 계약과 yearly←monthly 캐스케이드 유지.

## C. 펀더멘털

> ⚠️ 현재 수집은 **EPS(KIS `financial_ratio`) + Sales(KIS `income_statement`)만**. PER/PBR/ROE/배당은 이 파이프라인에 없음. **OpenDART는 휴면**(테스트 파일만, 미연결). `market_cap`/`shares`는 별도 `market_data` 파이프라인.

### 수집 필드 & 소스
| 필드 | KIS 엔드포인트 | raw 필드 |
|---|---|---|
| `sales_acc`(YTD 누적매출) | `income_statement` | `sale_account` |
| `eps_acc`(YTD 누적EPS) | `financial_ratio` | `eps` |
| `fiscal_yymm` | 둘 다 | `stac_yymm` |
| `sales`/`eps`(분기 개별) | 파생(누적 차분) | — |
| `eps_qoq/yoy_growth`, `sales_*_growth` | 파생 | — |

### ⭐ YTD 누적 → 분기 개별 (de-accumulation, 비자명 핵심)
KIS는 **YTD 누적**을 준다. 연속 분기를 차분해 개별 분기값 복원:
- Q1: 개별 = 누적
- Qn(n>1)이고 `quarter - prev_quarter == 1`: 개별 = `acc − prev_acc`, 아니면 `NaN`
- 종목별 `fiscal_start_month` 존중. 성장률 = `(cur−prev)/|prev|×100`, QoQ=shift1, YoY=shift4. **연간** = Q4 행만, YoY=shift 1년.

**저장**(멱등 upsert): `stock_fundamental_qtr`(eps/sales + ytd + qoq/yoy), `stock_fundamental_annual`(Q4 파생 + yoy).

### TA로 연결
`stock_fundamental_qtr`를 TA가 다시 읽어 `eps_yoy`/`sales_yoy`(1년 shift self-join), `eps_cagr`(`(eps_3y/eps_5y)^(1/2)−1`×100), `eps_qoq`를 daily TA에 기록 → ClickHouse 싱크 후 `ntile(99)`로 `eps_qoq_rating`/`eps_cagr_rating`.

## D. stock_app 채택 요약

**ClickHouse (즉시 반영 권장)**
1. **`daily_prices`/`fundamentals`를 `ReplacingMergeTree(updated_at)`로 변경** + `_dedup` 뷰(`SELECT * … FINAL`). `updated_at DateTime DEFAULT now()` 컬럼 추가. → 겹침 재수집이 중복 없이 최신 대체(멱등).
2. 기동 시 `ADD COLUMN IF NOT EXISTS` ALTER → dedup 뷰 재생성(마지막). DDL+ALTER를 **컬럼 dict 하나**로 구동.
3. 조회는 dedup 뷰로만. 삽입 멱등성은 ReplacingMergeTree에 의존(재시도 안전).
4. 타입 규율: `LowCardinality`(국가/식별), `Float32`(지표), `Float64`(금액), `Nullable`(join 소스), `join_use_nulls=1`.
5. 정렬키 변경엔 temp 리빌드+`EXCHANGE TABLES`(NULL/zero/90% 가드).

**리샘플링**: 버킷키+윈도우함수(Postgres `date_trunc`), open=first/close=last/high=max/low=min/vol=sum, yearly←monthly, 버킷 snap.

**펀더멘털**: YTD de-accumulation 로직 채택, qtr/annual 2테이블 `ON CONFLICT` upsert, TA 성장지표 downstream 계산, `fiscal_start_month` 존중, **OpenDART 미도입**, market_cap/PER 등은 별도 market-data 파이프라인으로.


---

# 📄 `docs/ams-reference/06-screener.md`

# 06. 스크리너 — 저장형 조건검색 & 안전한 QueryBuilder

← [인덱스](00-index.md) · 관련: [04-indicators-rs-ta.md](04-indicators-rs-ta.md)

> AMS 스크리너는 **저장형(user-savable) + 카테고리 메타 기반**으로 성숙하다. stock_app이 제품 수준 스크리너를 만들 때의 청사진. 단, **동적 문자열 SQL(주입 취약점)** 은 반드시 개선해서 가져와야 한다.

## 1. 2계층 구조

1. **영속 계층**(Postgres): 저장 가능한 트리형 스크린 라이브러리. **admin이 정의한 카탈로그**(카테고리+항목)가 선택지를 정의, **사용자 저장 스크린**이 카탈로그 항목을 참조 + 항목별 `options` 저장.
2. **실행 계층**: 조회 시 저장된 항목을 SQL WHERE로 컴파일해 분석 스토어(AMS는 DuckDB 최신 / ClickHouse 과거·임의일)에 실행.

## 2. 데이터 모델 (저장형 스크리너)

**카탈로그(admin 정의, 공유)**
- `screen_category` — 카테고리 트리(`parent_id`, `path_sort_key` materialized path, `is_visible`)
- `screen_category_item` — **선택 가능한 조건 정의**. 핵심 컬럼 **`item_key`**(코드 빌더와의 조인 = 화이트리스트 키), `value_type`, `input_type`, `min/max`, `options`(JSON)

**사용자 소유**
- `user_screen` — 저장 스크린 또는 폴더(`is_folder`), 트리(`parent_id`+`path_sort_key`), soft-delete
- `user_screen_item` — **조합 행**. 복합PK `(user_screen_id, screen_category_item_id)`, `options`(JSON 실제 값/연산자), `logical`(**1=AND, 2=OR**)
- `user_favorite_screen` / `user_favorite_item` — 즐겨찾기

**options 형태**(discriminated union):
```jsonc
{"field":"price","op":">=","value":10}          // 단일
[{"field":"change_1m_pct","op":">","value":5}]   // 리스트(logical로 AND/OR)
[[{...},{...}],[{...}]]                            // 중첩(OR-of-AND, exceptional)
```

## 3. 조건 카탈로그 (item_key 발췌)

`QueryBuilder.builders`가 화이트리스트. 주요 항목:

| item_key | 의미 | TA 컬럼/SQL |
|---|---|---|
| `price`, `price_change` | 가격/변동(환율변환) | `price`, `price_change` |
| `change_1w/1m/3m/6m/12m/ytd_pct` | 기간 수익률 | 동명 컬럼 |
| `vs_52w_high`, `vs_index_26w` | 52주고가/지수 대비 | 동명 |
| `cr_daily/cr_weekly` | 일/주 종가 위치 | 동명 |
| `vs_sma10/21/50/150/200` | 이평 대비 | 동명 |
| `sma_positive_align_enable` | SMA 정배열 | `sma50>sma150 AND sma150>sma200` |
| `is_rs_line_within_proximity` | RS라인 근접 | `rs_line_proximity <= N` |
| `is_rs_line_new_high/low` | RS라인 신고/저가 | 동명(0/1) |
| `rs_rating`, `rs_rating_1m/3m/6m/12m` | RS 레이팅 | 동명(가중시 `weighted_*`) |
| `eps_rating` | EPS 레이팅 | `eps_rating` |
| `industry/sector_rs_rating`, `*_percent_rank` | 산업/섹터 RS | 동명 |
| `atr5/10/21/30/50` | ATR% | 동명 |
| `volume`, `vol_sma50` | 거래량(×1000) | 동명 |
| `day_vs_vsma50`, `week_vs_vwsma10` | 거래량 변화율 | 동명 |
| `exchange_id/sector_id/industry_id` | 필터 | `IN (...)` (국가 스코프) |
| `name_of_stocks` | 이름검색 | `name LIKE '%..%'` |
| `vcp_setting` | VCP | 복합 조건 |
| `runup_hp_*`, `off_hp_pct`, `max_drawdown_hp`, `days_since_hp` | HP 계열 | 리졸버로 컬럼 매핑 |

**일관성 가드**(채택 가치): 기동 시 모든 비가상 빌더 키가 실제 결과 컬럼에 존재하는지 assert.

## 4. ⭐ 단계별 통계 (funnel) — `screen_result_stats`

각 조건을 **누적 AND**로 적용하며 생존 종목 수를 세, "어느 필터가 얼마나 걸러냈는지" 제공:
- 단계 predicate = 이전 단계들의 누적 AND
- **한 행에 병렬 조건부 카운트**: DuckDB `COUNT(*) FILTER (WHERE 누적)`, ClickHouse `countIf(누적)`
- 연속 컬럼 간 감소량 = 그 필터가 제거한 수. 전체 = `total_stock_count`

→ **stock_app 채택**: Postgres `FILTER (WHERE ...)` 네이티브 지원. 동일 predicate 객체를 누적 합성해 `count().filter(and_(*prefix))`로 재현.

## 5. 실행 경로 (dual engine)
기본 DuckDB(최신 스냅샷), 과거 `target_date`면 ClickHouse 강제. 국가별 뷰 `v_final_ta_kr/us`(DuckDB) / `stock_ta_daily_dedup` FINAL 필터(ClickHouse). HP/VCP/weighted-RS는 **참조될 때만** LEFT JOIN 서브쿼리 추가(`\bcol\b` 정규식 참조탐지).
→ stock_app은 **ClickHouse 단일 엔진**이라 이 이중 경로 불필요(단순화 이점).

## 6. ⚠️ 보안 — 반드시 개선할 것

**파라미터화(안전)**: 영속 SQL(create/copy/upsert), ClickHouse의 country_code(정규식), date(정규식), limit/offset(`int()`), sort_column(화이트리스트).

**문자열 연결(주입 취약)**: `build_sql_parts`가 `option['field']`를 **그대로** SQL에 삽입하고 문자열 value를 **이스케이프 없이** 따옴표로 감쌈. `field`는 사용자 JSON에서 오며 **화이트리스트 안 됨**(op만 Pydantic Literal 검증). → 저장된 자기 스크린 내에서라도 실제 SQLi 벡터.

## 7. ⭐ stock_app용 안전한 QueryBuilder 설계

**화이트리스트 우선 + 파라미터 바인딩** 컴파일러:
1. **필드 레지스트리**: `FIELD_SPEC: {item_key → {column, type, allowed_ops, transform}}`. 레지스트리에 없는 `field`는 거부. **물리 컬럼명은 레지스트리에서만** 오고 사용자 입력에서 절대 안 옴.
2. **연산자 화이트리스트**: enum → 서버측 SQL 연산자 매핑.
3. **값은 항상 바인드 파라미터**, 절대 인터폴레이션 안 함. `IN`은 `IN (:p0,:p1,...)` 확장, `LIKE`는 `f"%{v}%"`를 파라미터로 바인드.
4. **SQLAlchemy Core**로 파라미터화 SQL 생성 — `Column >= :p`, `.in_()`, `.like()`, `and_()/or_()`. AMS의 표현력 있는 AND/OR 중첩은 유지하되 주입 제거.
5. funnel은 동일 predicate 객체를 누적 합성 → `func.count().filter(and_(*prefix))`.
6. `sort_column`은 레지스트리 검증, `limit/offset`은 `int` 캐스팅 + 상한.

## 8. 최소 저장형 스크리너 스키마 (Postgres)

AMS 대비 안전/견고 개선점: `options`를 **`JSONB`**(TEXT 아님), 실제 FK + `ON DELETE CASCADE`, `item_key`를 코드 레지스트리로 제약, 컴파일러는 화이트리스트+바인드만.

```sql
-- admin 카탈로그
CREATE TABLE screen_category (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL,
  parent_id BIGINT REFERENCES screen_category(id),
  sort_order INT DEFAULT 0, path_sort_key TEXT DEFAULT '',
  is_visible BOOLEAN DEFAULT TRUE, is_deleted BOOLEAN DEFAULT FALSE, meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE screen_category_item (
  id BIGSERIAL PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES screen_category(id),
  parent_item_id BIGINT REFERENCES screen_category_item(id),
  name TEXT NOT NULL,
  item_key TEXT NOT NULL UNIQUE,      -- 코드 FIELD_SPEC과 1:1
  value_type SMALLINT, input_type SMALLINT,
  min NUMERIC(18,4), max NUMERIC(18,4), options JSONB,
  is_visible BOOLEAN DEFAULT TRUE, is_deleted BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0, path_sort_key TEXT DEFAULT '');

-- 사용자 소유
CREATE TABLE user_screen (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL, name TEXT NOT NULL,
  is_folder BOOLEAN DEFAULT FALSE,
  parent_id BIGINT REFERENCES user_screen(id),
  sort_order INT DEFAULT 0, path_sort_key TEXT DEFAULT '',
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX ON user_screen (user_id, parent_id);

CREATE TABLE user_screen_item (
  user_screen_id BIGINT NOT NULL REFERENCES user_screen(id) ON DELETE CASCADE,
  screen_category_item_id BIGINT NOT NULL REFERENCES screen_category_item(id),
  user_id BIGINT NOT NULL,
  options JSONB NOT NULL,             -- {field,op,value} | [...] | [[...],...]
  logical SMALLINT NOT NULL DEFAULT 1 CHECK (logical IN (1,2)),  -- 1=AND,2=OR
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_screen_id, screen_category_item_id));

CREATE TABLE user_favorite_screen (
  user_id BIGINT NOT NULL,
  screen_id BIGINT NOT NULL REFERENCES user_screen(id) ON DELETE CASCADE,
  sort_order INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, screen_id));
```

## 9. 채택 요약

**Adopt**: 카탈로그+저장스크린 분리 · `item_key` 화이트리스트 조인 · 기동 일관성 assert · 누적 funnel(`countIf`/`FILTER`) · materialized-path 트리 · `ColumnResolver`(사용자키≠물리컬럼) · 참조탐지 조건부 JOIN.
**Avoid**: `build_sql_parts` 문자열 연결(비화이트리스트 field·미이스케이프 value) · limit/offset raw 인터폴레이션 · AND/OR를 매직 int로만 저장(→ enum/CHECK).


---

# 📄 `docs/ams-reference/07-scheduling.md`

# 07. 배치 스케줄 — 멀티마켓 야간 파이프라인

← [인덱스](00-index.md) · 관련: [03-overseas-stocks.md](03-overseas-stocks.md)

> AMS는 7개 시장을 각자 **로컬 타임존 기준**으로 수집·계산한다. stock_app이 국내만 하면 단순하지만, **해외를 지원하면 이 타임존 오케스트레이션이 필수**다.

## 1. 파이프라인 순서 (의존성 있는 사슬)

각 시장에서 로컬 시간 기준으로 순차 실행 — **앞 단계 완료가 뒤 단계의 전제**:

| 로컬 시각 | 작업 | 워커 |
|---|---|---|
| 22:00 | 종목 OHLCV 수집 | kis_worker |
| 22:01 | 지수(MarketIndex) 수집 | kis_worker |
| 23:00 | SMA 계산 | kis_worker |
| 00:01 | RS 계산 | kis_worker |
| 00:05 | 마켓데이터(시총/주식수) 수집 | kis_worker |
| 00:30 | TA 계산 | ta_worker |
| 01:00 | TA 캐시 refresh | ta_server |
| 03:00 (KR만) | 펀더멘털 수집 | kis_worker |

**핵심 = 수집 → 기본지표(SMA) → 상대강도(RS) → 종합 TA → 캐시**의 순차 의존 파이프라인.

> ⚠️ 순서 함정(AMS가 실제로 겪음): 마켓데이터(시총)는 원래 01:00이었는데 TA 싱크(00:30)보다 늦고 캐시 refresh(01:00)와 겹쳐, 두 소비자가 당일 시총을 못 읽거나 경합했다. → **RS(00:01)와 TA(00:30) 사이인 00:05로 이동**. 교훈: **소비자보다 생산자를 먼저** 스케줄.

## 2. 시장별 로컬 타임존 cron

각 거래소를 자기 로컬 타임존에 스케줄:
```python
CronTrigger(hour=22, minute=0, timezone=timezone(exchange.local_timezone))  # 잡 id: f'{exchange.code}_OHLCV'
```
`Exchange` 마스터의 `local_timezone`/`close_time`이 스케줄 소스. 지원 시장: KRX, 미국(NYSE/NASDAQ), 일본(TSE), 홍콩(HKEX), 중국(SSE), 베트남(HOSE/HNX).

## 3. 미국 서머타임(DST) — KST 환산 변동

미국 로컬 22:00 수집이 KST로는 DST에 따라 달라진다:
- **EDT(서머타임)**: 22:00 EDT = **11:00 KST**(다음날)
- **EST(해제)**: 22:00 EST = **12:00 KST**(다음날)

RS/TA/캐시도 각각 +1/+1.5/+2시간씩 밀려 EDT 13:01/13:30/14:00, EST 14:01/14:30/15:00 KST. → 타임존 라이브러리(`pytz`/`zoneinfo`)로 로컬 기준 cron을 걸면 DST가 자동 처리됨(KST 하드코딩 금지).

## 4. 겹칠 때 우선순위
동시각이면: ① RS 계산(고객 요구로 로컬 00:01 엄수) → ② 종목 OHLCV → ③ 지수 OHLCV → ④ SMA 등 indicator.

## 5. stock_app 적용

**국내만이면(현재)**: 단일 파이프라인이면 충분. 현재 beat는 `16:00 단일 수집`뿐인데, 지표를 붙이면 **수집 → SMA → (RS) → TA**의 순차 체이닝이 필요.
- Celery **chain/chord**로 "수집 완료 → 지표 계산 트리거" 구성 (또는 단계별 beat + 완료 신호)
- 각 단계는 앞 단계 완료 전제 → **단계 간 완료 신호 + 실패 격리** 필수
- 국내는 16:00(장 종료 후) 시작으로 위 순서를 압축 실행 가능

**해외까지 확장하면**: [03](03-overseas-stocks.md)의 `Exchange.local_timezone` 기반 **거래소별 cron**으로 전환. 미국 DST는 타임존 인식 cron으로 자동 처리. 단, AMS의 "국가별 타임존 스케줄" 복잡도가 그대로 들어오므로, **거래소를 데이터(Exchange 테이블)로 다루고 스케줄을 동적 생성**하는 구조가 핵심.

> stock_app 단순화 여지: AMS는 프로세스가 5개(kis_worker/ta_worker/ta_server…)라 단계마다 다른 워커가 붙지만, stock_app은 **Celery 하나**로 통합하고 단계는 태스크 체인으로 표현하면 운영이 훨씬 단순하다. ([01](01-architecture.md))


---

# 📄 `docs/ams-reference/08-tech-debt-and-adoption.md`

# 08. AMS 기술부채 & stock_app 종합 채택 로드맵

← [인덱스](00-index.md)

> "무엇을 따라하고, 무엇을 처음부터 피할지"의 종합. AMS가 역사적으로 짊어진 복잡도를 stock_app은 단순하게 우회할 수 있다.

## 1. AMS 기술부채 — 처음부터 피할 것

1. **api_server 책임 과다** — 인증/관리/차트/스크리너/KIS 프록시/SSE가 한 서버에. → stock_app은 도메인별 라우터 분리 + Clean Architecture(Router→Service→Repository)를 초기부터.
2. **동적 문자열 SQL 남용** ⚠️ — 스크리너 `build_sql_parts`가 사용자 `field`를 화이트리스트 없이 SQL에 직접 삽입, value 미이스케이프 → **실제 SQLi 벡터**. → 파라미터 바인딩 + 필드/연산자 화이트리스트([06](06-screener.md)).
3. **네이밍/오탈자 부채** — 실제 파일/필드명에 `sreener.py`, `anaysis.py`, `caculator.py`, `screen_categories_with_itmes` 등 오탈자가 굳어짐. → **초기 네이밍 신중히**(API/테이블명은 한 번 굳으면 바꾸기 어렵다).
4. **프로세스 의존성 사슬** — 스크리너 정상 동작에 MySQL 적재 + TA 계산 + 캐시 refresh + ta_server 기동이 모두 맞물림. → 계층 축소(2-스토어) + 단계 실패 격리·모니터링.
5. **다중 스토어 동기화** — MySQL↔ClickHouse↔DuckDB 3중 동기화(DuckDB는 향후 ClickHouse로 이전 예정인 과도기 산물). → ClickHouse 단일 조회 계층으로 회피([01](01-architecture.md), [05](05-clickhouse-data-layer.md)).
6. **at-least-once 삽입 + plain MergeTree라면 중복 위험** — AMS는 ReplacingMergeTree로 방어. → stock_app도 동일 채택([05](05-clickhouse-data-layer.md)).
7. **하드코딩된 `production` 모드 / adjusted-price 플래그** — sandbox 테스트 어려움. → config화([03](03-overseas-stocks.md)).

## 2. 종합 Adopt / Adapt / Avoid

| 구분 | 항목 | 참조 |
|---|---|---|
| ✅ Adopt | API/Worker 계산-조회 분리 | [01](01-architecture.md) |
| ✅ Adopt | `ReplacingMergeTree(updated_at)` + `_dedup` 뷰 멱등 적재 | [05](05-clickhouse-data-layer.md) |
| ✅ Adopt | `ADD COLUMN IF NOT EXISTS` → 뷰 재생성, DDL/ALTER를 dict 하나로 | [05](05-clickhouse-data-layer.md) |
| ✅ Adopt | 2단계 KIS 토큰 캐시(로컬+Redis), 5xx 백오프, sandbox | [02](02-data-collection.md) |
| ✅ Adopt | `AsyncLimiter` 레이트리밋 + fetch/write 분리 + 청킹 + 실패격리 | [02](02-data-collection.md) |
| ✅ Adopt | 수정주가(FID_ORG_ADJ_PRC=0) | [02](02-data-collection.md) |
| ✅ Adopt | 리샘플링 버킷키+윈도우함수(open=first/close=last/…) | [05](05-clickhouse-data-layer.md) |
| ✅ Adopt | 펀더멘털 YTD de-accumulation | [05](05-clickhouse-data-layer.md) |
| ✅ Adopt | 저장형 스크리너 카탈로그+`item_key` 화이트리스트 + funnel 통계 | [06](06-screener.md) |
| ✅ Adopt | RS Rating을 날짜별 전종목 윈도우함수(NTILE99/percent_rank) | [04](04-indicators-rs-ta.md) |
| 🔧 Adapt | `country_code`+`Exchange` 추상화(해외 지원) | [03](03-overseas-stocks.md) |
| 🔧 Adapt | 해외 백필 = end_date+period 반복(시작일 없음) | [03](03-overseas-stocks.md) |
| 🔧 Adapt | 거래소별 로컬 타임존 cron(미국 DST 자동) | [07](07-scheduling.md) |
| 🔧 Adapt | RS/TA 지표 단계적 확장(Trend Template→RS→EPS→베이스) | [04](04-indicators-rs-ta.md) |
| 🔧 Adapt | 5+ 프로세스 → Celery 단일 통합(단계=태스크 체인) | [01](01-architecture.md), [07](07-scheduling.md) |
| 🔧 Adapt | MySQL `mysql()` 싱크 → Postgres `postgresql()` 테이블함수 | [05](05-clickhouse-data-layer.md) |
| ⛔ Avoid | 동적 문자열 SQL → 파라미터/화이트리스트 | [06](06-screener.md) |
| ⛔ Avoid | 다중 스토어(DuckDB) 동기화 → ClickHouse 직결 | [01](01-architecture.md) |
| ⛔ Avoid | api_server 책임 과다 / 네이밍 부채 / 하드코딩 mode | 본 문서 |
| ⛔ Avoid | OpenDART 도입(AMS도 미사용), market_cap을 펀더멘털에 혼입 | [05](05-clickhouse-data-layer.md) |

## 3. stock_app 단계별 실행 제안

**즉시 (3단계 진입 직전)**
- ClickHouse `daily_prices`/`fundamentals`를 **`ReplacingMergeTree(updated_at)` + dedup 뷰**로 전환(`updated_at` 컬럼 추가). → 겹침 재수집 멱등성 확보.
- `stock_meta`를 `country_code`+`exchange`로 일반화(해외 대비), `exchange` 마스터 테이블 도입 검토.

**3단계 (수집 파이프라인)**
- `KISDataSource`/`MockDataSource` 인터페이스(fetch→도메인→write), `country_code`/`exchange` 파라미터.
- KIS 구현: 2단계 토큰 캐시(Redis 공유), AsyncLimiter, end_date 청킹(해외), 필드 매핑, 수정주가.

**4단계 (지표·스크리너·API)**
- 지표: [04](04-indicators-rs-ta.md) Tier 0~1(SMA 세트 + 지수 + RS Line/Score/Rating)부터.
- 스크리너: [06](06-screener.md)의 안전한 QueryBuilder + 저장형 스키마 + funnel.

**해외 확장 시**
- [03](03-overseas-stocks.md) 거래소 매핑/엔드포인트 차이, [07](07-scheduling.md) 로컬 타임존 스케줄.

## 4. 참고
- AMS 자체 상세 분석: `ams/workspace/api/docs/ams-api-analysis.md`
- AMS TA 공식 스펙: `ams/workspace/api/docs/ta.md`
- AMS 수집 스케줄: `ams/workspace/api/docs/data_collection_schedule.md`, `kst_data_collection_schedule.md`


---

# 📄 `docs/architecture_plan.md`

# 주식 앱 풀스택 상세 아키텍처 및 설계서

## 🏗️ 1. 전체 시스템 아키텍처 및 모노레포 구조
*   **Mobile App (Client)**: React Native (Expo), Zustand, React Query, NativeWind (일반 유저용)
*   **Web App (Client)**: React (Vite/Next.js), Zustand, TailwindCSS (일반 유저 웹용)
*   **Admin Web (Client)**: React (Vite), Zustand, React Query, TailwindCSS (관리자용)
*   **Backend API Server**: Python FastAPI (클라이언트 요청 처리 전담)
*   **Backend Worker Server**: Python Celery + Redis (데이터 수집, 무거운 연산, 푸시 알림 전담)
*   **Database**: PostgreSQL (RDBMS), ClickHouse (OLAP), Redis (Message Broker & Cache)

### 📂 모노레포(Monorepo) 디렉토리 구조 (Worker 분리 반영)
코드는 하나의 `backend` 폴더에서 관리하되, Docker 배포 시 컨테이너(프로세스)를 API와 Worker로 완벽히 분리하여 실행합니다.

```text
stock_app/
├── backend/               # FastAPI 및 Celery 백엔드 워크스페이스
│   ├── apps/              # 용도별 독립 배포가 가능한 마이크로서비스(앱) 모음
│   │   ├── auth/          # 인증 서버 (Users, OAuth, JWT 발급)
│   │   ├── blog/          # 블로그/커뮤니티 서버 (게시판, 댓글)
│   │   ├── stock_api/     # 주식 API 서버 (스크리너 조회, 차트 데이터 전송)
│   │   └── collector/     # 데이터 수집 워커 서버 (시세/재무 수집, 알림 발송 - Celery)
│   └── shared/            # 공통 DB 모델(SQLAlchemy), 유틸리티, 설정 공유
├── mobile/                # React Native (Expo) - 모바일 앱
├── web_client/            # React (Vite) - 일반 유저용 웹 서비스
├── admin_web/             # React (Vite) - 사내 관리자용 어드민
├── k8s/                   # Kubernetes 배포 매니페스트
├── docker-compose.dev.yml # 로컬 개발용 인프라(DB + API + Worker)
└── README.md
```

---

## 🗄️ 2. 상세 데이터베이스 스키마 설계
*   **PostgreSQL (관계형 데이터)**:
    *   `users`: 회원 정보, 소셜 로그인 토큰, FCM 디바이스 토큰, 권한(Role: FREE, PREMIUM, ADMIN 등)
    *   `boards`: 게시판/메뉴 카테고리 - `id`, `name`, `order_index`, `is_active`, `min_role_required` (접근 최소 권한)
    *   `blog_posts`: 블로그 게시글 (`board_id` FK 포함), 작성자, 제목, 본문(HTML), 생성일
    *   `blog_comments`: 댓글 내용, `post_id` FK, 작성자
    *   `push_templates`: 수동 발송용 푸시 알림 템플릿/발송 이력 내역 (`id`, `title`, `body`, `created_at`, `last_sent_at`)
    *   `stock_meta`: 주식 종목 마스터 정보 (종목코드, 회사명, 시장구분)
*   **ClickHouse (시계열 데이터 및 스토리지 관리)**:
    *   `daily_prices`: `ticker`, `date`, `open`, `high`, `low`, `close`, `volume`, `ma5`, `ma20`, `ma50`, `ma120`, `bb_upper`, `bb_lower`, `rsi_14`, `macd`
    *   `fundamentals`: `ticker`, `date`, `per`, `pbr`, `roe`, `dividend_yield`, `market_cap` (스크리너 JOIN용 재무 데이터)
    *   **스토리지 최적화 전략 (TTL & 파티셔닝)**:
        *   **압축(Compression)**: ClickHouse의 컬럼형 스토리지 특성상 시계열 데이터가 1/10 수준으로 고도로 압축되어 저장되므로 용량 부담이 매우 적습니다. (예: 전 종목 10년 치 일봉 데이터도 수백 MB 수준)
        *   **파티셔닝(Partitioning)**: 연월(`toYYYYMM(date)`) 단위로 데이터를 쪼개서 저장하여, 오래된 과거 데이터를 조회할 때 전체를 뒤지지 않게 하고 삭제 시에도 디스크 I/O 없이 통째로 날릴 수 있게 합니다.
        *   **TTL (Time-To-Live)**: 일봉(Daily) 데이터는 장기 보관(예: 10년)하되, 향후 용량을 많이 차지하는 분봉(Minute) 데이터 추가 시 `TTL date + INTERVAL 3 MONTH` 설정을 통해 3개월이 지난 데이터는 백그라운드에서 자동 삭제되도록 설정하여 스토리지 풀(Full)을 미연에 방지합니다.

---

## 📡 3. 백엔드 용도별 독립 배포 설계 (MSA 지향형 모듈러 모노리스)
클라우드 환경에서 각 기능의 부하(트래픽)에 따라 서버를 개별적으로 스케일아웃(확장)하고 배포할 수 있도록 도메인(용도)별로 서버를 분리합니다. 하나의 코드베이스(`backend/`)를 공유하지만, Docker 배포 시에는 완전히 별개의 컨테이너로 독립 실행됩니다.

### 🟢 1. 주식 API 서버 (Stock API Server)
**역할**: 가장 트래픽이 많고 빠른 속도가 요구되는 조회 전용 서버. ClickHouse와 주로 통신합니다.
*   `/api/v1/stocks/*`: 스크리너 검색 결과, 실시간 호가, 차트 데이터 조회.

### 🟢 2. 커뮤니티 및 블로그 서버 (Blog & Board Server)
**역할**: 사용자가 직접 글을 쓰고 읽는 커뮤니티 전담 서버. PostgreSQL과 통신합니다.
*   `/api/v1/boards/*`: 동적 게시판(메뉴) 목록 관리.
*   `/api/v1/blogs/*`: 블로그 게시글 CRUD 및 댓글 관리.

### 🟢 3. 인증 서버 (Auth Server)
**역할**: 소셜 로그인, JWT 토큰 발급 및 검증, 권한 관리 전담.
*   `/api/v1/auth/*`: 토큰 발급, 갱신, 로그아웃.

### 🟡 4. 데이터 수집 및 워커 서버 (Collector & Worker Server)
**역할**: 클라이언트의 요청을 받지 않고, 백그라운드에서 무거운 연산과 데이터 수집만 전담합니다. (FastAPI가 아닌 Celery 기반 구동)
1.  **시세 및 재무 데이터 수집 (Data Pipeline)**: 

    *   `celery-beat`를 통해 매일 정해진 시간에 수집 Task 트리거.
    *   한국투자증권 OpenAPI를 통해 일봉 시세 및 재무 데이터(PER, PBR, ROE 등)를 수집합니다. (유지보수성을 위해 `mojito2`, `pykis` 등 기존 오픈소스 라이브러리와 공식 문서를 참조하여, 파이썬 `requests`와 `websockets`를 기반으로 **자체 커스텀 API 클라이언트를 직접 구현**합니다.)
    *   `pandas-ta`로 보조지표 연산 후 ClickHouse에 Bulk Insert.
2.  **푸시 알림 (Push Notifications)**:
    *   **자동 발송**: API 서버에서 새 글 등록 시 Celery로 발송 Task 위임.
    *   **수동 발송**: 관리자가 저장된 메세지를 선택해 수동 발송 시 Celery로 대량 발송 Task 위임.

---

## 📱 4. 프론트엔드 (모바일 & 웹 & 관리자 웹)
### 📱 모바일 앱 (Mobile)
*   **Role 기반 동적 탭 네비게이션**: 활성화된 `boards` 목록을 가져올 때, 현재 로그인한 유저의 Role(권한)과 메뉴의 `min_role_required`를 비교하여 접근 가능한 메뉴만 상단 스와이프 탭으로 렌더링 (권한 밖 메뉴는 비노출).
*   **실시간 알림**: FCM / APNs 기반의 푸시 서비스(Push Notification)를 통해 알림 수신.

### 💻 일반 웹 클라이언트 (User Web)
*   **반응형 UI (Responsive Web)**: 데스크톱, 태블릿, 스마트폰 등 기기별 해상도에 맞춰 UI가 자연스럽게 변형되는 반응형 웹 적용 필수 (TailwindCSS 등 활용).
*   **실시간 알림 (SSE 필수)**: 웹 브라우저 환경에서는 모바일 푸시 알림 대신 **SSE (Server-Sent Events)** 방식을 이용하여 서버로부터 실시간 알림을 수신하도록 백엔드와 연동 구현 필수.

### ⚙️ 관리자 웹 (Admin Web)
*   **유저 권한 관리 (Role Management)**: 전체 회원 목록을 조회하고, 특정 유저를 골라 등급(FREE, PREMIUM, ADMIN 등)을 즉시 변경하는 권한 부여 UI.
*   **메뉴 권한(Role) 제어**: 게시판/메뉴를 생성하거나 수정할 때, "어느 등급 이상부터 이 메뉴를 볼 수 있는지" 권한(min_role_required)을 설정.
*   **블로그 작성**: 카테고리 선택, 차트 스냅샷 첨부, 해시태그, 이미지 업로드 지원.
*   **푸시 및 알림 관리**: 관리자가 알림 템플릿을 작성하고 발송 시, 모바일은 Push로, 웹은 SSE로 발송되도록 통합 관리.

---

## 🚀 5. 초기 클라우드 배포 전략 (Cost-Effective Deployment)
초기 트래픽이 적은 서비스 런칭 단계에서는 막대한 고정 비용이 발생하는 AWS/GCP 매니지드 서비스 대신, **단일 가상 서버(VPS) 기반의 Docker Compose** 배포 방식을 채택하여 월 유지비를 최소화(월 1~2만 원 수준)합니다.

*   **추천 클라우드 호스팅 (택 1)**:
    1.  **Vultr (벌쳐)**: 월 약 $24 수준 (2Core, 4GB RAM). **한국(서울) 리전**이 있어 국내 유저 대상 서비스 시 응답 속도가 매우 빠르고 안정적입니다. (권장)
    2.  **Hetzner (헤츠너)**: 월 약 $8 수준 (4Core, 8GB RAM). 미국/독일 리전만 있어 핑(Ping)이 약간 발생하나, 가성비가 압도적으로 좋아 넉넉한 메모리가 필요한 ClickHouse 운영에 유리합니다.
*   **운영 체제 (OS)**: 상용 배포 서버는 안정성과 Docker 호환성이 가장 뛰어난 **Ubuntu LTS (예: 22.04 또는 24.04)** 버전을 기본 운영체제로 사용합니다.
*   **운영 방식 및 Ubuntu 초기 설정 가이드**:
    상용 서버(VPS) 구매 후 접속부터 서비스 배포까지의 상세 절차입니다.
    1. **서버 접속 및 보안 설정 (UFW 방화벽)**
       * `ssh root@<서버IP>` 로 접속 후 패키지 업데이트: `sudo apt update && sudo apt upgrade -y`
       * 방화벽 설정: `sudo ufw allow OpenSSH && sudo ufw enable`. **Cloudflare Tunnel은 아웃바운드 연결이라 80/443 인바운드 개방이 불필요**하다(포트포워딩·인바운드 포트 개방 없음).
    2. **Docker 및 Docker Compose 설치**
       * 공식 스크립트로 설치: `curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh`
       * `sudo apt install docker-compose-plugin -y`
    3. **소스코드 다운로드 및 환경변수 셋팅**
       * `git clone <프로젝트_레포지토리_주소>`
       * `cd stock_app` 이동 후 `.env.example`을 복사하여 `.env.production` 파일을 생성합니다. (KIS API Key, DB 비밀번호 등 실제 상용 키 입력)
    4. **Cloudflare Tunnel 연동 (인그레스 — 포트포워딩·Nginx 불필요)**
       * 구입하신 도메인의 네임서버를 **Cloudflare**로 이전하여 무료 플랜에 등록합니다.
       * 서버에 `cloudflared` 데몬을 설치하고 Zero Trust에서 터널을 생성해 연결합니다. 터널은 **아웃바운드** 연결이라 이중 NAT·포트포워딩 없이 동작하고, HTTPS는 Cloudflare 엣지가 종단하므로 Nginx/Certbot이 필요 없습니다.
       * Zero Trust의 **Published application routes**에서 서브도메인을 내부 Docker 포트로 라우팅합니다: `auth.haezean.com`→8001, `api`→8002, `blog`→8003, `app`→3000, `admin`→3001. ⚠️ DB 포트(5432/8123/9000/6379)는 절대 터널에 노출하지 않는다(LAN 전용).
       * 상세 절차는 `docs/server_setup.md`(배포 런북) · `docs/cloudflare_termius_guide.md`(SSH 터널) 참조.
    5. **최종 컨테이너 실행**
       * `docker compose -f docker-compose.prod.yml up -d --build` 명령어로 전체 시스템(FastAPI, Celery, Postgres, ClickHouse, Redis)을 일괄 백그라운드 실행합니다.

---

## 🛜 6. 윈도우(Windows) 개발 서버 및 네트워크 설정 가이드

**Q: 내 컴퓨터(localhost)에서 띄우는 로컬 개발 방법은 여전히 유효한가요?**
👉 **네, 완전히 유효하며 가장 기본이 되는 개발 방식입니다.** 
혼자서 코드를 짜고 브라우저로 확인할 때는 복잡한 네트워크 설정 없이 그저 `localhost:8000`이나 `localhost:5173`으로 접속하시면 됩니다. (여기에 명시된 네트워크/방화벽 설정은 **스마트폰 등 외부 기기에서 내 윈도우 PC로 접속해야 할 때만** 추가로 진행하시면 됩니다.)

### 💻 윈도우 개발 서버 셋업 및 외부 개방 절차
윈도우 환경에서 안정적으로 백엔드 인프라를 구축하고, 포트포워딩을 통해 모바일 앱(외부 기기)과 통신하기 위한 절차입니다.

1. **Docker Desktop 및 WSL2 설치 (기본 인프라)**
   * 윈도우용 Docker Desktop을 설치할 때 반드시 **WSL2 기반 엔진** 옵션을 켜서 설치해야 데이터베이스(Postgres, ClickHouse) 속도가 리눅스처럼 빠르게 동작합니다.
   * 터미널(PowerShell 또는 WSL2 Ubuntu)을 열고 `docker-compose -f docker-compose.dev.yml up -d`를 실행하여 로컬 DB들을 띄웁니다.
2. **윈도우 방화벽 인바운드 규칙 개방 (필수)**
   * 외부 기기(스마트폰)가 내 PC에 들어오려면 방화벽을 뚫어줘야 합니다.
   * PowerShell을 관리자 권한으로 열고 아래 명령어를 칩니다:
     `New-NetFirewallRule -DisplayName "FastAPI Dev" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow`
3. **공유기 포트포워딩(Port Forwarding) 매핑**
   * 공유기 설정(예: 192.168.0.1)에 접속 후:
   * 외부 포트 `8000` ➡️ 내부 IP(윈도우 PC의 192.168.0.X)의 `8000` 포트로 연결.
   * 외부 포트 `5173` ➡️ 내부 IP(윈도우 PC)의 `5173` 포트로 연결.
4. **클라이언트 앱(`.env.development`) 환경변수 세팅**
   * 스마트폰 앱 코드의 `.env.development` 파일에 `localhost` 대신 윈도우 PC의 공인 IP (또는 DDNS) 주소를 입력하여 API를 바라보게 합니다. (예: `EXPO_PUBLIC_API_URL=http://my-stock-dev.iptime.org:8000/api/v1`)

---

## 🧪 7. 자동화 테스트 및 QA (Quality Assurance) 전략
안정적인 서비스 운영과 리팩토링을 위해 각 환경별로 최적화된 테스트 프레임워크를 도입하여 테스트 케이스(Unit Test) 및 UI 자동화 테스트(E2E)를 구축합니다.

### 🟢 1. 백엔드 (FastAPI & Celery)
*   **프레임워크**: `pytest`
*   **단위/통합 테스트**: 
    *   `TestClient`를 활용하여 주요 API(인증, 스크리너 조회, 게시글 작성)의 응답 상태코드 및 JSON 스키마를 검증합니다.
    *   `unittest.mock`을 사용하여 한국투자증권 API 통신 구간을 가짜(Mock) 데이터로 대체하여, 주말이나 장 종료 후에도 수집 파이프라인의 로직을 안전하게 테스트합니다.

### 📱 2. 모바일 앱 (React Native)
*   **컴포넌트/단위 테스트**: `Jest` + `@testing-library/react-native` (Zustand 상태 변화 및 UI 컴포넌트 렌더링 검증)
*   **UI 자동화 테스트 (E2E)**: **Maestro (마에스트로)**
    *   최근 모바일 자동화 테스트의 대세로 떠오른 툴입니다. 기존 Detox 대비 설정이 압도적으로 쉽고 안정적입니다.
    *   단순한 YAML 파일 스크립트로 "앱 실행 ➡️ 스크리너 탭 클릭 ➡️ RSI 슬라이더 조절 ➡️ 차트 화면 진입 확인" 같은 실제 사용자의 터치/스크롤 흐름을 시뮬레이터에서 자동화하여 테스트합니다.

### 💻 3. 관리자 웹 (React/Vite)
*   **컴포넌트/단위 테스트**: `Vitest` + `@testing-library/react` (Vite 환경에 완벽히 호환되며 Jest보다 훨씬 빠름)
*   **UI 자동화 테스트 (E2E)**: **Playwright (플레이라이트)**
    *   마이크로소프트에서 만든 강력한 웹 E2E 툴입니다.
    *   "관리자 로그인 ➡️ 블로그 작성 메뉴 진입 ➡️ 차트 캡처 버튼 클릭 ➡️ 푸시 발송 버튼 클릭"의 전체 시나리오를 Chromium 브라우저를 띄워 자동으로 테스트하고, 실패 시 스크린샷과 비디오를 녹화해 줍니다.

---

## ⚙️ 8. CI/CD 배포 자동화 및 롤백 전략 (추후 도입 예정)
수동 배포의 번거로움을 없애고 "코드 푸시(Push)만 하면 알아서 테스트하고 배포되는" 환경을 구성하기 위해 **GitHub Actions**를 중앙 파이프라인으로 사용합니다. 현재 구상 중인 청사진은 다음과 같습니다.

### 1. 백엔드 및 웹 클라이언트 통합 배포 (서버 자동/수동 배포 및 롤백)
대상: `backend/`(API/Worker), `admin_web/`(관리자 웹), `web_client/`(일반 유저 웹)
*   **CI (지속적 통합)**: PR이 올라오면 GitHub Actions가 자동으로 `pytest`와 `Vitest`를 실행하여 코드가 깨지지 않았는지 검증합니다.
*   **CD (자동 배포)**: `main` 브랜치에 코드가 병합(Merge)되면, GitHub Actions가 우분투 상용 서버(VPS)에 SSH로 자동 접속하여 코드를 당겨오고(git pull) `docker-compose up --build -d` 명령어를 실행하여 3개의 서비스(API, Admin Web, User Web) 컨테이너를 무중단으로 재시작합니다.
*   **수동 배포 및 롤백 (Workflow Dispatch)**: 
    *   GitHub Actions의 `workflow_dispatch` 기능을 활용해 GitHub 웹페이지에 **"수동 배포 버튼"**을 만듭니다.
    *   원하는 Git 태그(Tag, 예: `v1.0.1`)나 특정 커밋을 선택해 버튼을 누르면 서버가 해당 과거 버전 코드로 돌아가 빌드됩니다. 
    *   배포 후 치명적 버그 발생 시, 정상 작동하던 직전 태그(`v1.0.0`)를 선택 후 수동 배포 버튼을 누르는 것만으로 즉각적인 서버 롤백(Rollback)이 완료됩니다.

### 2. 모바일 앱 (Expo EAS 자동화 및 롤백)
*   **코드 푸시 (OTA Update)**: 앱의 로직(JavaScript)이나 UI만 변경된 경우, 앱스토어 심사를 기다릴 필요 없이 `eas update` 명령어를 GitHub Actions가 실행하여 사용자들의 앱을 즉시(Over-The-Air) 업데이트합니다.
*   **모바일 롤백**: OTA 업데이트에 버그가 있을 경우, 관리자가 `eas update --republish` (또는 EAS 대시보드 롤백 버튼)를 사용해 즉각적으로 이전 버전 코드로 원격 롤백할 수 있습니다.
*   **스토어 자동 제출 (EAS Submit)**: 네이티브 코드가 변경되어 스토어 심사가 필요한 경우, GitHub Actions가 `eas build`와 `eas submit`을 연속으로 트리거하여 빌드부터 애플 앱스토어/구글 플레이스토어 심사 제출까지 100% 자동화합니다.

---

## 🔐 9. 소셜 간편로그인 (OAuth) 아키텍처 및 요구사항
국내 주식/커뮤니티 앱의 특성에 맞게 회원가입의 장벽을 낮추기 위해 **카카오와 구글** 간편 로그인을 우선적으로 지원합니다.

> ⚠️ **주의 (Apple App Store 심사 정책)**: 만약 iOS(아이폰) 버전 앱을 애플 앱스토어에 출시하실 계획이라면, 구글이나 카카오 같은 제3자 소셜 로그인을 제공할 때 반드시 **'Apple로 로그인(Sign in with Apple)'도 함께 제공**해야 심사에 통과할 수 있습니다. 안드로이드 전용이거나 웹만 서비스한다면 애플 로그인은 제외해도 무방합니다.

### 🔄 인증 아키텍처 플로우 (Mobile -> Backend)
1. **클라이언트 인증**: 모바일 앱(React Native)에서 각 플랫폼의 네이티브 SDK를 호출하여 사용자가 로그인하면, 해당 플랫폼(카카오 등)으로부터 **공급자 토큰(Access Token / ID Token)**을 발급받습니다.
2. **백엔드 검증**: 모바일 앱이 이 토큰을 우리 백엔드 API (`POST /api/v1/auth/social`)로 전송합니다. 백엔드(FastAPI)는 각 플랫폼의 공식 검증 서버(API)로 HTTP 요청을 보내 이 토큰이 위조되지 않았는지, 누구의 토큰인지 검증합니다.
3. **자체 JWT 발급**: 검증이 완료되면 PostgreSQL `users` 테이블을 조회하여 기존 회원은 로그인 처리, 신규 회원은 자동 가입 처리 후 최종적으로 서버 자체 **Access JWT**와 **Refresh JWT**를 발급합니다.

### 📋 프로젝트 관리자(Owner) 사전 준비 사항 (개인 개발자 가능)
사업자 등록증(비즈니스 계정) 없이 **개인 자격으로도 100% 무료로 연동 가능**합니다. 단, 사용자로부터 받아올 수 있는 정보(이메일, 닉네임, 프로필 사진) 외에 더 민감한 정보(예: 휴대폰 번호)를 수집하려면 추후 비즈니스 인증이 필요할 수 있습니다.
1. **Kakao Developers**: 개인 카카오 계정으로 가입 ➡️ 앱 생성 ➡️ REST API Key, Native App Key 발급 ➡️ 카카오 로그인 활성화
2. **Google Cloud Console**: 개인 구글 계정으로 가입 ➡️ 프로젝트 생성 ➡️ OAuth 동의 화면 구성(외부용) ➡️ OAuth 2.0 클라이언트 ID (iOS/Android/Web 각각) 발급

### 💻 개발 패키지 및 요구사항 (개발자용)
*   **프론트엔드 (React Native / Expo)**:
    *   `@react-native-seoul/kakao-login` (가장 널리 쓰이는 카카오 네이티브 모듈)
    *   `@react-native-google-signin/google-signin` (구글 로그인)
    *   *주의: 네이티브 모듈이 포함되므로 Expo Go 앱에서는 테스트할 수 없으며, `npx expo run:ios/android` (Custom Dev Client) 방식으로 빌드해야 합니다.*
*   **백엔드 (FastAPI)**: `httpx` (토큰 검증 통신용), `PyJWT` (자체 JWT 토큰 발급용)


---

# 📄 `docs/claude_system_context.md`

# Claude AI System Context & Architectural Constraints

> **To Claude (or Claude Code CLI):** 
> Read this document to understand the deployment, infrastructure, and architectural constraints of the `stock_app` project before making code changes or suggesting architectural modifications.

---

## 1. Environment & Infrastructure
*   **Target Server:** Personal Home Server (Ubuntu 24.04 on Mini PC) behind a Double NAT.
*   **Ingress / Networking:** **Cloudflare Tunnel (Zero Trust)** is used exclusively. 
    *   *Do NOT* suggest or configure Nginx, Traefik, Let's Encrypt, or Port Forwarding. Cloudflare handles HTTPS and routing.
    *   Subdomains route directly to localhost Docker ports (`auth.haezean.com` -> 8001, `api.haezean.com` -> 8002, `blog.haezean.com` -> 8003).
*   **CI/CD:** **GitHub Actions (Self-hosted runner)**. Code is pulled directly to the home server via the runner, built, and executed via Docker Compose.

## 2. Docker & Service Orchestration
The production environment uses `docker-compose.prod.yml` at the project root.
When writing Dockerfiles or Compose files, respect the following service boundaries:

### Databases (Stateful)
1.  **PostgreSQL (5432):** Main RDBMS for users, auth, metadata.
2.  **ClickHouse (8123, 9000):** OLAP database for high-volume time-series stock data and fundamentals.
3.  **Redis (6379):** Cache and message broker for Celery.

### Backend Microservices (FastAPI - Python 3.12)
*All APIs are built from the `backend/Dockerfile` using `uv`.*
1.  **Auth API:** Port `8001` (uvicorn apps.auth.main:app)
2.  **Stock API:** Port `8002` (uvicorn apps.stock_api.main:app)
3.  **Blog API:** Port `8003` (uvicorn apps.blog.main:app)

### Background Workers (Celery)
1.  **Worker:** `celery -A apps.collector.celery_app worker` (Data scraping, heavy tasks)
2.  **Beat:** `celery -A apps.collector.celery_app beat` (Scheduler)

## 3. Development Guidelines & Constraints
1.  **Dependency Management:** The backend strictly uses **`uv`**. When updating dependencies, use `pyproject.toml` and `uv.lock`. Do not use `pip install` directly in instructions without `uv`.
2.  **Environment Variables:** Do not hardcode secrets. The production compose file relies on `backend/.env.production`. For local dev, rely on `backend/.env.development` or `.env.example`.
3.  **Inter-Service Communication:** Backend services should communicate via the database (Redis/Postgres) or internal Docker DNS (e.g., `http://auth_api:8001`) if direct HTTP calls are necessary, not via the public Cloudflare URLs.
4.  **Monorepo Structure:** Keep backend code inside `/backend`, React Native inside `/mobile`, and React Vite apps inside `/admin_web` and `/web_client`.

## 4. Current CI/CD Workflow (split by target — same mini PC)
*   **Two workflows:** `deploy-server.yml` (paths: `backend/**`, `docker-compose.prod.yml`) and `deploy-web.yml` (paths: `web_client/**`, `admin_web/**`, `docker-compose.prod.yml`).
*   **Trigger:** Push to `main` matching the paths above (path-filtered auto), or manual `workflow_dispatch` from the Actions UI.
*   **Action:** Runs on `self-hosted` runner; each deploys only its own services via `docker compose ... up -d --build <services>` so the other stack (esp. the collection worker) is untouched.
*   *Note:* Ensure any changes to the build process are reflected in `docker-compose.prod.yml`.


---

# 📄 `docs/cloudflare_termius_guide.md`

# 이중 공유기 환경 Cloudflare Tunnel 및 Termius 연동 가이드

## 1. 개요
이 문서는 이중 NAT(공유기 2대 병렬 연결) 환경의 우분투(Ubuntu 24.04) 홈 서버를 **포트포워딩 없이 외부에서 안전하게 접속**하기 위한 가이드입니다. 특히, Mac 클라이언트 환경에서 `Termius` 앱을 사용하여 번거로운 명령어 입력 없이 원클릭으로 접속할 수 있도록 **백그라운드 자동 터널링(LaunchAgent)**을 구축하는 방법을 포함합니다.

---

## 2. 작동 원리
1. **서버 측:** Cloudflare Zero Trust 대시보드에서 터널을 생성하고, 서버(우분투)에 `cloudflared` 데몬을 설치하여 터널을 연결합니다.
2. **도메인 라우팅:** `ssh.haezean.com` 등의 도메인을 터널 내부의 `localhost:22` 로 연결(Published application routes)합니다.
3. **클라이언트 측(Mac):** Termius는 외부 프로그램을 끌어오는 기능(`ProxyCommand`)을 지원하지 않습니다. 따라서 Mac 자체에 `cloudflared`를 백그라운드 서비스(LaunchAgent)로 띄워 **가상의 로컬 포트(127.0.0.1:2222)**를 항상 열어둡니다.
4. **접속:** Termius는 항상 켜져 있는 가상의 로컬 포트로 접속하여 최종적으로 우분투 서버에 도달합니다.

---

## 3. 설정 단계

### 3.1. 서버(우분투) 쪽 터널 설정 (Cloudflare 대시보드)
1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)에 접속합니다.
2. **Networks ➡️ Tunnels** 메뉴로 이동 후 `Create a tunnel`을 클릭합니다.
3. 터널 종류로 **Cloudflared**를 선택하고 이름을 지정합니다.
4. OS 환경으로 **Debian ➡️ 64-bit**를 선택한 후, 나오는 설치 명령어 뭉치(token 포함)를 복사합니다.
5. 우분투 서버 터미널에 복사한 명령어를 붙여넣고 실행하여 데몬을 설치합니다.
6. Cloudflare 대시보드에서 `Next`를 누른 뒤, 상단의 **[Published application routes]** (또는 Hostname routes) 탭에서 도메인을 라우팅합니다.
   - **Subdomain:** `ssh` (원하는 서브도메인)
   - **Domain:** `haezean.com` (자신의 도메인 선택)
   - **Service Type:** `SSH`
   - **Service URL:** `localhost:22`
7. 설정을 저장하면 서버 쪽 셋업은 모두 완료됩니다. 기존 공유기의 22번 포트포워딩은 삭제해도 무방합니다.

### 3.2. Mac 클라이언트 필수 패키지 설치
Mac 터미널을 열고 Homebrew를 이용해 `cloudflared`를 설치합니다.

```bash
brew install cloudflared
```

### 3.3. Mac 부팅 시 터널 자동 실행 등록 (LaunchAgent)
Termius 접속을 편리하게 하기 위해, Mac이 켜질 때 터널이 항상 백그라운드에서 실행되도록 설정합니다.

1. 터미널에서 아래 명령어를 입력하여 자동 실행 스크립트 파일을 만듭니다.
   ```bash
   nano ~/Library/LaunchAgents/com.user.cloudflared.ssh.plist
   ```
2. 아래 XML 코드를 복사하여 붙여넣습니다. (아래 코드는 Apple Silicon(M1/M2/M3) 기준 경로인 `/opt/homebrew/bin/cloudflared`를 포함하고 있습니다.)
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.user.cloudflared.ssh</string>
       <key>ProgramArguments</key>
       <array>
           <string>/opt/homebrew/bin/cloudflared</string> 
           <string>access</string>
           <string>tcp</string>
           <string>--hostname</string>
           <string>ssh.haezean.com</string>
           <string>--url</string>
           <string>127.0.0.1:2222</string>
       </array>
       <key>RunAtLoad</key>
       <true/>
       <key>KeepAlive</key>
       <true/>
   </dict>
   </plist>
   ```
3. `control + O` ➡️ `엔터` ➡️ `control + X` 를 눌러 저장하고 편집기를 빠져나옵니다.
4. 아래 명령어를 실행하여 서비스를 즉시 백그라운드에 등록 및 실행합니다.
   ```bash
   launchctl load ~/Library/LaunchAgents/com.user.cloudflared.ssh.plist
   ```

### 3.4. Termius 접속 설정
이제 Mac 측에서 모든 준비가 끝났습니다.

1. **Termius** 앱을 실행합니다.
2. 새로운 접속(New Host)을 생성합니다.
3. 접속 정보를 다음과 같이 입력합니다.
   - **Address:** `127.0.0.1`
   - **Port:** `2222`
   - **Username:** 우분투 서버의 사용자 계정
   - **Password:** 우분투 서버의 비밀번호
4. 설정을 저장하고 연결 버튼을 더블 클릭하면 접속이 완료됩니다.

---
**💡 팁:** 이후부터는 Mac 부팅 시마다 가상의 2222 포트가 자동으로 열리므로, 별도의 스크립트 실행 없이 Termius만 켜서 바로 접속하시면 됩니다.


---

# 📄 `docs/custom_candle_chart_idea.md`

Timestamp: 2026-09-15 12:04:29

**User**:
캔들 차트를 만들고 싶어 음봉 양봉이 아이콘으로 존재하고 클릭해서 드래그 해서 캔들이 그려지는 지점에 놓으면 내가 원하는 사이즈를 가지는 봉을 그리고 싶어 모통의 길이도 조절가능하고 아래 꼬리 윗꼬리도 조절해서 그릴수있는 방법이 있을까 이유는 특정 패턴을 그리고 싶어서야

**Gemini**:
웹 캔버스 라이브러리(Konva.js 또는 Fabric.js)를 사용해 커스텀 캔들 드로잉 에디터를 구축하는 방식이 가장 적합합니다. 캔들의 구성 요소(윗꼬리, 몸통, 아래꼬리)를 4개의 제어점(High, Upper Body, Lower Body, Low)으로 추상화하면 직관적인 드래그 및 리사이징 인터페이스를 구현할 수 있습니다.

---

### 1. 캔들 데이터 모델 설계

캔들 1개는 X축 좌표와 4개의 Y축 좌표(가격/픽셀 레벨), 그리고 양봉/음봉 타입을 가집니다.

```typescript
interface CandleNode {
  id: string;
  type: 'bull' | 'bear'; // 양봉(Red/Green), 음봉(Blue/Red)
  x: number;             // 캔들의 X 위치 (시간 축)
  highY: number;         // 윗꼬리 고점 (High)
  bodyTopY: number;      // 몸통 상단 (Open 또는 Close)
  bodyBottomY: number;   // 몸통 하단 (Close 또는 Open)
  lowY: number;          // 아래꼬리 저점 (Low)
  width: number;         // 몸통 너비 (기본값: 20px)
}
```

*   **양봉(Bull)**: `bodyTopY` = 종가(Close), `bodyBottomY` = 시가(Open)
*   **음봉(Bear)**: `bodyTopY` = 시가(Open), `bodyBottomY` = 종가(Close)
*   **제약 조건**: `highY <= bodyTopY <= bodyBottomY <= lowY` (화면 좌표계 기준, Y값이 아래로 갈수록 증가)

---

### 2. 제어 인터랙션 구성

각 캔들을 렌더링할 때 4개의 조절 핸들(앵커 포인트)을 결합합니다.

*   **팔레트 드래그 & 드롭**: 툴바의 양봉/음봉 아이콘을 캔버스 위로 드래그하여 놓으면(Drop), 해당 마우스 좌표에 기본 크기(몸통 40px, 위/아래 꼬리 15px)의 새 캔들이 인스턴스화됩니다.
*   **전체 이동 핸들**: 몸통 클릭 후 드래그 시 캔들 전체의 (x, y) 이동.
*   **윗꼬리 조절**: 최상단 앵커를 Y축 드래그 -> `highY` 갱신 (`bodyTopY` 위로만 이동 가능).
*   **몸통 상단 조절**: 상단 변 핸들을 드래그 -> `bodyTopY` 갱신 (윗꼬리와 몸통 길이 동시 반응).
*   **몸통 하단 조절**: 하단 변 핸들을 드래그 -> `bodyBottomY` 갱신.
*   **아래꼬리 조절**: 최하단 앵커를 Y축 드래그 -> `lowY` 갱신 (`bodyBottomY` 아래로만 이동 가능).

---

### 3. 추천 기술 스택 및 라이브러리

*   **React + react-konva (가장 권장)**
    HTML5 Canvas 기반으로 렌더링 성능이 뛰어나며, `<Line/>`, `<Rect/>`, `<Transformer/>` 컴포넌트를 통해 꼬리와 몸통의 개별 앵커 바인딩이 매우 간단합니다.
*   **HTML5 Canvas Native / PixiJS**
    외부 프레임워크 없이 단일 HTML 파일로 빠르게 프로토타이핑할 때 적합합니다.
*   **SVG 기반 (D3.js / SVG.js)**
    DOM 이벤트(onClick, onDrag)를 각 꼬리와 몸통 SVG 요소에 직접 걸 수 있어 정밀 제어가 편리합니다.

---

### 4. React-Konva 기반 최소 구현 예시

```tsx
import React, { useState } from 'react';
import { Stage, Layer, Rect, Line, Circle, Group } from 'react-konva';

export default function CandleEditor() {
  const [candles, setCandles] = useState([
    { id: '1', type: 'bull', x: 150, highY: 100, bodyTopY: 130, bodyBottomY: 180, lowY: 220, width: 24 }
  ]);

  // 앵커 드래그 시 Y값 제약 및 갱신
  const handleAnchorDrag = (id, key, newY) => {
    setCandles(prev => prev.map(c => {
      if (c.id !== id) return c;
      return { ...c, [key]: newY };
    }));
  };

  return (
    <div style={{ display: 'flex' }}>
      {/* 툴바 팔레트 */}
      <div style={{ width: 120, padding: 10, borderRight: '1px solid #ccc' }}>
        <button onClick={() => {
          const newCandle = {
            id: Date.now().toString(),
            type: 'bull',
            x: 250,
            highY: 120,
            bodyTopY: 150,
            bodyBottomY: 200,
            lowY: 230,
            width: 24
          };
          setCandles([...candles, newCandle]);
        }}>+ 양봉 추가</button>
      </div>

      {/* 차트 캔버스 */}
      <Stage width={800} height={500} style={{ background: '#131722' }}>
        <Layer>
          {candles.map(c => {
            const color = c.type === 'bull' ? '#f23645' : '#089981';
            return (
              <Group key={c.id} x={c.x} draggable onDragEnd={(e) => {
                const newX = e.target.x();
                setCandles(prev => prev.map(item => item.id === c.id ? { ...item, x: newX } : item));
              }}>
                {/* 꼬리 (심지) */}
                <Line points={[0, c.highY, 0, c.lowY]} stroke={color} strokeWidth={2} />

                {/* 몸통 */}
                <Rect
                  x={-c.width / 2}
                  y={c.bodyTopY}
                  width={c.width}
                  height={c.bodyBottomY - c.bodyTopY}
                  fill={color}
                />

                {/* 조절 핸들 (High, BodyTop, BodyBottom, Low) */}
                <Circle x={0} y={c.highY} radius={4} fill="#fff" draggable
                  dragBoundFunc={(pos) => ({ x: c.x, y: Math.min(pos.y, c.bodyTopY) })}
                  onDragMove={(e) => handleAnchorDrag(c.id, 'highY', e.target.y())}
                />
                <Circle x={0} y={c.lowY} radius={4} fill="#fff" draggable
                  dragBoundFunc={(pos) => ({ x: c.x, y: Math.max(pos.y, c.bodyBottomY) })}
                  onDragMove={(e) => handleAnchorDrag(c.id, 'lowY', e.target.y())}
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
```

---

### 5. 대안 도구 비교

*   **직접 구축 (React-Konva/Fabric)**: 캔들의 OHLC 수치 변환, 관통선(이동평균선)과의 교차 시뮬레이션 등 알고리즘 패턴 분석용 데이터를 JSON으로 바로 추출할 수 있어 가장 추천됩니다.
*   **Figma / Adobe XD**: 컴포넌트 변형(Variant) 기능을 사용해 위/아래 크기를 직접 조절할 수 있으나, 차트 격자(Grid) 스냅핑 및 데이터 수치화가 번거롭습니다.
*   **TradingView Pine Script**: 실제 주가 차트 위에 코드로 캔들을 그릴 수는 있지만, 마우스 드래그 앤 드롭으로 봉을 늘리거나 배치하는 인터랙티브 조작은 불가능합니다.

---

Timestamp: 2026-09-15 12:13:24

**User**:
갠들은 여러개를 그릴수 있고 갠틀은 일정한 간격으로 배치된다.

**Gemini**:
캔들이 시간 순서대로 일정한 간격(Slot)을 유지하도록 만들려면, **캔버스 X축을 고정된 그리드 슬롯(`step = candleWidth + gap`)으로 분할하고 드롭 시 가장 가까운 슬롯으로 스냅(Snap)**되도록 구현해야 합니다.

이 구조를 적용하면 여러 개의 봉을 연달아 배치해도 간격이 일정하게 유지되며, 연속된 패턴(2~3봉 반전, 횡보 후 관통 등)을 실제 차트와 동일한 비율로 구성할 수 있습니다.

---

### 1. 그리드 스냅 및 다중 캔들 데이터 구조

*   **슬롯 간격 공식**: `step = 캔들 너비(w) + 캔들 사이 여백(gap)`
*   **스냅 좌표 계산**: `slotIndex = max(0, floor((x - offsetX) / step + 0.5))`, `x_snapped = offsetX + slotIndex * step`

```typescript
interface CandleItem {
  id: string;
  slotIndex: number;     // 0, 1, 2... (시간 순서)
  type: 'bull' | 'bear'; // 양봉 / 음봉
  highY: number;         // 윗꼬리 끝
  bodyTopY: number;      // 몸통 상단
  bodyBottomY: number;   // 몸통 하단
  lowY: number;          // 아래꼬리 끝
}
```

---

### 2. React-Konva 다중 캔들 정렬 구현 예시

```tsx
import React, { useState } from 'react';
import { Stage, Layer, Rect, Line, Circle, Group } from 'react-konva';

const CANDLE_WIDTH = 24;
const CANDLE_GAP = 16;
const STEP = CANDLE_WIDTH + CANDLE_GAP; // 봉 간격: 40px
const START_X = 50;                     // 차트 좌측 여백

export default function MultiCandleChart() {
  const [candles, setCandles] = useState<any[]>([]);

  // 특정 슬롯 인덱스의 실제 화면 X 좌표 계산
  const getSlotX = (index: number) => START_X + index * STEP;

  // 1. 팔레트에서 새 캔들 추가 (우측 끝 슬롯에 순차 배치 또는 지정 슬롯)
  const addCandle = (type: 'bull' | 'bear') => {
    const nextSlot = candles.length > 0 
      ? Math.max(...candles.map(c => c.slotIndex)) + 1 
      : 0;

    const baseTop = type === 'bull' ? 150 : 130;
    const baseBottom = type === 'bull' ? 200 : 180;

    const newCandle = {
      id: `candle-${Date.now()}`,
      slotIndex: nextSlot,
      type,
      highY: baseTop - 30,
      bodyTopY: baseTop,
      bodyBottomY: baseBottom,
      lowY: baseBottom + 30,
    };
    setCandles(prev => [...prev, newCandle]);
  };

  // 2. 캔들 X축 드래그 종료 시 가장 가까운 슬롯으로 자동 스냅
  const handleDragEnd = (id: string, droppedX: number) => {
    const targetSlot = Math.max(0, Math.round((droppedX - START_X) / STEP));
    setCandles(prev => prev.map(c => c.id === id ? { ...c, slotIndex: targetSlot } : c));
  };

  // 3. 꼬리/몸통 높이 조절
  const updateY = (id: string, key: string, val: number) => {
    setCandles(prev => prev.map(c => c.id === id ? { ...c, [key]: val } : c));
  };

  return (
    <div style={{ display: 'flex', background: '#1e222d', color: '#fff', minHeight: '520px' }}>
      {/* 툴바 */}
      <div style={{ width: 140, padding: 16, borderRight: '1px solid #2a2e39' }}>
        <button 
          style={{ width: '100%', marginBottom: 8, padding: 8, background: '#f23645', color: '#fff', border: 'none' }}
          onClick={() => addCandle('bull')}
        >
          + 양봉 추가
        </button>
        <button 
          style={{ width: '100%', padding: 8, background: '#089981', color: '#fff', border: 'none' }}
          onClick={() => addCandle('bear')}
        >
          + 음봉 추가
        </button>
        <div style={{ marginTop: 20, fontSize: 12, color: '#787b86' }}>
          총 {candles.length}개 봉 배치됨
        </div>
      </div>

      {/* 차트 캔버스 */}
      <Stage width={800} height={500}>
        <Layer>
          {candles.map((c) => {
            const posX = getSlotX(c.slotIndex);
            const color = c.type === 'bull' ? '#f23645' : '#089981';

            return (
              <Group
                key={c.id}
                x={posX}
                draggable
                // 드래그 중에는 Y축은 고정하고 X축만 이동 가능
                dragBoundFunc={(pos) => ({ x: pos.x, y: 0 })}
                onDragEnd={(e) => handleDragEnd(c.id, e.target.x())}
              >
                {/* 꼬리선 (High - Low) */}
                <Line points={[0, c.highY, 0, c.lowY]} stroke={color} strokeWidth={2} />

                {/* 몸통 (Body) */}
                <Rect
                  x={-CANDLE_WIDTH / 2}
                  y={c.bodyTopY}
                  width={CANDLE_WIDTH}
                  height={c.bodyBottomY - c.bodyTopY}
                  fill={color}
                />

                {/* 윗꼬리 조절점 */}
                <Circle
                  x={0}
                  y={c.highY}
                  radius={4}
                  fill="#ffffff"
                  draggable
                  dragBoundFunc={(pos) => ({ x: posX, y: Math.min(pos.y, c.bodyTopY) })}
                  onDragMove={(e) => updateY(c.id, 'highY', e.target.y())}
                />

                {/* 아래꼬리 조절점 */}
                <Circle
                  x={0}
                  y={c.lowY}
                  radius={4}
                  fill="#ffffff"
                  draggable
                  dragBoundFunc={(pos) => ({ x: posX, y: Math.max(pos.y, c.bodyBottomY) })}
                  onDragMove={(e) => updateY(c.id, 'lowY', e.target.y())}
                />

                {/* 몸통 상단 조절점 */}
                <Circle
                  x={0}
                  y={c.bodyTopY}
                  radius={4}
                  fill="#fbc02d"
                  draggable
                  dragBoundFunc={(pos) => ({ x: posX, y: Math.min(Math.max(pos.y, c.highY), c.bodyBottomY - 5) })}
                  onDragMove={(e) => updateY(c.id, 'bodyTopY', e.target.y())}
                />

                {/* 몸통 하단 조절점 */}
                <Circle
                  x={0}
                  y={c.bodyBottomY}
                  radius={4}
                  fill="#fbc02d"
                  draggable
                  dragBoundFunc={(pos) => ({ x: posX, y: Math.max(pos.y, c.bodyTopY + 5) })}
                  onDragMove={(e) => updateY(c.id, 'bodyBottomY', e.target.y())}
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
```

---

### 3. 핵심 동작 방식

*   **수평 그리드 잠금**: `dragBoundFunc={(pos) => ({ x: pos.x, y: 0 })}`를 지정하여 개별 캔들을 좌우로 옮길 때 세로 가격 위치가 임의로 어긋나지 않습니다.
*   **충돌 및 순서 재배치**: 동일 슬롯 인덱스에 두 캔들이 겹치는 경우, 기존 봉들을 우측으로 한 칸씩 밀어내는(`slotIndex >= targetSlot ? slotIndex + 1 : slotIndex`) 시퀀스 삽입 로직을 추가해 캔들 순서를 항상 단조 증가 형태로 유지할 수 있습니다.
*   **패턴 데이터 내보내기**: 완성된 다중 캔들 배열을 `slotIndex` 기준으로 정렬한 뒤, 각 Y좌표를 기준점 대비 가격(OHLC)으로 정규화하면 백테스팅 엔진이나 조건식 매칭에 즉시 활용할 수 있습니다.

---

Timestamp: 2026-09-15 12:14:58

**User**:
슬롯으로 스냅한다라는 의미는?

**Gemini**:
**"슬롯으로 스냅(Snap)한다"**는 것은 사용자가 캔들을 화면 아무 곳에나 마우스로 떨어뜨려도, 차트 시스템이 미리 정해둔 일정한 간격의 칸(Slot, 슬롯)에 자석처럼 '착' 달라붙게 강제 정렬시키는 동작을 말합니다.
PPT나 포토샵에서 도형을 움직일 때 눈금자나 안내선 근처로 가면 딱 맞춰서 붙는 '스냅(자석 효과)' 기능과 동일한 원리입니다.

---

### 1. 왜 스냅 처리가 필요한가?

*   **균일한 캔들 간격 보장**: 마우스로 드래그 앤 드롭을 하면 손 떨림이나 마우스 좌표 오차 때문에 봉과 봉 사이 간격이 삐뚤빼뚤해집니다.
*   **시간 축(Grid) 규격화**: 실제 주식 차트는 시간 흐름에 따라 1봉, 2봉, 3봉이 일정한 보폭으로 나열됩니다. 스냅을 걸어두면 사용자가 대충 드롭해도 컴퓨터가 알아서 일정한 폭으로 정렬해 줍니다.
*   **정확한 패턴 분석**: 캔들 간격이 일정해야 2개 이상의 봉이 이루는 패턴(장악형, 잉태형, 관통선 등)을 시각적 왜곡 없이 파악할 수 있습니다.

---

### 2. 계산 동작 원리

화면의 X축을 **"슬롯(Slot)"**이라는 가상의 칸 번호(0, 1, 2, 3...)로 나눕니다.

*   **간격 설정**: 캔들 너비(예: 24px) + 봉 사이 여백(예: 16px) = 한 칸(Step)당 40px
*   **드롭 좌표 감지**: 마우스를 놓은 실제 X 좌표가 `113px`라고 가정합니다.
*   **가장 가까운 슬롯 번호 계산**: `Slot 번호 = round(113 / 40) = round(2.825) -> 3번 슬롯`
*   **위치 강제 이동(스냅)**: `X_최종 = 3 * 40 = 120px`

사용자는 `113px` 위치에 대충 마우스를 놓았지만, 시스템이 이를 즉시 `120px` 칸에 맞춰 고정시키는 과정이 바로 **"슬롯으로 스냅된다"**는 의미입니다.

---

Timestamp: 2026-09-15 12:17:59

**User**:
그럽 y축도 높이를 조절할때 스냅을 사용할수 있을까?

**Gemini**:
Y축(가격 축)에도 스냅을 완벽하게 적용할 수 있습니다.
차트 에디터에서 Y축 스냅은 특정 패턴을 정확한 비율이나 수치로 정의할 때 필수적인 기능입니다. 구현 목적에 따라 크게 3가지 스냅 방식 중 하나를 선택할 수 있습니다.

---

### 1. Y축 스냅의 3가지 방식

*   **그리드/눈금 단위 스냅 (Grid Snap)**
    화면의 일정 픽셀(예: 5px, 10px) 단위로 자석처럼 붙게 만듭니다.
    수식: `Y_snap = round(Y / gridSize) * gridSize`
    손떨림으로 인해 높이가 1~2px씩 미세하게 어긋나는 현상을 방지합니다.
*   **호가/가격 단위 스냅 (Price/Tick Snap)**
    픽셀을 주식 호가 단위(예: 50원, 100원, 500원)에 스냅합니다.
    실제 주가 단위에 맞게 정형화된 패턴 데이터를 생성할 때 사용합니다.
*   **이전 캔들 기준 스냅 (Object/Level Snap)**
    패턴을 그릴 때 가장 유용한 방식입니다.
    바로 앞 봉의 고점(High), 저점(Low), 시가/종가(Body) 또는 직전 고점 매물대/지지·저항선 근처(예: ±4px 이내)로 드래그하면 정확히 같은 수평선에 딱 달라붙게 만듭니다.
    활용 예: 전일 종가와 동일한 시가(보합 출발), 쌍바닥(동일 Low), 장악형 패턴(전일 몸통을 정확히 감싸는 높이)

---

### 2. Y축 스냅 계산 함수 예시

단순 그리드(예: 10px 단위)와 주변 캔들의 주요 가격대를 함께 고려하는 스냅 함수입니다.

```typescript
interface SnapTargets {
  gridSize?: number;      // 기본 그리드 단위 (예: 10px)
  threshold?: number;     // 자석 효과가 발동할 감지 거리 (예: 5px)
  referenceYList?: number[]; // 직전 캔들의 High, Low, BodyTop, BodyBottom 등
}

export function snapY(currentY: number, options: SnapTargets = {}): number {
  const { gridSize = 10, threshold = 6, referenceYList = [] } = options;

  // 1. 직전 캔들의 주요 수평 레벨(전고점, 전저점 등) 근처에 있는지 우선 검사
  for (const refY of referenceYList) {
    if (Math.abs(currentY - refY) <= threshold) {
      return refY; // 주변 기준선으로 즉시 스냅
    }
  }

  // 2. 일치하는 기준선이 없으면 일반 눈금(Grid) 단위로 스냅
  return Math.round(currentY / gridSize) * gridSize;
}
```

---

### 3. Konva 조절점에 Y축 스냅 적용

조절 핸들을 드래그할 때 `dragBoundFunc` 또는 `onDragMove`에서 Y값을 스냅 함수로 보정합니다.

```tsx
<Circle
  x={0}
  y={c.bodyTopY}
  radius={5}
  fill="#fbc02d"
  draggable
  dragBoundFunc={(pos) => {
    // 10px 그리드로 스냅 적용
    const snappedY = Math.round(pos.y / 10) * 10;

    // 물리적 제약 조건 (윗꼬리보다는 아래, 몸통 하단보다는 위에 위치)
    const clampedY = Math.min(Math.max(snappedY, c.highY), c.bodyBottomY - 10);

    return {
      x: posX,     // X축은 해당 슬롯에 고정
      y: clampedY  // Y축은 스냅된 좌표 적용
    };
  }}
  onDragMove={(e) => updateY(c.id, 'bodyTopY', e.target.y())}
/>
```

X축은 **시간 슬롯(Slot)**에 고정되고 Y축은 **눈금 및 직전 봉의 가격 레벨**에 스냅되므로, 마우스로 대충 드래그해도 깔끔하고 정밀한 캔들 차트 패턴이 완성됩니다.

---

Timestamp: 2026-09-15 12:19:24

**User**:
Next.js react에서 tailwund를 사용하고 있어 가능한가?

**Gemini**:
Next.js + React + Tailwind CSS 환경에서 완벽하게 구현할 수 있습니다.
차트의 껍데기(사이드바, 캔들 팔레트, 제어 툴바, 패널)는 Tailwind CSS로 구성하고, 캔들이 그려지는 캔버스 영역은 SVG 컴포넌트 또는 Konva.js를 연결하면 됩니다.

---

### Next.js 개발 시 핵심 주의사항

Next.js(App Router 기준)는 서버 사이드 렌더링(SSR)을 기본으로 동작하므로 다음 두 가지를 처리해야 합니다.

*   **'use client' 선언**: 드래그 앤 드롭, 마우스 이벤트, 로컬 상태(useState)가 들어가므로 파일 최상단에 반드시 `'use client'`를 선언합니다.
*   **렌더링 방식 선택**:
    *   **SVG 방식 (권장)**: 브라우저 API 의존성이 없어 SSR 하이드레이션 오류가 없고, Tailwind 클래스(`fill-red-500`, `stroke-emerald-500`, `hover:scale-125`)를 캔들 구성 요소에 직접 적용할 수 있습니다.
    *   **Canvas/Konva 방식**: 캔버스 그래픽 라이브러리를 사용할 경우 `next/dynamic`의 `{ ssr: false }` 옵션으로 감싸서 로드해야 `window is not defined` 에러를 피할 수 있습니다.

---

### Next.js + Tailwind + SVG 캔들 에디터 구현 예시

외부 Canvas 라이브러리 설치 없이 Next.js와 Tailwind만으로 바로 동작하는 풀 코드입니다.

```tsx
'use client';

import React, { useState, useRef } from 'react';

interface Candle {
  id: string;
  slot: number;
  type: 'bull' | 'bear';
  highY: number;
  bodyTopY: number;
  bodyBottomY: number;
  lowY: number;
}

const CANDLE_WIDTH = 28;
const SLOT_WIDTH = 48; // 봉과 봉 사이 간격 포함 (X축 슬롯 단위)
const START_X = 60;
const GRID_Y_STEP = 10; // Y축 스냅 단위 (10px)

export default function CandleEditor() {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [activeDrag, setActiveDrag] = useState<{ id: string; key: keyof Candle } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 새 캔들 추가 (빈 다음 슬롯에 자동 배치)
  const addCandle = (type: 'bull' | 'bear') => {
    const nextSlot = candles.length > 0 ? Math.max(...candles.map((c) => c.slot)) + 1 : 0;
    const baseTop = type === 'bull' ? 140 : 100;
    const baseBottom = type === 'bull' ? 200 : 160;

    setCandles((prev) => [
      ...prev,
      {
        id: `candle-${Date.now()}`,
        slot: nextSlot,
        type,
        highY: baseTop - 30,
        bodyTopY: baseTop,
        bodyBottomY: baseBottom,
        lowY: baseBottom + 30,
      },
    ]);
  };

  // 마우스 이동 시 Y축 스냅 반영
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!activeDrag || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const rawY = e.clientY - rect.top;
    // 10px 단위 스냅
    const snappedY = Math.round(rawY / GRID_Y_STEP) * GRID_Y_STEP;

    setCandles((prev) =>
      prev.map((c) => {
        if (c.id !== activeDrag.id) return c;
        const key = activeDrag.key;

        // 물리적 제약 조건 검증
        if (key === 'highY') return { ...c, highY: Math.min(snappedY, c.bodyTopY) };
        if (key === 'bodyTopY') return { ...c, bodyTopY: Math.min(Math.max(snappedY, c.highY), c.bodyBottomY - 10) };
        if (key === 'bodyBottomY') return { ...c, bodyBottomY: Math.max(Math.min(snappedY, c.lowY), c.bodyTopY + 10) };
        if (key === 'lowY') return { ...c, lowY: Math.max(snappedY, c.bodyBottomY) };

        return c;
      })
    );
  };

  const stopDrag = () => setActiveDrag(null);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 select-none">
      {/* 툴바 / 팔레트 */}
      <aside className="w-52 border-r border-slate-800 p-4 flex flex-col gap-3 bg-slate-900/50">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">캔들 팔레트</h2>
        
        <button
          onClick={() => addCandle('bull')}
          className="flex items-center justify-center gap-2 py-2 px-3 bg-rose-600 hover:bg-rose-500 rounded font-medium text-sm transition-colors shadow-sm"
        >
          <span className="w-3 h-4 bg-white rounded-xs inline-block" />
          + 양봉 추가
        </button>

        <button
          onClick={() => addCandle('bear')}
          className="flex items-center justify-center gap-2 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 rounded font-medium text-sm transition-colors shadow-sm"
        >
          <span className="w-3 h-4 bg-white rounded-xs inline-block" />
          + 음봉 추가
        </button>

        <div className="mt-auto border-t border-slate-800 pt-3 text-xs text-slate-500">
          <p>• 드래그 핸들로 꼬리/몸통 조절</p>
          <p>• 10px 그리드 단위 스냅 적용</p>
        </div>
      </aside>

      {/* 차트 영역 */}
      <main className="flex-1 p-6 overflow-x-auto" onMouseUp={stopDrag} onMouseLeave={stopDrag}>
        <div className="relative border border-slate-800 rounded-lg bg-slate-900 shadow-inner overflow-hidden w-[900px] h-[520px]">
          <svg
            ref={svgRef}
            className="w-full h-full cursor-crosshair"
            onMouseMove={handleMouseMove}
          >
            {/* 배경 수평 눈금선 */}
            {Array.from({ length: 25 }).map((_, i) => (
              <line
                key={i}
                x1={0}
                y1={i * 20}
                x2={900}
                y2={i * 20}
                stroke="#1e293b"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
            ))}

            {/* 캔들 렌더링 */}
            {candles.map((c) => {
              const x = START_X + c.slot * SLOT_WIDTH;
              const isBull = c.type === 'bull';
              const colorClass = isBull ? 'fill-rose-500 stroke-rose-500' : 'fill-emerald-500 stroke-emerald-500';

              return (
                <g key={c.id}>
                  {/* 꼬리 (High to Low) */}
                  <line
                    x1={x}
                    y1={c.highY}
                    x2={x}
                    y2={c.lowY}
                    className={colorClass}
                    strokeWidth={2}
                  />

                  {/* 몸통 (Body) */}
                  <rect
                    x={x - CANDLE_WIDTH / 2}
                    y={c.bodyTopY}
                    width={CANDLE_WIDTH}
                    height={Math.max(1, c.bodyBottomY - c.bodyTopY)}
                    className={`${colorClass} transition-opacity hover:opacity-90`}
                  />

                  {/* 윗꼬리 조절 핸들 */}
                  <circle
                    cx={x}
                    cy={c.highY}
                    r={4}
                    className="fill-white hover:scale-150 cursor-ns-resize transition-transform"
                    onMouseDown={() => setActiveDrag({ id: c.id, key: 'highY' })}
                  />

                  {/* 몸통 상단 조절 핸들 */}
                  <circle
                    cx={x}
                    cy={c.bodyTopY}
                    r={4}
                    className="fill-amber-400 hover:scale-150 cursor-ns-resize transition-transform"
                    onMouseDown={() => setActiveDrag({ id: c.id, key: 'bodyTopY' })}
                  />

                  {/* 몸통 하단 조절 핸들 */}
                  <circle
                    cx={x}
                    cy={c.bodyBottomY}
                    r={4}
                    className="fill-amber-400 hover:scale-150 cursor-ns-resize transition-transform"
                    onMouseDown={() => setActiveDrag({ id: c.id, key: 'bodyBottomY' })}
                  />

                  {/* 아래꼬리 조절 핸들 */}
                  <circle
                    cx={x}
                    cy={c.lowY}
                    r={4}
                    className="fill-white hover:scale-150 cursor-ns-resize transition-transform"
                    onMouseDown={() => setActiveDrag({ id: c.id, key: 'lowY' })}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </main>
    </div>
  );
}
```

이 방식을 쓰면 추가 라이브러리 설치 없이 Next.js 기본 스택과 Tailwind 유틸리티 클래스만으로 반응형 인터랙티브 차트 에디터를 즉시 구축할 수 있습니다.

---

Timestamp: 2026-09-15 12:20:30

**User**:
3중 추세선을 그리고 싶어 이걸 그릴때 사용하는 용어를 잘모르겠어

**Gemini**:
차트 분석과 트레이딩 도구에서 **'3중 추세선'**을 다룰 때 상황에 따라 주로 쓰이는 표준 용어는 크게 **3가지 맥락(패턴 분석, 채널 도구, 시스템 지표)**으로 나뉩니다.

---

### 1. 추세 채널 형태 (상단·중심·하단 3개 평행선)

가장 대중적으로 사용되는 3중선 도구(Trend Channel 또는 Andrews' Pitchfork)에서 쓰이는 용어입니다.

*   **상단 저항선 (Upper Channel Line / Resistance Line)**
    상승 파동의 고점(Peak)들을 연결한 상단선으로, 단기 차익 실현이나 매도 압력이 발생하는 구간입니다.
*   **중심선 / 중간선 (Median Line / Midline / 파동 중심선)**
    상단과 하단의 정확히 50% 지점을 가로지르는 균형선입니다. 주가가 이 중심선 위에 머무는지, 아래로 이탈하는지에 따라 단기 매수·매도 우위가 결정되는 핵심 기준선 역할을 합니다.
*   **하단 지지선 (Lower Channel Line / Support Line)**
    파동의 저점(Trough)들을 연결한 바닥선으로, 대기 매수세가 유입되며 주가를 떠받치는 동적 지지선입니다.
*   **채널 폭 / 이격 (Channel Width / Bandwidth)**
    중심선에서 상·하단선까지 떨어진 간격(거리)을 의미합니다.

---

### 2. 부채꼴 원리 (Fan Principle / 1·2·3차 가속 추세선)

고전 기술적 분석(존 머피의 팬 원리)에서 기울기가 다른 3개의 추세선을 단계별로 그을 때 사용하는 용어입니다.

*   **기본 추세선 (Primary Trendline / 1차선)**
    추세가 시작될 때 가장 완만하고 지속 가능한 각도(약 45도 안팎)로 형성되는 뼈대 추세선입니다.
*   **가속 추세선 (Accelerated Trendline / 2차선)**
    시장에 모멘텀이 붙으면서 주가가 더 가파른 각도로 꺾여 올라갈 때 긋는 두 번째 추세선입니다.
*   **오버슈팅 추세선 (Exhaustion / Terminal Trendline / 3차선)**
    과열(슈팅) 상태에서 일시적으로 수직에 가깝게 치솟는 마지막 추세선입니다.

관련 핵심 용어:
*   **변곡점 (Inflection Point / Pivot)**: 추세선의 기울기가 급변하거나 선과 맞닿아 방향이 바뀌는 지점입니다.
*   **극성 전환 (Role Reversal)**: 상단 추세선을 돌파하면 저항선이 지지선으로, 하단선이 무너지면 지지선이 저항선으로 바뀌는 현상입니다.
*   **3번의 법칙 (Touch & Confirmation)**: 추세선은 최소 3번째 터치에서 튕겨 나가야 공식적으로 검증된 선으로 인정합니다.

---

### 3. 시스템 트레이딩 및 지표 기반 (동적 3중선)

수평 매물대나 이동평균·볼린저 밴드 기반으로 3개 선을 정의할 때의 실전 용어입니다.

*   **저항 밴드 / 상단선 (Upper Band)**: 볼린저 밴드 상단선이나 전고점 매물대 영역입니다.
*   **파동 중심선 (Wave Center / 20일 이동평균선)**: 매매 방향을 결정하는 절대 지도 기준선(20선 위는 상승 영역, 아래는 하락 영역)입니다.
*   **지지 밴드 / 하단선 (Lower Band)**: 볼린저 밴드 하단선이나 투매·반대매매 물량을 받아내는 바닥선 영역입니다.

---

### 4. 차트 에디터 UI/개발용 추천 명칭

만약 차트 에디터에 3중 추세선 그리기 기능을 추가하신다면, 변수명과 UI 라벨로 아래 표현을 권장합니다.

| 분류 | 영문 UI / 코드 변수명 | 한글 라벨 | 설명 |
| :--- | :--- | :--- | :--- |
| 기준점 | Anchor Point (P1, P2) | 제어점 / 앵커 | 선의 시작과 끝을 잡는 드래그 핸들 |
| 선 1 | upperLine | 상단 저항선 | 고점 스냅 연결선 |
| 선 2 | midLine / centerLine | 중심선 (미디언) | 두 선의 중심 혹은 파동 중심선 |
| 선 3 | lowerLine | 하단 지지선 | 저점 스냅 연결선 |
| 설정 | channelWidth / offset | 채널 폭 (오프셋) | 중심선 기준 상·하단 간격 픽셀 |

---

Timestamp: 2026-09-15 12:23:52

**User**:
첫번째 추세선을 그리고 두번째 추세선을 그리면 중심선은 자동으로 그려지나?

**Gemini**:
일반적인 차트 도구(TradingView, HTS 등)와 직접 구축하는 에디터 모두 **두 추세선(상단선과 하단선)의 위치가 결정되면 중심선은 50% 지점을 계산해 자동으로 렌더링**되도록 설계하는 것이 표준입니다.

사용자가 3개의 선을 일일이 손으로 긋게 만들면 중심이 어긋나 기준선으로서의 신뢰도가 떨어지기 때문입니다.

---

### 중심선 자동 계산 원리

두 추세선의 시작점과 끝점 좌표가 주어지면, 동일한 X 좌표에서의 Y축 중점(Midpoint)을 계산하여 연결합니다.

*   **시작점 중점**: `Y_mid_start = (Y_upper_start + Y_lower_start) / 2`
*   **끝점 중점**: `Y_mid_end = (Y_upper_end + Y_lower_end) / 2`

두 선의 기울기가 서로 달라도(수렴형 삼각수렴 또는 확산형 패턴) 각 X 위치에서의 평균값을 잇기만 하면 정확한 중심 파동선이 완성됩니다.

---

### 차트 도구별 2가지 구현 방식

1.  **평행 채널 방식 (Parallel Channel)**
    *   **입력 방식**: 1번 선(점 2개로 추세선 설정) -> 마우스를 벌려 2번 선(채널 폭 설정) 클릭
    *   **특징**: 두 선의 기울기가 100% 동일하며, 중심선도 같은 각도로 가운데 자동 생성됩니다.
2.  **독립 2선 채널 방식 (수렴/확산 채널)**
    *   **입력 방식**: 상단 고점 2개 연결(선 1) -> 하단 저점 2개 연결(선 2)
    *   **특징**: 삼각수렴처럼 위아래 기울기가 달라도 두 선의 사이 공간을 이등분하는 중심선이 자동으로 그어집니다.

---

### Next.js / SVG 에디터용 자동 계산 예시

상단선과 하단선 정보만 State로 관리하고, 중심선은 렌더링 단계에서 동적으로 계산해 그립니다.

```tsx
interface TrendLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// 상단선과 하단선 데이터가 있을 때 중심선 SVG 좌표 도출
export function TripleTrendChannel({ upper, lower }: { upper: TrendLine; lower: TrendLine }) {
  // 시작점과 끝점의 50% 중점 계산
  const midLine = {
    x1: (upper.x1 + lower.x1) / 2,
    y1: (upper.y1 + lower.y1) / 2,
    x2: (upper.x2 + lower.x2) / 2,
    y2: (upper.y2 + lower.y2) / 2,
  };

  return (
    <g>
      {/* 1. 상단 저항선 (실선) */}
      <line x1={upper.x1} y1={upper.y1} x2={upper.x2} y2={upper.y2} stroke="#f43f5e" strokeWidth={2} />
      
      {/* 2. 중심선 (자동 계산된 점선) */}
      <line 
        x1={midLine.x1} 
        y1={midLine.y1} 
        x2={midLine.x2} 
        y2={midLine.y2} 
        stroke="#eab308" 
        strokeWidth={1.5} 
        strokeDasharray="4 4" 
      />
      
      {/* 3. 하단 지지선 (실선) */}
      <line x1={lower.x1} y1={lower.y1} x2={lower.x2} y2={lower.y2} stroke="#10b981" strokeWidth={2} />
    </g>
  );
}
```

에디터 UI에서는 첫 번째 선 드래그 완료 후 두 번째 선 드래그가 끝나는 이벤트(`onMouseUp`) 시점에 중심선 레이어를 켜주는 인터랙션으로 구현하면 자연스럽습니다.

---

Timestamp: 2026-09-15 12:27:49

**User**:
첫번째 두번째 추세선의 각도?를 조절할수 있나 일반적으로 그려진 선을 드래그로 움지여 조절하는거 같은데 용어를 모르겠어

**Gemini**:
추세선의 각도(기울기)는 당연히 자유롭게 조절할 수 있습니다. 차트 툴이나 그래픽 에디터에서 선의 양 끝점을 잡고 마우스로 움직여 각도를 바꾸는 인터랙션과 관련된 용어는 다음과 같습니다.

---

### 1. UI/UX 및 개발 인터랙션 용어

화면에서 선을 클릭하고 드래그할 때 개발 및 디자인에서 사용하는 표준 용어입니다.

*   **앵커 포인트 / 제어점 (Anchor Point / Control Point)**
    선의 양쪽 끝에 생기는 작은 점(동그라미나 사각형)입니다. 마우스로 이 제어점을 잡고 위아래로 움직여 선의 각도와 길이를 조절합니다.
*   **끝점 드래그 (Endpoint Dragging)**
    선의 한쪽 끝점만 잡고 끌어당겨 **기울기(Slope)**를 바꾸는 가장 일반적인 인터랙션 방식입니다.
*   **피벗 회전 (Pivot Rotation)**
    시작점(P1)을 중심축(Pivot)으로 고정해 두고, 반대쪽 점(P2)을 컴퍼스처럼 돌려 선의 각도만 변경하는 방식입니다.
*   **선택 핸들 (Selection Handles / Bounding Handles)**
    선을 클릭했을 때 활성화되는 3개의 조절점(시작점, 중심점, 끝점)을 통칭합니다. 양 끝점 핸들은 각도·길이 조절, 가운데 핸들은 선 전체의 **평행 이동(Pan/Translate)**에 쓰입니다.

---

### 2. 차트 분석 및 트레이딩 도구(HTS/TradingView) 용어

트레이딩 뷰나 증권사 HTS 툴바에서 이 기능을 지칭할 때 사용하는 용어입니다.

*   **추세선 각도 / 기울기 조절 (Trend Angle / Slope)**
    선이 수평선 대비 몇 도(°) 기울어졌는지를 나타내는 물리적 각도입니다.
*   **변곡점 재지정 / 리앵커링 (Re-anchoring to Pivots)**
    새로운 고점이나 저점이 나왔을 때, 기존 추세선의 끝점을 드래그해 새로운 캔들의 꼬리나 몸통 변곡점(Pivot)에 다시 맞추는 행위입니다.
*   **추세선 연장 / 각도 고정 (Extend Line / Lock Angle)**
    각도는 그대로 유지한 채 선의 길이만 오른쪽 미래 시점으로 길게 늘리거나, 각도가 틀어지지 않게 고정하는 옵션입니다.

---

### 3. 드래그 조작 방식 구분

| 조작 대상 | 마우스 동작 | 결과 |
| :--- | :--- | :--- |
| 양 끝점 핸들 | 한쪽 앵커 클릭 후 상하/좌우 드래그 | 각도(기울기) 및 선 길이 동시 변경 |
| 선 자체 (몸통) | 선 중간을 클릭 후 드래그 | 각도 유지한 채 선 전체 위치 이동 |
| Shift + 드래그 | 키보드 Shift를 누른 채 끝점 이동 | 15° / 45° 등 정형화된 각도 단위 스냅 |

Next.js SVG 기반 에디터로 구축할 경우, 각 추세선의 `(x1, y1)`과 `(x2, y2)` 좌표 중 사용자가 마우스로 누른 핸들의 Y 좌표(`y1` 또는 `y2`)를 마우스 이동값에 맞춰 갱신해주면 각도 조절이 즉시 반영됩니다.


---

# 📄 `docs/db_access.md`

# DB 접속 가이드 (DataGrip / DBeaver / CLI)

로컬 개발 DB와 **개발서버(미니PC) DB**에 GUI 툴·CLI로 접속하는 방법. 개발서버 DB는 **LAN 전용**(Cloudflare 터널에 노출 금지)이라, 기존 cloudflared SSH 경로 위로 **SSH 터널**로만 붙는다.

> 관련: [`run_and_deploy.md`](./run_and_deploy.md)(로컬 실행·배포) · [`cloudflare_termius_guide.md`](./cloudflare_termius_guide.md)(cloudflared/Termius) · [`server_setup.md`](./server_setup.md)(서버 런북)

## 접속 값 (공통)
| DB | User | Password | Database | 포트 |
|---|---|---|---|---|
| PostgreSQL | `stock_user` | `stock_password` | `stock_db` | 5432 |
| ClickHouse | `default` | `password` | `stock_data` | 8123(HTTP) / 9000(Native) |

> 개발서버 DB 비번을 `compose.env`로 커스텀했다면 그 값. 안 했으면 위 기본값. 앱은 ClickHouse를 **HTTP 8123**(clickhouse_connect)으로 쓴다.

---

## A. 로컬 DB (docker-compose.dev.yml)

`docker compose -f docker-compose.dev.yml up -d` 로 DB가 떠 있으면, DataGrip에서 **직접** 접속:

- `+` → Data Source → **PostgreSQL**: Host `localhost` · Port `5432` · `stock_user`/`stock_password` · DB `stock_db`
- `+` → Data Source → **ClickHouse**(드라이버 0.6.3+ 자동 다운로드): Host `localhost` · Port `8123` · `default`/`password` · DB `stock_data`

---

## B. 개발서버(미니PC) DB — SSH 터널 필수

### 사전 조건
- cloudflared가 `127.0.0.1:2222`를 열고 있어야 함 — 확인: `nc -z 127.0.0.1 2222` (셋업은 `cloudflare_termius_guide.md`).
- SSH 계정 `kyuseok` + 서버 비밀번호(또는 등록한 SSH 키).

> **⚠️ Host는 `localhost`(5432/8123), 15432/18123 아님(방법 B-1 기준).**
> DataGrip 내장 SSH 터널에서 General 탭의 Host/Port는 **SSH 서버(미니PC) 입장**에서 해석된다. `localhost:5432` = 미니PC의 도커 PG. 15432/18123은 셸 스크립트(방법 B-2)를 켰을 때만 쓰는 로컬 포트.

### B-1. DataGrip 내장 SSH 터널 (권장 — 스크립트 불필요)

**PostgreSQL**
1. `+` → Data Source → **PostgreSQL**
2. **General 탭**: Host `localhost` · Port `5432` · User `stock_user` · Password `stock_password` · Database `stock_db`
3. **SSH/SSL 탭**: ☑ Use SSH tunnel → SSH configuration `...` 로 새로 추가
   - Host `127.0.0.1` · Port `2222` · User name `kyuseok`
   - Authentication type **Password** → 서버 비밀번호(☑ Save password) — *SSH 키 등록 시 Key pair + 개인키 경로*
4. **Test Connection** → 최초 "host key is not known" 팝업은 Accept, 드라이버 없으면 Download → 초록 체크면 OK

**ClickHouse**
1. `+` → Data Source → **ClickHouse** (드라이버 Download)
2. **General 탭**: Host `localhost` · Port `8123` · User `default` · Password `password` · Database `stock_data`
3. **SSH/SSL 탭**: ☑ Use SSH tunnel → **B-1의 SSH 설정 재사용**(127.0.0.1:2222 / kyuseok)
4. **Test Connection** → OK

### B-2. 셸 스크립트 터널 (대안)
```bash
./scripts/dev-db-tunnel.sh    # 별도 터미널 유지 (localhost:15432→PG, 18123→CH)
```
DataGrip은 SSH 설정 없이 직접: PostgreSQL Host `localhost` Port **`15432`**, ClickHouse Host `localhost` Port **`18123`** (creds 동일).

### 비번 없이 (선택, 1회 설정)
```bash
ssh-copy-id -p 2222 kyuseok@127.0.0.1     # 비번 1회 입력해 키 등록
```
이후 SSH 인증을 **Key pair**로 바꾸면 비번 없이 접속되고, `dev-db-tunnel.sh`도 무인증으로 뜬다.

---

## 접속 후 확인 쿼리
```sql
-- PostgreSQL
SELECT id, name, order_index FROM boards ORDER BY order_index;
SELECT email, role FROM users;

-- ClickHouse (최신 1행은 반드시 FINAL — ReplacingMergeTree)
SELECT count(), uniqExact(ticker) FROM stock_data.daily_prices;
SELECT * FROM stock_data.daily_prices FINAL WHERE ticker='005930' ORDER BY date DESC LIMIT 30;
```

## 트러블슈팅
| 증상 | 원인/조치 |
|---|---|
| SSH `Connection refused` | cloudflared 미실행 → `launchctl load ~/Library/LaunchAgents/com.user.cloudflared.ssh.plist`, `nc -z 127.0.0.1 2222` |
| SSH `Auth fail` | User=`kyuseok`, 비번=미니PC 서버 비밀번호(Termius로 되던 자격증명) |
| DB `password authentication failed` | General 탭 DB 비번 문제 — 개발서버 실제 DB 비번과 일치해야(기본 `stock_password`/`password`) |
| ClickHouse 드라이버 오류 | 드라이버 0.6.3+ 로 업데이트(서버 24.8 호환) |
| Host를 15432/18123로 넣어 실패 | 내장 SSH 터널(B-1)에선 **5432/8123**. 15432/18123은 스크립트(B-2) 전용 |

> ⚠️ 개발서버 DB는 **공유 자원**이다 — DROP/DELETE/스키마 변경은 신중히(조회 위주). DB 포트는 절대 Cloudflare 터널에 노출하지 않는다(LAN 전용).


---

# 📄 `docs/deployment_guide.md`

# Stock App 배포 파이프라인 및 인프라 가이드

본 문서는 홈 서버(미니PC) 환경에서 **GitHub Actions(Self-hosted runner)**를 활용한 CI/CD 무중단 배포 및 아키텍처 환경 설정에 대해 설명합니다.

---

## 1. 배포 아키텍처 (CI/CD)

본 프로젝트는 외부 클라우드(AWS 등)가 아닌 로컬 홈 서버(미니PC)에 배포되며, 이중 NAT 환경의 네트워크 한계를 극복하기 위해 **Pull 기반 배포 방식**을 채택했습니다.

1. **개발자:** 로컬 PC에서 코드를 수정 후 GitHub `main` 브랜치에 Push (`git push`)
2. **GitHub Actions:** 변경 경로에 따라 `deploy-server.yml`(backend/**) 또는 `deploy-web.yml`(web_client·admin_web/**) 트리거 발생(수동 실행도 가능)
3. **Self-hosted Runner:** 홈 서버에 백그라운드로 띄워진 에이전트가 신호를 받아 최신 코드를 `checkout`
4. **Docker Compose 빌드:** 홈 서버 안에서 `docker-compose.prod.yml`을 기반으로 전체 컨테이너(API, Celery, DB 등)를 새로 빌드(`--build`)하고 백그라운드로 무중단 재시작(`-d`)

---

## 2. 서버 인프라 구성 (Docker Compose)

실제 서버는 `docker-compose.prod.yml`을 통해 총 8개의 컨테이너로 분리되어 구동됩니다.

### 🗄️ 데이터베이스 및 인프라
*   **PostgreSQL (`stock_postgres_prod`):** 포트 `5432` / 관계형 메인 데이터
*   **ClickHouse (`stock_clickhouse_prod`):** 포트 `8123`, `9000` / 주식 및 재무 시계열 데이터
*   **Redis (`stock_redis_prod`):** 포트 `6379` / 캐시 및 Celery 메시지 큐

### 🚀 마이크로서비스 (API 서버)
*   **Auth API (`stock_auth_api`):** 포트 `8001` / 회원가입, JWT, OAuth 인증 전담
*   **Stock API (`stock_stock_api`):** 포트 `8002` / 주식 시세, 스크리너 데이터 제공 전담
*   **Blog API (`stock_blog_api`):** 포트 `8003` / 게시판, 커뮤니티 전담

### ⚙️ 백그라운드 워커 (Celery)
*   **Celery Worker (`stock_celery_worker`):** 데이터 수집, 푸시 알림 발송 등 무거운 비동기 작업 처리 (포트 개방 없음)
*   **Celery Beat (`stock_celery_beat`):** 주기적으로 데이터를 갱신(수집)하는 스케줄러 (포트 개방 없음)

---

## 3. 네트워크 및 도메인 라우팅 (Cloudflare Tunnel)

보안과 포트포워딩의 번거로움을 해결하기 위해 모든 외부 API 트래픽은 **Cloudflare Tunnel (Zero Trust)**을 통해 우회 접속됩니다.

Cloudflare 대시보드 (`Published application routes`) 설정 값:
*   **인증 전용:** `auth.haezean.com` ➡️ `http://localhost:8001`
*   **주식 전용:** `api.haezean.com` ➡️ `http://localhost:8002`
*   **커뮤니티 전용:** `blog.haezean.com` ➡️ `http://localhost:8003`

> 💡 **참고:** 클라이언트(웹/모바일)는 Cloudflare의 강력한 HTTPS 처리를 받으므로, 별도의 Nginx나 Let's Encrypt 설정 없이 즉시 안전한 통신이 가능합니다.

---

## 4. 환경 변수 설정 (중요)

GitHub 저장소에는 보안상 데이터베이스 비밀번호와 외부 API 키가 포함된 `.env` 파일이 올라가지 않습니다.
따라서, **최초 배포 시 미니PC 서버의 터미널에 직접 접속하여 아래 작업을 1회 수행해야 합니다.**

```bash
# 1. 홈 서버 내 프로젝트 폴더로 이동
cd /path/to/stock_app

# 2. 프로덕션 환경 변수 파일 생성
cp backend/.env.example backend/.env.production

# 3. 비밀번호 및 시크릿 키 기입
nano backend/.env.production
```
*   `docker-compose.prod.yml`은 컨테이너를 빌드할 때 반드시 이 `backend/.env.production` 파일을 참조합니다.

---

## 5. 트러블슈팅 가이드

*   **배포는 성공했는데 서버 접속이 안 될 때:**
    미니PC 터미널에서 `docker logs stock_stock_api` 명령어로 FastAPI 서버가 에러 없이 잘 켜졌는지 확인합니다.
*   **데이터베이스 연결 에러가 날 때:**
    `.env.production` 파일 내부의 DB 주소가 `localhost`가 아닌 컨테이너 이름(예: `postgres`, `redis`)으로 지정되어 있는지 확인하세요. (도커 네트워크 내에서는 컨테이너 이름으로 통신합니다.)


---

# 📄 `docs/deployment/clickhouse-backup.md`

# ClickHouse 백업 · 복원 (배포용)

로컬에서 수집·백필한 주가 데이터(`stock_data`)를 백업해 **운영 서버로 이전**하는 절차.
서버에서 다시 전종목 백필(~1시간)을 돌리지 않고 데이터를 그대로 옮길 수 있다.

- 스크립트: `backend/scripts/backup_clickhouse.sh`, `backend/scripts/restore_clickhouse.sh`
- 대상: `stock_data` DB의 모든 테이블(`daily_prices` 등). 스키마(DDL)+데이터(Native)를 tar.gz 하나로 묶음.
- `daily_prices`는 `ReplacingMergeTree`라 **FINAL로 중복제거 후 덤프**, 재복원해도 `(ticker,date)` 멱등.

> ℹ️ 이 데이터는 재수집 가능(멱등)하다. **시간 절약이면 백업 이전**, **깔끔함이면 서버에서 `backfill_all_daily` 재수집** — 둘 다 유효. 아래는 백업 이전 방식.

---

## 1. 백업 (로컬)

```bash
cd backend
./scripts/backup_clickhouse.sh
# → ./backups/stock_data_YYYYMMDD_HHMMSS.tar.gz 생성
```

출력 위치·접속정보는 환경변수로 조정:

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `CH_CONTAINER` | 자동탐지(`docker ps`에서 clickhouse) | ClickHouse 도커 컨테이너명 |
| `CH_USER` | `default` | 사용자 |
| `CH_PASSWORD` | `password` | 비밀번호 |
| `CH_DB` | `stock_data` | 대상 DB |
| `OUT_DIR` | `./backups` | 백업 출력 디렉토리 |

```bash
# 예: 다른 위치로, 운영 접속정보로
OUT_DIR=/data/backups CH_PASSWORD='***' ./scripts/backup_clickhouse.sh
```

> ⚠️ **백필/수집이 도는 중에는 백업을 피하세요.** 쓰기 중 스냅샷은 행수가 어긋날 수 있습니다.
> 자동수집(worker/beat)을 잠시 멈췄다가(또는 장중이 아닌 시간에) 백업하세요.

---

## 2. 서버로 전송

```bash
scp backups/stock_data_YYYYMMDD_HHMMSS.tar.gz  user@server:/data/backups/
```

---

## 3. 복원 (서버)

```bash
cd backend
./scripts/restore_clickhouse.sh /data/backups/stock_data_YYYYMMDD_HHMMSS.tar.gz
```

- DB/테이블이 없으면 백업의 DDL로 **자동 생성**(대상 DB명은 `CH_DB`로 치환 가능).
- 데이터 삽입 후 `OPTIMIZE ... FINAL`로 정리. 빈 테이블은 스키마만 복원.
- 접속정보는 백업과 동일하게 환경변수로:

```bash
CH_PASSWORD='***' CH_CONTAINER=stock_clickhouse \
  ./scripts/restore_clickhouse.sh /data/backups/stock_data_20260806_170000.tar.gz
```

**검증:**
```bash
docker exec <ch> clickhouse-client --user default --password '***' --query \
  "SELECT count(DISTINCT ticker), count() FROM stock_data.daily_prices FINAL"
```

---

## 4. 버전 주의 (필수)

서버 ClickHouse 버전을 **로컬과 동일(24.8 LTS)** 로 맞추세요. Native 포맷은 버전 간
호환되지만, 메이저 버전이 크게 다르면 문제가 생길 수 있습니다. (`docker-compose.dev.yml`에 24.8 고정)

---

## 5. 전체 배포 흐름 (요약)

| 대상 | 방식 |
|---|---|
| **ClickHouse**(`stock_data`, 주가) | 위 백업→전송→복원. 또는 서버에서 `collector.backfill_all_daily` 재수집 |
| **PostgreSQL**(auth 유저·블로그) | **로컬 데이터 복사 금지.** 서버에서 새로: `alembic upgrade head` + `python -m apps.auth.seed_admin` |
| **수집 지속** | 서버에서 celery worker+beat 기동 → 매일 20:30 자동수집으로 최신 유지 |

> PostgreSQL은 로컬에 테스트 유저·개발 게시글이 섞여 있어 그대로 올리면 안 됩니다.
> 스키마는 마이그레이션, 관리자만 시드하고 운영 데이터는 서버에서 새로 쌓습니다.

---

## 6. (선택) 정기 백업 cron

```bash
# 매일 21:00 백업(자동수집 20:30 이후), 7일 넘은 백업 삭제
0 21 * * * cd /path/backend && OUT_DIR=/data/backups ./scripts/backup_clickhouse.sh \
  && find /data/backups -name 'stock_data_*.tar.gz' -mtime +7 -delete
```


---

# 📄 `docs/intel_macmini_server_setup.md`

# Intel 맥미니 개발용 홈 서버 구축 가이드
> 대상 환경: Mac mini 2018 (Intel Core i5, x86_64, macOS Sequoia)  
> 사용자 계정: `kyuseok`  
> 내부 유선 IP: `192.168.0.33`  
> 스토리지: 내장 SSD 256GB (macOS 시스템/앱) + 추가 SSD 250GB (주식 시계열 DB 전용)

---

## 1. 서버 필수 전원 및 무인 운영 설정

화면이 꺼지거나 정전 후 복구되었을 때 서버가 멈추지 않고 항상 켜져 있도록 설정합니다.

### 1) 절전 방지 및 자동 시작 (맥미니 터미널)
```bash
# 잠자기 비활성화, 디스플레이 꺼짐 10분, 정전 후 자동 켜짐, 네트워크 깨우기 활성화
sudo pmset -a sleep 0 displaysleep 10 autorestart 1 womp 1
```

### 2) 사용자 자동 로그인 활성화 (중요)
macOS는 사용자 로그인 세션이 열려야 Docker/OrbStack 백그라운드 엔진이 정상 기동합니다.
* **시스템 설정 > 사용자 및 그룹 > 자동 로그인**을 `kyuseok` 계정으로 활성화합니다.
* *(참고: FileVault가 켜져 있으면 자동 로그인이 비활성화되므로, 필요시 시스템 설정 > 개인정보 보호 및 보안 > FileVault를 끔)*

---

## 2. 추가 SSD(250GB) 초기화 및 ClickHouse 전용 스토리지 분리

기존 윈도우(NTFS)가 설치되어 있던 추가 SSD를 macOS 전용 파일시스템(APFS)으로 포맷하고, 용량이 커지는 주식 시계열 데이터(ClickHouse)를 이 드라이브에 격리 저장합니다.

### 1) 주식 데이터 용량 산정 및 분리 필요성
* **일봉(daily_prices)**: 2,600종목 × 250영업일 = 연간 약 65만 행. ClickHouse LZ4 압축 시 **연간 15~20MB**, 10년 치를 모아도 200MB 이하로 매우 가볍습니다.
* **분봉(1분봉)**: 2,600종목 × 390분 = 하루 약 100만 행. 연간 약 2.5억 행 누적.
  * ClickHouse 컬럼 압축 및 보조지표 포함 시 **연간 약 8~12GB** 발생.
  * 3~5년 치 누적 시 **40~60GB** 이상 차지.
* **ClickHouse MergeTree 백그라운드 병합(Merge)**:
  * ClickHouse는 데이터를 압축·병합할 때 파트 크기의 최대 2배까지 **임시 디스크 공간**을 필요로 합니다.
  * 시스템 드라이브(내장 256GB)에 이를 두면 OS 디스크 풀(Disk Full)로 macOS 자체가 멈출 위험이 있습니다.
* **결론**: 추가 250GB SSD를 `StockData` 볼륨으로 지정하여 ClickHouse, PostgreSQL, 백업 파일을 전용 분리 운영합니다.

### 2) 추가 SSD 초기화 (Windows NTFS → APFS 포맷)
맥미니 터미널에서 실행:

```bash
# 1. 디스크 목록 확인 (추가 SSD의 식별자 확인: 예 /dev/disk2 또는 /dev/disk3)
diskutil list

# 윈도우 파티션(Microsoft Basic Data / NTFS)이 있는 디스크 번호를 정확히 확인합니다.
# ⚠️ 주의: 반드시 추가 장착한 250GB 디스크 번호를 지정해야 합니다! (내장 디스크 disk0 포맷 금지)

# 2. 추가 SSD 전체 초기화 및 APFS 포맷 (이름: StockData)
# 예시: 대상 디스크가 /dev/disk2 일 때:
diskutil eraseDisk APFS StockData /dev/disk2
```

### 3) 스토리지 디렉토리 생성 및 권한 설정
포맷 완료 시 macOS에서 자동으로 `/Volumes/StockData` 경로로 마운트됩니다.
```bash
# DB 및 백업용 디렉토리 생성
sudo mkdir -p /Volumes/StockData/clickhouse
sudo mkdir -p /Volumes/StockData/postgres
sudo mkdir -p /Volumes/StockData/redis
sudo mkdir -p /Volumes/StockData/backups

# 사용자 권한 부여 (Docker/OrbStack 컨테이너 접근 보장)
sudo chown -R kyuseok:staff /Volumes/StockData
sudo chmod -R 777 /Volumes/StockData/clickhouse /Volumes/StockData/postgres /Volumes/StockData/redis
```

### 4) Docker Compose에 스토리지 경로 주입 (`compose.env`)
배포 시 호스트 시크릿 디렉토리(`/opt/stock_app/env/compose.env`)에 아래 설정을 등록하면, Docker Compose가 자동으로 내장 볼륨 대신 추가 SSD 경로를 바인드 마운트합니다:

```ini
# /opt/stock_app/env/compose.env
CLICKHOUSE_DATA_DIR=/Volumes/StockData/clickhouse
POSTGRES_DATA_DIR=/Volumes/StockData/postgres
REDIS_DATA_DIR=/Volumes/StockData/redis
```

---

## 3. SSH 활성화 및 로컬 접속 설정

### 1) SSH 서버 활성화
* **시스템 설정 > 일반 > 공유 > '원격 로그인(Remote Login)'** 스위치를 **켬(ON)**으로 변경합니다.
* 옆의 **(i)** 정보 버튼에서 `kyuseok` 계정에 접근 권한이 부여되었는지 확인합니다.

### 2) SSH 키 디렉토리 생성 (맥미니 터미널)
```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

### 3) 로컬 네트워크 접속 테스트 (맥북 터미널)
```bash
# 1. 비밀번호로 접속 확인
ssh kyuseok@192.168.0.33

# 2. 비밀번호 없이 접속하기 위한 SSH 키 복사
ssh-copy-id kyuseok@192.168.0.33
```

---

## 4. Docker 환경 구축 (Intel Mac)

### 1) OrbStack (Intel Mac 버전) 설치 권장
Docker Desktop에 비해 유휴 CPU/메모리 자원을 대폭 절약하는 OrbStack을 권장합니다.
1. [OrbStack 다운로드](https://orbstack.dev/download)에서 **Intel Mac (x86_64)** 버전 설치  
   *(터미널 명령: `curl -fsSL https://orbstack.dev/install | sh`)*
2. OrbStack 실행 후 로그인 시 자동 기동 설정 확인
3. 터미널 동작 확인:
   ```bash
   docker --version
   docker compose version
   ```

---

## 5. 저장소 클론 및 최초 컨테이너 기동

### 1) 호스트 시크릿 파일 구성 (맥미니 터미널)
```bash
sudo mkdir -p /opt/stock_app/env
sudo chown -R kyuseok:staff /opt/stock_app/env
chmod 700 /opt/stock_app/env

# 1. 앱 환경변수 작성
nano /opt/stock_app/env/.env.production
# (backend/.env.example 내용 참조: DATABASE_URL, CLICKHOUSE_HOST, KIS 키 등)

# 2. 스토리지 분리용 compose.env 작성
cat << 'EOF' > /opt/stock_app/env/compose.env
CLICKHOUSE_DATA_DIR=/Volumes/StockData/clickhouse
POSTGRES_DATA_DIR=/Volumes/StockData/postgres
REDIS_DATA_DIR=/Volumes/StockData/redis
EOF
```

### 2) 프로젝트 클론 및 초기화
```bash
git clone https://github.com/kyuseokyi/stock_app.git ~/stock_app
cd ~/stock_app

cp /opt/stock_app/env/.env.production backend/.env.production
cp /opt/stock_app/env/compose.env .env

# 전체 서비스 백그라운드 빌드 및 기동
docker compose -f docker-compose.prod.yml up -d --build

# DB 스키마 생성 및 초기 시드
docker compose -f docker-compose.prod.yml run --rm stock_api uv run alembic upgrade head
docker compose -f docker-compose.prod.yml run --rm stock_api uv run python -m shared.clickhouse_schema
docker compose -f docker-compose.prod.yml run --rm auth_api uv run python -m apps.auth.seed_admin
```

---

## 6. GitHub Actions Self-hosted Runner 등록 (CI/CD 자동 배포)

맥북에서 `git push origin main` 시 맥미니가 스스로 코드를 받아 재배포하도록 등록합니다.

1. GitHub 저장소 **Settings > Actions > Runners > New self-hosted runner** (macOS / x64 선택)
2. 맥미니 터미널:
   ```bash
   mkdir -p ~/actions-runner && cd ~/actions-runner
   curl -o actions-runner-osx-x64-2.322.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.322.0/actions-runner-osx-x64-2.322.0.tar.gz
   tar xzf ./actions-runner-osx-x64-2.322.0.tar.gz

   # 토큰 등록
   ./config.sh --url https://github.com/kyuseokyi/stock_app --token <GITHUB_TOKEN>

   # macOS 서비스 등록 (도커 CLI PATH 등록 포함)
   echo "$PATH" > ~/actions-runner/.path
   ./svc.sh install
   ./svc.sh start
   ```

---

## 7. Cloudflare Tunnel (외부 웹 + 원격 SSH 접속)

공유기 포트포워딩 없이 외부에서 안전하게 맥미니 서버 및 웹 서비스에 접속합니다.

```mermaid
flowchart LR
    subgraph Client["외부 클라이언트 (맥북)"]
        LaptopSSH["터미널 / VS Code"]
        Browser["웹 브라우저"]
    end

    subgraph CF["Cloudflare Edge"]
        CF_SSH["ssh.haezean.com"]
        CF_Web["dev.haezean.com"]
    end

    subgraph MacMini["맥미니 (Intel Server)"]
        CFTunnel["cloudflared 데몬"]
        DockerWeb["Docker 웹 컨테이너 (:3000, :3001)"]
        HostSSH["macOS SSH (:22)"]
        SSD[("추가 SSD (/Volumes/StockData)")]
        DockerCH["ClickHouse (:8123)"]
    end

    LaptopSSH -->|cloudflared access ssh| CF_SSH
    Browser -->|HTTPS 443| CF_Web
    CF_SSH <== Tunnel ==> CFTunnel
    CF_Web <== Tunnel ==> CFTunnel
    CFTunnel --> DockerWeb
    CFTunnel --> HostSSH
    DockerCH --> SSD
```

### 1) 맥미니에 cloudflared 데몬 설치 및 서비스 등록
```bash
# Intel Mac용 cloudflared 바이너리 다운로드 및 압축 해제 (이미 설치 완료됨)
curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz | tar -xz -C ~/.orbstack/bin/
cloudflared --version

# 시스템 데몬으로 서비스 등록 (부팅 시 자동 실행)
sudo ~/.orbstack/bin/cloudflared service install <Cloudflare에서_발급받은_터널_토큰>
```

---

## 8. 외부 노트북(맥북) 접속 설정

### 1) 맥북에 cloudflared 설치
```bash
brew install cloudflared
```

### 2) 맥북 `~/.ssh/config` 설정
```ssh-config
# 집 내부 Wi-Fi 접속용
Host macmini-local
    HostName 192.168.0.33
    User kyuseok
    ServerAliveInterval 60

# 외부(카페, 원격지) Cloudflare Tunnel 접속용
Host macmini-remote
    HostName ssh.haezean.com
    User kyuseok
    ProxyCommand cloudflared access ssh --hostname %h
    ServerAliveInterval 60
```

### 3) 접속 및 VS Code 연동
* **터미널**: `ssh macmini-local` (집 내부) 또는 `ssh macmini-remote` (외부)
* **VS Code**: `Remote - SSH: Connect to Host...` > `macmini-local` 선택 시 맥북에서 맥미니 소스코드를 직접 개발 가능


---

# 📄 `docs/macmini_setup_progress.md`

# Intel 맥미니 홈 서버 구축 진행 상황 보고서

> **문서 상태**: 인프라 구축 및 전체 컨테이너 정상 기동 완료 (외부 연동 대기 중)  
> **기준 일자**: 2026-09-29  
> **대상 장비**: Mac mini 2018 (Intel Core i5, x86_64, macOS Sequoia 15.8)  
> **사용자 계정**: `kyuseok`  
> **내부 IP**: `192.168.0.33` (유선 기가비트 이더넷)

---

## 1. 종합 구축 현황 요약

| 구분 | 목표 작업 | 상태 | 상세 내용 |
| :--- | :--- | :---: | :--- |
| **전원 및 절전** | 무인 서버 상시 전원 유지 |  완료 | `sleep 0`, `displaysleep 10`, `autorestart 1`, `womp 1` 적용 |
| **스토리지 분리** | 추가 250GB SSD 포맷 및 분리 |  완료 | Windows 파티션 삭제 → APFS 포맷 (`/Volumes/StockData`, 238GiB) |
| **도커 엔진** | 경량화 Docker 가동 (Intel x86_64) |  완료 | OrbStack v2.2.3 설치 및 백그라운드 엔진 가동 완료 |
| **볼륨 마운트** | 시계열/DB 스토리지 격리 |  완료 | ClickHouse, Postgres, Redis 데이터를 `/Volumes/StockData`에 바인드 |
| **DB 스키마** | DB 마이그레이션 및 관리자 시드 |  완료 | Alembic 5개 마이그레이션 + ClickHouse 테이블 + admin 시드 완료 |
| **백엔드 스택** | FastAPI 3종 + Celery 2종 |  완료 | Auth(:8001), Stock(:8002), Blog(:8003), Worker, Beat 정상 구동 |
| **프론트엔드** | 유저 웹 + 어드민 패널 |  완료 | Web Client(:3000), Admin Web(:3001) Vite 빌드 및 서빙 완료 |
| **CLI 툴** | 터널 도구 설치 |  완료 | `cloudflared` v2026.9.3 설치 및 PATH 등록 완료 |
| **CI/CD** | GitHub Actions Runner 등록 |  완료 | `macmini-server` 백그라운드 서비스(LaunchAgent) 등록 및 GitHub 연결 완료 |
| **외부 접속** | Cloudflare Zero Trust 터널 |  완료 | `com.cloudflare.cloudflared` 서비스 가동 (4개 QUIC 엣지 연결 정상 수립) |

---

## 2. 스토리지 아키텍처 및 분리 현황

분봉(1분봉) 데이터의 대량 축적(연간 2.5억 행 / 8~12GB)과 ClickHouse MergeTree 엔진의 압축/병합 임시 버퍼 공간 확보를 위해 **내장 SSD와 데이터 전용 SSD를 완전 분리**했습니다.

```mermaid
flowchart TD
    subgraph InternalSSD["내장 SSD (251 GB)"]
        OS["macOS Sequoia 15.8"]
        OrbEngine["OrbStack 가상화 엔진"]
        SrcCode["소프트웨어 소스코드 / 빌드 캐시"]
        EnvDir["/opt/stock_app/env (호스트 시크릿)"]
    end

    subgraph SecondarySSD["추가 전용 SSD - /Volumes/StockData (256 GB, 가용 238 GiB)"]
        CH_Data[("/Volumes/StockData/clickhouse (시계열 주가 DB)")]
        PG_Data[("/Volumes/StockData/postgres (관계형 사용자/게시판 DB)")]
        RD_Data[("/Volumes/StockData/redis (캐시 및 Celery 브로커)")]
        BK_Data["/Volumes/StockData/backups (데이터 백업 저장소)"]
    end

    InternalSSD -.->|볼륨 바인드 마운트| SecondarySSD
```

* **포맷 방식**: APFS (Apple File System)
* **마운트 경로**: `/Volumes/StockData` (권한: `kyuseok:staff`, `chmod -R 777`)
* **도커 볼륨 연동**: `/opt/stock_app/env/compose.env`를 통해 자동 주입
  ```ini
  CLICKHOUSE_DATA_DIR=/Volumes/StockData/clickhouse
  POSTGRES_DATA_DIR=/Volumes/StockData/postgres
  REDIS_DATA_DIR=/Volumes/StockData/redis
  ```

---

## 3. 실행 중인 컨테이너 현황 (`docker ps`)

총 10개의 프로덕션 컨테이너가 정상 기동(Healthy) 중이며, 로컬 HTTP 응답 검증을 마쳤습니다.

| 컨테이너 이름 | 이미지 | 포트 바인딩 | 헬스체크 / HTTP 응답 |
| :--- | :--- | :---: | :---: |
| **`stock_clickhouse_prod`** | `clickhouse/clickhouse-server:24.8` | `8123`, `9000` | 🟢 **Healthy** |
| **`stock_postgres_prod`** | `postgres:15-alpine` | `5432` | 🟢 **Healthy** |
| **`stock_redis_prod`** | `redis:7-alpine` | `6379` | 🟢 **Healthy** |
| **`stock_auth_api`** | `stock_app-auth_api` | `8001:8001` | 🟢 **HTTP 200** (`/docs`) |
| **`stock_stock_api`** | `stock_app-stock_api` | `8002:8002` | 🟢 **HTTP 200** (`/graphql`) |
| **`stock_blog_api`** | `stock_app-blog_api` | `8003:8003` | 🟢 **HTTP 200** (`/docs`) |
| **`stock_celery_worker`** | `stock_app-celery_worker` | - | 🟢 **Running** (KIS 수집 대기) |
| **`stock_celery_beat`** | `stock_app-celery_beat` | - | 🟢 **Running** (매일 20:30 스케줄러) |
| **`stock_web_client`** | `stock_app-web_client` | `3000:3000` | 🟢 **HTTP 200** (`/`) |
| **`stock_admin_web`** | `stock_app-admin_web` | `3001:3000` | 🟢 **HTTP 200** (`/`) |

---

## 4. 데이터베이스 및 시드 완료 내역

1. **PostgreSQL (Alembic Upgrade)**:
   * `3df33e164159`: 초기 테이블(`users`, `boards`, `blog_posts`, `blog_comments`, `push_templates`, `stock_meta`)
   * `9ead505faafe`: `blog_posts.author_id` nullable 처리
   * `6fda58a1c441`: `users.password_hash` 및 소셜 필드 추가
   * `cf0877c663a1`: `boards.comments_enabled` 토글 지원
   * `f1e2d3c4b5a6`: `blog_posts.featured_at` 홈 큐레이션 칼럼 추가
2. **ClickHouse (`shared.clickhouse_schema`)**:
   * `stock_data.daily_prices` (`ReplacingMergeTree(ingested_at)`) 생성 완료
   * `stock_data.fundamentals` (`MergeTree()`) 생성 완료
3. **관리자 계정 시드**:
   * 이메일: `admin@stock.app` / 초기 비밀번호: `admin1234`

---

## 5. 향후 최종 연동 절차 (Remaining Steps)

### 1) GitHub Actions Self-hosted Runner 등록
1. 저장소 `kyuseokyi/stock_app` > **Settings > Actions > Runners > New self-hosted runner** 이동.
2. OS: **macOS**, Arch: **x64** 선택 후 토큰 복사.
3. 맥미니 터미널에서 실행:
   ```bash
   mkdir -p ~/actions-runner && cd ~/actions-runner
   curl -o actions-runner-osx-x64-2.322.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.322.0/actions-runner-osx-x64-2.322.0.tar.gz
   tar xzf ./actions-runner-osx-x64-2.322.0.tar.gz
   ./config.sh --url https://github.com/kyuseokyi/stock_app --token <GITHUB_토큰>
   echo "$PATH" > ~/actions-runner/.path
   ./svc.sh install && ./svc.sh start
   ```

### 2) Cloudflare Zero Trust 터널 데몬 서비스 등록
1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) > Networks > Tunnels에서 새 터널 생성 후 토큰 복사.
2. 맥미니 터미널에서 실행 (`cloudflared` 바이너리는 이미 설치 완료됨):
   ```bash
   sudo ~/.orbstack/bin/cloudflared service install <Cloudflare_토큰>
   ```

### 3) 맥북(클라이언트) `~/.ssh/config` 설정
```ssh-config
Host macmini-local
    HostName 192.168.0.33
    User kyuseok
    ServerAliveInterval 60

Host macmini-remote
    HostName ssh.haezean.com
    User kyuseok
    ProxyCommand cloudflared access ssh --hostname %h
    ServerAliveInterval 60
```


---

# 📄 `docs/prompts/00_master_prompt.md`

# Claude Code System Prompt (Master)

당신은 Anthropic의 `Claude Code CLI` 환경에서 동작하는 수석 풀스택 엔지니어입니다.
당신은 터미널 명령어를 직접 실행하고, 파일 시스템을 읽고 쓸 수 있는 완전한 권한이 있습니다. 아래의 아키텍처 규칙과 행동 수칙을 엄격하게 준수하여 주어진 임무를 완수하세요.

## [Claude Code 행동 수칙]
1. **자율적 실행**: 패키지 설치(uv, npm 등), 디렉토리 생성, 파일 수정 등의 작업은 사용자에게 권한을 묻지 말고 즉시 도구를 사용하여 실행하세요.
2. **에러 자가 치유**: 명령어나 코드 실행 중 에러가 발생하면, 스스로 로그를 분석하고 디버깅하여 문제를 해결한 뒤 재시도하세요.
3. **탐색 우선**: 코드를 수정하기 전에 항상 `ls`나 파일 읽기 도구를 사용하여 현재 디렉토리 구조와 기존 코드를 먼저 파악하세요.
4. **패키지 매니저**: Python(`backend/`) 환경에서는 무조건 `uv`를 사용합니다. (예: `uv add fastapi`, `uv run uvicorn`)

## [기술 스택 및 아키텍처]
- Backend: Python FastAPI, Celery, **Strawberry (GraphQL)**
- Database: PostgreSQL (일반 데이터), ClickHouse (시계열 데이터), Redis (Celery Broker)
- Mobile Client: React Native (Expo), NativeWind, Zustand, **graphql-request**
- User Web Client: React (Vite), TailwindCSS, Zustand, **graphql-request**
- Admin Client: React (Vite), TailwindCSS, Tremor, TipTap, **graphql-request**
- Deploy: Docker Compose (Local), Kubernetes (Prod)

## [공통 코딩 규칙 (토큰 최적화 및 클린 아키텍처)]
1. 모든 API 통신은 JSON을 사용하며, FastAPI에서 Pydantic 모델을 엄격하게 적용하여 입출력을 검증합니다.
2. **Hybrid Architecture (REST + GraphQL) 및 Clean Architecture 엄수**:
   - **Backend**: 단순 상태 변경(인증, 알림) 및 외부 통신은 REST Router로 구현하고, 복잡한 데이터 조회(게시판, 주식 차트 등)는 `Strawberry`를 이용한 GraphQL Resolver로 분리하세요.
   - **Frontend**: `react-query`의 Fetcher로 API 성격에 맞춰 `axios`(REST)와 `graphql-request`(GraphQL)를 혼용하여 사용하세요. UI 렌더링 컴포넌트 내부에 통신 로직을 직접 넣지 마세요.
3. 로컬 파일 경로는 절대 하드코딩하지 않고 환경 변수나 상대 경로를 사용합니다.
4. Git 모노레포 구조(`backend/`, `mobile/`, `web_client/`, `admin_web/`)를 엄격하게 지켜 코드를 배치하세요.
5. **Micro-Step Development**: 토큰 소모와 컨텍스트 초과를 막기 위해, 한 번의 턴에 거대한 코드를 모두 작성하지 마세요. 파일을 하나씩 생성하고 단위별로 테스트하며 점진적으로 완성하세요.

## [자동화 테스트 및 QA (Quality Assurance) 전략]
항상 코드를 작성한 후에는 각 환경의 QA 도구에 맞춘 단위/UI 자동화 테스트를 작성하세요.
- **Backend**: `pytest` (API 로직 검증 및 `unittest.mock`을 활용한 KIS 파이프라인 방어)
- **Mobile (React Native)**: `Maestro` (실제 유저 행동 기반 UI 자동화 E2E 테스트), `Jest` (단위)
- **User Web & Admin Web (React/Vite)**: `Playwright` (웹 시나리오 E2E 녹화 테스트), `Vitest` (단위)


---

# 📄 `docs/prompts/01_backend_pipeline.md`

[명령어: 이 작업은 `backend/` 디렉토리 안에서 수행하세요. 사전에 `00_master_prompt.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 한국투자증권 OpenAPI를 이용하여 주식 일봉 데이터를 수집하는 `Celery` 기반 데이터 파이프라인 워커(Worker)를 구축하는 것입니다.

## [실행 단계 - Step by Step]
1. **의존성 설치**: `backend/` 디렉토리로 이동하여 `uv add celery redis pandas pandas-ta clickhouse-connect requests websockets` 명령어로 패키지를 설치하세요.
2. **앱 생성 (MSA 구조)**: `backend/apps/collector/` 디렉토리를 만들고, Redis를 브로커로 사용하는 Celery 애플리케이션(`celery_app.py`)을 초기화하세요.
3. **스케줄러 셋업**: `celery-beat`를 사용하여 매일 오후 4시(장 마감 후)에 동작하는 스케줄을 설정하세요.
4. **공통 모델 참조**: 데이터 적재 시 `backend/shared/models.py`를 활용하거나 ClickHouse 쿼리를 모듈화하세요.
5. **[중요] 수집 로직 (Custom API Client)**: 한국투자증권 OpenAPI 연동 시 외부 패키지(`mojito2`, `pykis`)에 의존하지 마세요. 대신 해당 오픈소스들의 코드와 공식 문서를 벤치마킹하여 `requests` 기반으로 **직접 Custom API Client 클래스**를 작성하세요. (OAuth 토큰 발급, Hashkey 생성, 초당 호출 제한을 피하기 위한 `asyncio.sleep` 또는 retry 로직 필수 포함)
6. **최우선 지표 연산 및 적재**: 수집한 OHLCV 및 거래량(Volume) 데이터를 `pandas-ta` 등을 이용해 다음 핵심 지표들로 연산하세요.
   - **이동평균선 (MA5, 20, 50, 120)** 및 **정배열/역배열** 여부 플래그
   - **볼린저 밴드**: 기본(std=2) 외에도 사용자가 향후 표준편차(1~3 등)를 동적으로 변경할 수 있도록 원시 데이터나 다중 편차 밴드를 계산
   - **매물대 (Volume Profile)**: 가격대별 누적 거래량 연산
   이후 재무 데이터(PER, PBR, ROE)와 함께 ClickHouse의 `daily_prices` 및 `fundamentals` 테이블에 Bulk Insert 하세요.
7. **검증**: 로컬 환경(`docker-compose.dev.yml`에 설정된 ClickHouse, Redis)에서 `celery worker`를 띄워 정상적으로 적재되는지 테스트하세요.


---

# 📄 `docs/prompts/02_backend_api.md`

# 2. 블로그 마이크로서비스 및 어드민 웹 (Blog API & Admin Web)

당신의 임무는 블로그(커뮤니티) 게시판 관리와 실시간 알림 기능이 포함된 풀스택 어플리케이션을 개발하는 것입니다. 다음 작업들을 순차적으로 수행해 줘.

### 🟢 1단계: Backend Blog API 및 SSE 알림 구현 (FastAPI + Strawberry)
1. `backend/apps/blog/` 디렉토리에 블로그 전용 독립 서버를 구축해 줘. (`main.py`, `routers/`, `schemas.py`, `graphql/`, `crud.py`)
2. `backend/shared/models.py`에 게시판(`boards`)과 블로그 게시글(`blog_posts`)을 위한 SQLAlchemy 모델을 정의해 줘.
3. **[REST & GraphQL 하이브리드]** 
   - **조회(Query)**: 어드민 및 웹 클라이언트에서 복잡한 구조(게시글, 작성자, 댓글 목록 등)를 한 번에 조회할 수 있도록 **`Strawberry`** 라이브러리를 이용하여 GraphQL 쿼리(`graphql/schema.py`, `graphql/resolvers.py`)로 구현해 줘.
   - **작성/수정/삭제(Mutation)**: 상태 변경 및 파일 업로드가 포함될 수 있는 생성/수정 로직은 일반적인 REST API (`/api/v1/blogs`) 라우터로 구현해 줘.
4. **[중요]** 프론트엔드 웹 클라이언트를 위한 **SSE(Server-Sent Events)** 알림 엔드포인트(`/api/v1/notifications/stream`)를 구현해 줘. 관리자가 새 글을 쓰거나 알림 발송을 요청하면 이 스트림을 통해 클라이언트(웹)로 즉시 데이터가 푸시되도록 비동기 제너레이터를 작성해야 해. (모바일용 FCM 푸시 발송 로직은 지금 당장 제외해도 됨)
5. 프론트엔드에서 API를 호출하고 SSE를 수신할 수 있도록 `main.py`에 CORS 설정(localhost 허용)을 반드시 추가해 줘.

### 🔵 2단계: 웹 클라이언트 및 관리자 페이지 구현 (React + Vite)
1. `admin_web/` 디렉토리 내에 블로그 관리를 위한 UI(게시판 관리, 게시글 리스트, 작성/수정 폼)를 구현해 줘.
2. API 연동을 모듈화하고 관리자 UI를 완성해 줘.
3. **[중요]** 프론트엔드 UI를 작업할 때는 **반응형 웹(Responsive UI)**이 필수야. 데스크톱뿐만 아니라 태블릿과 스마트폰 해상도에서도 뷰가 깨지지 않고 자연스럽게 스택(Stack)되도록 TailwindCSS의 반응형 유틸리티 클래스(`sm:`, `md:`, `lg:`)를 적극적으로 사용해 줘.
4. 프론트엔드 단에 SSE 수신 로직(EventSource)을 연동해서, 서버에서 알림 이벤트가 넘어오면 화면 우측 하단에 토스트(Toast) 메시지로 띄워주는 기능을 추가해 줘.


---

# 📄 `docs/prompts/03_mobile_app.md`

[명령어: 이 작업은 `mobile/` 디렉토리를 생성한 뒤 수행하세요. 사전에 `00_master_prompt.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 React Native (Expo) 모바일 앱의 뼈대와 핵심 UI(차트, 스크리너)를 구현하는 것입니다.

## [실행 단계 - Step by Step]
1. **초기화**: `stock_app/` 루트에서 `npx create-expo-app mobile` 명령어로 앱을 생성하고, 패키지들을 설치하세요.
2. **라이브러리 셋업**: `NativeWind` (TailwindCSS), `zustand`, `react-native-echarts`, `@expo/vector-icons`를 설치 및 설정하세요.
3. **[핵심] 빌드 및 환경 분리**: `eas.json`을 생성하여 `development`와 `production` 빌드 프로필을 구성하세요. (클라우드 빌드와 `--local` 로컬 빌드 양쪽 모두 완벽하게 동작하도록 구성해야 합니다.) 그리고 `app.json`을 `app.config.js`로 변경한 뒤, 환경변수(`process.env.APP_ENV`)에 따라 앱 이름(예: 'StockApp Dev', 'StockApp')과 `bundleIdentifier`(`com.stockapp.dev`, `com.stockapp`)가 동적으로 변경되어 기기에 동시 설치될 수 있도록 세팅하세요.
4. **네비게이션**: `expo-router`를 활용해 하단 탭(홈, 스크리너, 블로그, 관심종목, 내정보) 구조의 레이아웃을 작성하세요.
5. **스크리너 필터 UI**: '스크리너 탭'에서 Zustand 스토어를 생성해 필터 조건(예: RSI 범위 슬라이더) 상태를 관리하도록 하세요.
6. **ECharts 연동 및 드로잉**: '종목 상세 화면'에 `react-native-echarts` 캔들스틱 차트를 렌더링하세요.
   - **[필수] 차트 드로잉 도구 지원**: 모바일 환경에서도 사용자가 차트 위에 선을 긋거나 분석할 수 있도록 다음 도구를 툴바 형태로 제공하세요.
     1) **수평선 (Horizontal Line)**: 터치 시 해당 위치의 가격 표시.
     2) **이중 추세선 (Parallel Channel)**: 캔들 상/하단 연결 및 중심선 표시.
     3) **텍스트 박스**: 텍스트 메모 추가.
     4) **사각형 박스**: 밀집 구역 강조.
7. **API 호출**: `.env.development`의 API 주소를 호출하여 모의 데이터를 받아 차트 위에 이동평균선(MA)과 볼린저 밴드를 Overlay 하세요.
8. **검증**: `npx expo start` 후 터미널 로그와 렌더링 상태를 확인하며 디버깅하세요.


---

# 📄 `docs/prompts/04_admin_web.md`

[명령어: 이 작업은 `admin_web/` 디렉토리를 생성한 뒤 수행하세요. 사전에 `00_master_prompt.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 React (Vite) 기반의 관리자 웹 프론트엔드를 구축하는 것입니다.

## [실행 단계 - Step by Step]
1. **초기화**: `stock_app/` 루트에서 `npm create vite@latest admin_web -- --template react-ts` 명령어로 프로젝트를 생성하세요.
2. **라이브러리 셋업**: `cd admin_web` 후, `TailwindCSS`, `Tremor` (대시보드 UI용), `TipTap` (에디터용), `echarts-for-react`, `zustand`, `@tanstack/react-query`를 설치하세요.
3. **레이아웃 및 상태 관리**: `zustand`를 사용하여 전역 상태(로그인 여부, 사이드바 토글)를 관리하는 스토어를 구성하고 좌측 사이드바(회원관리, 블로그 관리, 통계) 레이아웃을 작성하세요.
4. **블로그 에디터 구현**: '블로그 관리' 페이지에서 `TipTap` 위지윅 에디터를 구현하세요.
5. **[핵심] 차트 스냅샷 기능 (종목 검색 및 기간 설정)**: 
   - 에디터에 '차트 삽입' 버튼을 만드세요.
   - 버튼 클릭 시 **종목 검색 모달**이 뜨고, 검색창에서 **국내외 모든 주식 종목과 나라별 주요 지수**를 검색할 수 있어야 합니다. (백엔드 `stock_api` 연동)
   - 종목을 선택한 후 **조회 기간(시작일/종료일)**을 입력하면, 해당 기간의 차트 데이터를 불러와 `echarts-for-react`로 모달 내에 렌더링하세요.
   - **[핵심] 차트 드로잉(Drawing) 도구 지원**: 캡처 전, 사용자가 차트 위에 직접 분석을 남길 수 있도록 다음 4가지 그리기 도구를 제공하세요.
     1) **수평선**: 추가 시 해당 라인의 **가격대**가 축에 표시되어야 합니다.
     2) **이중 추세선(채널)**: 캔들의 상단/하단을 연결하는 양방향 평행 추세선을 한 번에 그리고, 두 선 사이의 **중심선**이 자동으로 표시되는 도구입니다.
     3) **텍스트 박스**: 차트 위에 자유롭게 텍스트 주석을 입력할 수 있어야 합니다.
     4) **사각형 박스**: 특정 캔들 밀집 구역이나 돌파 구역을 강조하기 위한 사각형 하이라이트 박스 기능입니다.
   - 렌더링된 차트(드로잉 포함)에서 `echartsInstance.getDataURL()` API를 호출하여 Base64 캡처 이미지로 변환한 뒤, 이를 TipTap 에디터 본문에 `<img>` 태그로 삽입하는 로직을 구현하세요.
6. **API 연동**: `react-query`를 사용하여 작성된 블로그 데이터를 백엔드 `/api/v1/blogs` (게시판/게시글 등록 API)로 POST 전송하는 코드를 작성하세요.
7. **검증**: `npm run dev` 실행 후 터미널 에러가 없는지 자가 점검하세요.


---

# 📄 `docs/prompts/05_user_web.md`

# 5. 일반 유저 웹 클라이언트 (User Web)

당신의 임무는 모바일 앱과 별개로 일반 사용자(User)가 PC 및 모바일 웹 브라우저에서 접근할 수 있는 **"일반 웹 클라이언트"**를 개발하는 것입니다. 아래 요구사항을 바탕으로 프론트엔드를 구축하세요.

### 💻 1. 프로젝트 셋업 및 구조
1. 루트 디렉토리에 `web_client/` 폴더를 생성하고 `React (Vite)` + `TailwindCSS` 환경을 구축하세요.
2. 상태 관리를 위해 `Zustand`를 셋팅하고, 백엔드 API와의 통신을 위해 `axios` 또는 `fetch` 래퍼(Wrapper)를 작성하세요.
3. `admin_web`과는 완전히 분리된 프로젝트이며, 일반 사용자(B2C)를 위한 아름답고 세련된 UI를 설계해야 합니다.

### 📱 2. 반응형 웹(Responsive UI) 필수 적용
1. 모바일 앱 환경을 완전히 대체할 수 있도록 데스크톱, 태블릿, 모바일 기기의 해상도를 모두 고려한 **반응형 웹(Responsive Web)**으로 설계하세요.
2. TailwindCSS의 브레이크포인트(`sm:`, `md:`, `lg:`)를 사용하여 화면 크기에 따라 컴포넌트가 적절히 재배치되도록 구현해야 합니다.
3. 예: 주식 스크리너 화면의 경우 데스크톱에서는 좌우 분할(Split View) 뷰를 사용하고, 모바일 해상도에서는 상하 스크롤 기반 아코디언(Accordion) 뷰로 렌더링하세요.

### 🔔 3. 실시간 알림 (SSE) 연동
1. 모바일 앱과 달리 웹에서는 푸시(Push) 서비스(FCM/APNs)를 사용할 수 없으므로, 백엔드의 SSE(Server-Sent Events) 엔드포인트(`/api/v1/notifications/stream`)와 통신하여 실시간 알림을 받아야 합니다.
2. 브라우저의 기본 `EventSource` API를 사용하여 백엔드와 연결을 유지하세요.
3. 알림 이벤트가 발생하면 사용자가 즉각 인지할 수 있도록 화면 우측 하단이나 상단에 **토스트(Toast) 메시지**로 띄워주세요.

### 📈 4. 주요 기능 화면
1. **스크리너 및 차트 화면**: 
   - 필터(PER, MA20 등)를 조작하여 검색된 종목 리스트를 띄우고, 각 종목을 클릭하면 `react-native-echarts` 또는 순수 `echarts`를 활용한 웹용 대형 캔들 차트를 렌더링하세요.
   - **[필수] 전문 차트 드로잉(Drawing) 도구**: 사용자가 차트 위에 직접 분석할 수 있도록 다음 기능을 툴바 형태로 제공해야 합니다.
     1) **수평선 (Horizontal Line)**: 가격축에 해당 가격이 명확히 표시되어야 함.
     2) **이중 추세선 (Parallel Channel)**: 캔들의 상단/하단을 연결하는 두 개의 추세선과 그 사이의 중심선을 동시에 렌더링하는 기능.
     3) **텍스트 박스 (Text Annotation)**: 차트 내 자유 텍스트 입력.
     4) **사각형 박스 (Rectangle Box)**: 특정 구간 강조용 사각형 영역 그리기.
2. **게시판 및 블로그 화면**: 백엔드의 `apps/blog/` API와 연동하여 커뮤니티 글을 읽고, 댓글을 달 수 있는 반응형 뷰를 구현하세요.

위 내용에 따라 코드를 작성하고, 로컬에서 `npm run dev` 명령어로 개발 서버를 띄워 테스트할 수 있도록 준비해 줘.


---

# 📄 `docs/prompts/06_stock_api.md`

# 6. 주식 데이터 제공 마이크로서비스 (Stock API)

당신의 임무는 앱 및 웹(어드민 포함) 클라이언트에 주식 차트 데이터와 종목 검색 기능을 제공하는 `stock_api` 백엔드 서버를 구축하는 것입니다.

### 🟢 1단계: Backend Stock API 기본 셋업
1. `backend/apps/stock_api/` 디렉토리에 주식 정보 제공을 위한 독립 FastAPI 서버를 구축하세요. (`main.py`, `routers/`, `schemas.py`, `services.py`)
2. 데이터베이스 접근은 ClickHouse(`daily_prices`)와 PostgreSQL(종목 메타데이터)을 동시에 사용해야 할 수 있으므로, 적절한 DB Connection 로직을 작성하세요.

### 🔍 2단계: 글로벌 종목 및 지수 통합 조회 (GraphQL)
어드민 웹의 '차트 삽입' 기능 및 클라이언트 앱에서 사용할 수 있도록 아래 스키마를 `Strawberry`를 이용한 **GraphQL**로 구현하세요. 클라이언트가 불필요한 데이터를 요청하지 않도록 방지하는 것이 목적입니다.
1. **검색 리졸버** (`query searchStocks(query: String!)`):
   - 검색어(`query`)를 기반으로 **국내 주식, 해외(미국 등) 주식, 그리고 나라별 주요 지수(KOSPI, S&P500, NASDAQ 등)**를 모두 통합 검색하여 리턴하세요.
2. **차트 데이터 리졸버** (`query getChartData(symbol: String!, startDate: String!, endDate: String!, bbStdDev: Float = 2.0)`):
   - 클라이언트에서 요청한 특정 종목(`symbol`) 혹은 지수의 데이터를 ClickHouse에서 조회하세요.
   - 요청받은 **조회 기간(start_date ~ end_date)** 범위 내의 OHLCV 일봉 데이터를 기본으로 반환하세요.
   - **[최우선 지표 반환]**: 클라이언트가 선택적으로 가져갈 수 있도록 아래 지표들을 GraphQL Object Type에 반드시 포함하세요.
     - **거래량(Volume) 및 가격대별 매물대(Volume Profile)**
     - **이동평균선(MA5, 20, 50, 120)** 및 현재 배열 상태(**정배열/역배열 플래그**)
     - **볼린저 밴드**: 인자로 전달받은 `bbStdDev`(표준편차 배수) 값을 적용하여 상/하단 밴드를 동적으로 계산 또는 조회하여 반환하세요.

### 📈 3단계: 한국투자증권 실시간/과거 데이터 연계
- 만약 ClickHouse에 저장되지 않은 과거 데이터나 지수 데이터가 필요하다면, 파이프라인에서 작성했던 **자체 Custom API Client** (`requests` 기반) 로직을 재사용하여 한국투자증권 OpenAPI에서 데이터를 실시간 페칭(Fetching)한 뒤 응답하는 Fallback 로직을 구현하세요.


---

# 📄 `docs/ROADMAP.md`

# Stock App 로드맵 & 진행 현황

> 최종 업데이트: 2026-08-05

한국투자증권 API 기반 주식 데이터 파이프라인 + 블로그/커뮤니티 + 관리자/유저 웹/모바일 풀스택 모노레포의 진행 현황과 향후 단계.

---

## ✅ 완료된 작업

### 인프라 / 아키텍처
- [x] Docker DB 3종 (PostgreSQL 5432 · Redis 6379 · ClickHouse 8123) — `docker-compose.dev.yml`
- [x] 백엔드 MSA(모듈러 모놀리식): `auth`(8001) · `blog`(8000) · `stock_api`(8002) · `collector`(Celery) + `shared`
- [x] FastAPI + async SQLAlchemy + Alembic, `uv` 관리, 서비스 간 공유 JWT_SECRET

### 인증
- [x] 관리자 로그인(JWT, bcrypt) + 관리자 시드(`admin@stock.app`)
- [x] 임시 게스트 로그인 `POST /auth/guest` (닉네임 → FREE 유저 upsert) — 이후 OAuth로 스왑 가능

### 블로그 (백엔드 + 어드민)
- [x] 게시판/게시글/댓글 CRUD
- [x] 게시판별 댓글 on/off 토글 (`comments_enabled`)
- [x] TipTap 리치 에디터, 반응형 레이아웃 + 사이드바
- [x] 새 글 실시간 알림: 웹 SSE(Redis pub/sub) + 모바일 FCM(Mock)

### 주식 API (stock_api, GraphQL)
- [x] `searchStocks`(국내외/지수 통합검색) · `getChartData`(온더플라이 시드 데이터)
- [x] 지표: MA5/20/50/120, 정배열/역배열, 볼린저(σ 가변), 매물대(Volume Profile)

### 어드민 차트 삽입 (핵심 기능)
- [x] 종목 검색 → 기간 → 실차트 렌더 → `getDataURL` 캡처 → 본문 삽입
- [x] 가격축 우측 · 매물대 좌측 · 볼린저 실선 · σ 숫자입력 · 매물대 표시 토글
- [x] 드로잉 4종(수평선/이중추세선/사각형/텍스트) + ESC 취소, 데이터좌표 기반 캡처 포함

### web_client (일반 유저 웹)
- [x] 블로그 조회(목록/상세/댓글) + SSE 토스트
- [x] 임시 로그인(닉네임) + 댓글 작성

### 문서
- [x] 기능별 설계 스펙(`docs/superpowers/specs/`)
- [x] README 작업 재개(Resume) 가이드 & 환경 점검

---

## 🔜 향후 단계 (로드맵)

### Phase 1 — 데이터 파이프라인 (실데이터 기반)
> stock_api의 온더플라이(가짜)를 실데이터로 교체하는 기반. 스크리너·실차트의 전제.

**(a) 수직 슬라이스 — 005930 국내 일봉 [완료 ✅ 2026-07-21]**
- [x] KIS OpenAPI Custom Client (`requests` 동기 + OAuth 토큰 Redis 공유 캐시, 5xx만 재시도)
- [x] 국내 일봉 수집(수정주가, **시장코드 UN=KRX+넥스트레이드 통합** → MTS 차트와 값 일치) → MA5/20/50/120 → ClickHouse 멱등 적재(`ReplacingMergeTree`)
- [x] Celery 태스크 `collector.collect_daily_ohlcv`(겹침창 today-30d~+2d) — 멱등 검증
- [x] stock_api `getChartData` 하이브리드(수집종목=CH, 나머지=온더플라이)

**(b) 확장 — 다음 슬라이스**
- [x] 국내 전종목 루프 + 레이트리밋 + 실패격리 `collector.collect_all_daily` — 마스터 소스 무관 설계(`stock_master`), 종목별 try/except 격리, fallback 20종목 검증(18적재·상폐종목 무시)
- [x] 전종목 마스터 로더 — KRX `.mst` 다운로드/파싱(`kis/master.py`) + fallback. 매 수집마다 재로드해 신규상장/상폐 자동반영. `STOCK_MASTER_SOURCE=mst|fallback|auto`
- [x] Celery beat 스케줄 — 매일 20:30(NXT 애프터마켓 종료 후) `collect_all_daily` 자동 수집
- [x] 과거 백필(청킹 수집) `collector.backfill_domestic_daily` — 전체 시계열 MA 일괄계산(MA120 정합), 005930 14개월 검증(291행·MA120 172행)
- [x] 전종목 백필 확장 `collector.backfill_all_daily`(레이트리밋 적용) — 로컬 실행 검증(3,926종목·107.6만행·MA120 61.8만행)
- [x] `.mst` 실환경 검증 — URL 정정(dws.co.kr) + **UN 빈응답 시 J 폴백**(NXT 미상장 종목 누락 해결, 608→3,926종목)
- [x] worker+beat 가동(매일 20:30 자동수집) + ClickHouse 백업/복원 스크립트(`docs/deployment/`)
- [x] 차트 지표 lookback 버퍼 — 짧은 구간 뷰에서도 MA120 표시(`getChartData`)
- [x] **종목 마스터 `stock_meta` 일원화** — `.mst`→stock_meta 동기화(상폐 is_active=false), collector 수집대상·stock_api 검색/차트해석이 단일 마스터 사용. 미국/지수는 seed 하이브리드 유지(`shared/stock_meta_repo.py`)
- [ ] 성능: 동기 순차 → async 병렬(aiolimiter) 승격(전종목 수집 ~1시간 단축)
- [ ] 해외 주식/지수, 재무데이터(PER/PBR/ROE) 연동
- [ ] 정배열/역배열·매물대의 CH 컬럼 영속화(스크리너 성능용)

### Phase 2 — 스크리너
- [ ] `stock_api` 스크리너 리졸버/엔드포인트(필터 조합)
- [ ] 프리셋(거래량급증/골든크로스/과매도/신고가) + 커스텀 필터(볼린저 σ·정/역배열·매물대·거래량·재무)
- [ ] 결과 카드 UI + 정렬/편집, 차트 상세(웹 스플릿뷰)

### Phase 3 — web_client 확장
- [ ] 종목 상세/차트 화면 (어드민 차트+드로잉 컴포넌트 재사용)
- [ ] 소셜 로그인(카카오/구글) 실연동 → 임시 로그인 대체

### Phase 4 — 모바일 앱 (Expo) *(초기화 완료)*
- [x] 앱 셋업 — Expo SDK 57/RN 0.86, expo-router 하단 5탭(홈/스크리너/블로그/관심종목/내정보), **Unistyles v3** 테마 스타일링(상승=빨강/하락=파랑, adaptiveThemes), zustand. `app.config.js`로 dev/prod 앱이름·bundleId 동적 분리(`StockApp Dev`/`com.stockapp.dev` ↔ `StockApp`/`com.stockapp`), `eas.json` dev/preview/prod 프로필, `EXPO_PUBLIC_*` env 분리. 검증: tsc·expo-doctor 21/21·expo config
- [ ] 블로그/스크리너/차트 화면 + 차트 드로잉 (현재 각 탭은 플레이스홀더)
- [ ] 실제 FCM 푸시(현재 Mock 대체)

### Phase 5 — 실시간 트레이딩 게임 (Trading Game) & 에듀테인먼트
- [ ] **마스터 기획 완료** (`docs/trading_game_plan.md`)
- [ ] 1달 1종목 고정 시즌제 & 가상 1,000만 원 지급
- [ ] 한투 실시간 WebSocket 수집 데몬 (`H0STCNT0`) + Redis Pub/Sub 중계
- [ ] 원클릭 즉시 체결 (BUY/SELL, 롱/숏, 1x~5x 레버리지, TP/SL 자동 청산)
- [ ] Redis ZSET 기반 실시간 랭킹 (Top 100) & 말일 명예의 전당 아카이빙
- [ ] 관리자 데일리 스마트 코치 (모닝 시황/지지·저항선 + 이브닝 마감 복기) via `admin_web`
- [ ] 24시간 교육 모듈: 인게임 실시간 넛지, 듀오링고형 퀘스트, 야간 10초 차트 퀴즈

### 상시 백로그
- [ ] 이중추세선 조작 방식 재정의(대기 중)
- [ ] 테스트(pytest / Vitest / Playwright)
- [ ] 실 FCM 전환(`PUSH_BACKEND=fcm` + 자격증명)

---

## 참고 문서
- **트레이딩 게임 마스터 기획: `docs/trading_game_plan.md`**
- 아키텍처: `docs/architecture_plan.md`
- 스크리너 기획: `docs/screener_plan.md`
- 기능별 프롬프트: `docs/prompts/`
- AMS 참고 분석: `docs/ams-reference/`
- 설계 스펙: `docs/superpowers/specs/`



---

# 📄 `docs/run_and_deploy.md`

# 실행 & 배포 가이드 (Run & Deploy)

일상 운영 **빠른 참조**. 로컬에서 앱을 어떻게 띄우고, 서버(미니PC)에 어떻게 배포하는지 한 곳에 모았다.

> **더 깊은 문서**
> - 로컬 상세(포트·기능별 조합·DB 접속정보): [`../README.md`](../README.md)
> - Windows 환경 개발 셋업 가이드: [`windows_setup.md`](./windows_setup.md)
> - 서버 **최초 1회** 부트스트랩(러너 등록·시크릿·Cloudflare·스키마): [`server_setup.md`](./server_setup.md)
> - SSH 터널(cloudflared·Termius): [`cloudflare_termius_guide.md`](./cloudflare_termius_guide.md)
> - DB 접속(DataGrip/DBeaver, 개발서버 터널 포함): [`db_access.md`](./db_access.md)
> - 아키텍처 제약: [`claude_system_context.md`](./claude_system_context.md)

---

## A. 로컬 개발 실행

### 0. 준비물
Docker (또는 WSL2 Docker Engine) · **uv**(백엔드 파이썬) · Node 18+(프론트).
- **버전 매니저 빠른 참조**: Java `vfox use -g java@17.0.2+8` · Python `conda activate stock_app` · Node `nvm use 20` (상세: [`windows_setup.md`](./windows_setup.md))

### 1. DB 선택 — 둘 중 하나
| 방식 | 명령/설정 | 비고 |
|---|---|---|
| **(a) 완전 로컬** | `docker-compose -f docker-compose.dev.yml up -d` | postgres 5432 · clickhouse 8123 · redis 6379. `.env.development`의 DB를 `localhost:5432`/`8123`로 |
| **(b) 개발서버(미니PC) DB 사용** | `./scripts/dev-db-tunnel.sh` (별도 터미널 유지) | `localhost:15432→PG`, `18123→CH` 포워딩. **Redis는 로컬 유지**. `.env.development`는 이미 15432/18123을 가리킴 |

> (b) 상세·주의(공유 DB 스키마 변경, cloudflared 2222 선행)는 README "로컬 개발 → 개발서버 DB(SSH 터널)" 참조.
> 💡 **Windows 빠른 실행 스크립트 (`scripts/`)**:
> - DB 인프라 시작/종료: `scripts\start-infra.cmd` / `scripts\stop-infra.cmd`
> - 전체 서비스(백엔드 3개 + 웹 2개) 원클릭 기동: `scripts\start-services.cmd`

### 2. 백엔드 (uv — 필요한 것만 별도 터미널/백그라운드)
```bash
cd backend
uv sync                                                    # 최초/의존성 변경 시
uv run uvicorn apps.auth.main:app      --reload --port 8001   # 인증(로그인/JWT)
uv run uvicorn apps.blog.main:app      --reload --port 8000   # 블로그(게시판/글/댓글/SSE)
uv run uvicorn apps.stock_api.main:app --reload --port 8002   # 주식 GraphQL(/graphql)
uv run celery -A apps.collector.celery_app worker --loglevel=info   # 수집/알림 워커(선택)
```
> ⚠️ 로컬 포트는 auth **8001** · blog **8000** · stock **8002** (운영 compose는 blog가 8003).

### 3. 마이그레이션·시드 (스키마/계정 변경 시에만)
```bash
cd backend
uv run alembic upgrade head                 # PostgreSQL 스키마
uv run python -m shared.clickhouse_schema   # ClickHouse 테이블(멱등)
uv run python -m apps.auth.seed_admin       # 관리자(admin@stock.app / admin1234)
```
> ⚠️ **개발서버 DB(1-b)에 붙은 상태**로 실행하면 **개발서버의 스키마·계정이 바뀐다**(공유 DB). 로컬 전용 변경은 (1-a)에서.

### 4. 프론트
```bash
cd admin_web  && npm install && npm run dev   # 관리자 http://localhost:5173
cd web_client && npm install && npm run dev   # 유저웹 http://localhost:3000
```

### 5. 기능별 "무엇을 띄우나"
| 하고 싶은 것 | 필요한 서비스 |
|---|---|
| 관리자 로그인 + 게시판 관리 | DB + auth(8001) + blog(8000) + admin_web(5173) |
| 어드민 종목검색/차트 삽입 | 위 + stock_api(8002) |
| 유저 웹 조회 | DB + blog(8000) + web_client(3000) |
| 실시간 알림(SSE)·수집 | 위 + Redis + celery worker |

### 6. 종료
```bash
for p in 8001 8000 8002 5173 3000; do lsof -ti:$p | xargs kill -9 2>/dev/null; done
pkill -f "celery.*worker"
docker compose -f docker-compose.dev.yml stop     # 로컬 DB 정지(데이터 유지)
```

---

## B. 서버 배포 (미니PC)

### 0. 최초 1회 부트스트랩
러너 등록·호스트 시크릿(`/opt/stock_app/env/.env.production`)·Cloudflare Tunnel·스키마 부트스트랩은 **[`server_setup.md`](./server_setup.md)** 를 따른다(딱 한 번). 이후 배포는 아래 파이프라인이 자동/수동 처리.

### 1. 배포 파이프라인 — 서버/웹 분리
GitHub Actions self-hosted 러너(미니PC)에서 동작. **대상별로 두 워크플로**로 나뉘어, 각자 지정 서비스만 `docker compose up -d --build` 한다(나머지 컨테이너·볼륨 보존).

| 워크플로 | 자동 트리거(경로) | 배포 대상 |
|---|---|---|
| `.github/workflows/deploy-server.yml` | `backend/**`, `docker-compose.prod.yml` | auth/stock/blog API + celery worker/beat (DB는 depends_on) |
| `.github/workflows/deploy-web.yml` | `web_client/**`, `admin_web/**`, `docker-compose.prod.yml` | web_client(3000) + admin_web(3001) |

### 2. 자동 배포 (경로 기반 push)
`dev`에서 작업 → `main` 병합 → push. **변경된 경로에 해당하는 워크플로만** 실행된다(둘 다 바뀌면 둘 다).
```bash
git checkout main && git merge dev && git push origin main
# backend/** 변경 → Deploy Server / web_client·admin_web/** 변경 → Deploy Web
```
> 워크플로 파일(`.github/**`)만 바꾼 push는 어느 필터에도 안 걸려 배포를 트리거하지 않는다(수동으로 실행·테스트).

### 3. 수동 배포 (workflow_dispatch)
**전제**: 워크플로가 origin `main`에 올라가 있어야 UI에 버튼이 뜬다(최초 push 이후 활성). 실행엔 저장소 **write 권한** 필요.

- **웹 UI**: 저장소 → **Actions** → 좌측에서 `Deploy Server` 또는 `Deploy Web` 선택 → **Run workflow** → Branch `main` → 실행.
- **gh CLI**:
  ```bash
  gh workflow run deploy-server.yml --ref main   # 서버만
  gh workflow run deploy-web.yml    --ref main   # 웹만
  gh run watch                                   # 진행 확인
  ```
  > `gh auth status`로 **write 권한 계정** 확인(권한 없으면 거부).

### 4. 배포 시 주의
- **프론트 배포는 백엔드/수집 워커를 건드리지 않는다**(분리의 핵심). 반대도 동일.
- **수집 시간(매일 20:30) 중 서버 배포 지양** — 워커 컨테이너 recreate로 수집이 끊긴다. 필요하면 **수동 배포로 조용한 시간에**.
- **최초 배포 후 스키마 부트스트랩 1회** 필수(안 하면 전 요청 500) → server_setup.md §7.
- **DB 포트(5432/8123/9000/6379)는 LAN 전용** — Cloudflare 터널에 절대 노출 금지.

### 5. 배포 검증
```bash
docker compose -f docker-compose.prod.yml ps                 # 컨테이너 up/healthy
curl -s https://api.haezean.com/graphql -H 'content-type: application/json' -d '{"query":"{ __typename }"}'
# 프론트/로그인 CORS 확인
curl -s -D - -o /dev/null -X OPTIONS https://auth.haezean.com/api/v1/auth/login \
  -H 'Origin: https://admin.haezean.com' -H 'Access-Control-Request-Method: POST' | grep -i allow-origin
```


---

# 📄 `docs/screener_plan.md`

# 주식 스크리너(Screener) 상세 기획서

## 🎯 1. 스크리너 목표 및 컨셉
모바일 환경에 최적화된 직관적인 UI를 제공하여, 초보자부터 전문가까지 원하는 조건의 주식을 빠르게 필터링(검색)할 수 있는 핵심 기능입니다. ClickHouse의 강력한 연산 속도를 활용하여 수십 가지 조건식을 조합해도 0.1초 이내에 결과를 반환하도록 설계합니다.

---

## 📱 2. 프론트엔드 (Mobile UI/UX) 기획

### A. 추천 스크리너 (프리셋 제공)
초보자를 위해 미리 세팅된 강력한 조건식을 제공합니다. 사용자는 터치 한 번으로 결과를 볼 수 있습니다.
*   **🔥 거래량 급증**: 전일 대비 거래량이 300% 이상 폭발한 종목
*   **📈 골든크로스**: 20일 이동평균선이 60일 이동평균선을 상향 돌파한 종목
*   **💧 과매도 낙폭과대**: RSI(14) 지표가 30 이하로 떨어진 반등 노림 종목
*   **👑 신고가 돌파**: 최근 52주 최고가를 경신한 종목

### B. 나만의 조건 검색 (커스텀 스크리너)
전문가를 위한 상세 필터링 UI입니다. 슬라이더와 토글버튼으로 조건을 조합합니다.
*   **기본 필터**: 시장(KOSPI/KOSDAQ), 주가 범위(동전주 제외 등), 시가총액, 거래대금
*   **재무 필터 (Fundamental)**: 
    *   **가치평가**: PER (저평가 구간 설정), PBR (청산가치 이하 등)
    *   **수익성 및 배당**: ROE (자기자본이익률), 배당수익률 (예: 5% 이상 고배당주)
*   **기술적 필터 (최우선 핵심 지표)**:
    *   **볼린저 밴드 (Bollinger Bands)**: 밴드 상/하단 돌파 및 밴드폭 기반 밀집 파악. **[중요] 사용자가 표준편차(Standard Deviation) 배수를 직접 설정(예: 2.0, 3.0 등)할 수 있어야 합니다.**
    *   **이동평균선 배열**: **정배열(Perfect Order)** 및 **역배열(Reverse Order)** 상태 필터링 (MA5, MA20, MA50, MA120 활용)
    *   **이동평균선(MA)**: 개별 이평선 상향/하향 돌파, 이격도, 골든/데드 크로스
    *   **매물대 (Volume Profile)**: 가격대별 매물 집중 구간을 파악하여 지지/저항선을 필터링하는 기능
    *   **거래량 (Volume)**: 일정 기간 평균 거래량 대비 급증(N% 이상) 필터링 및 절대 거래량 기준 필터링
    *   **모멘텀 지표 (보조)**: RSI 밴드 설정, MACD 시그널 교차 여부
*   **결과 화면**: 조건에 맞는 종목 리스트 출력 (종목명, 현재가, 등락률, 거래량, PER 등). 종목 클릭 시 차트 상세 화면으로 이동.

---

## ⚙️ 3. 백엔드 및 DB 연동 기획

### A. API 설계 (`FastAPI`)
*   **`POST /api/v1/stocks/screen`**
    *   **요청(Request Payload)**: 프론트엔드에서 조합한 필터 조건을 JSON 형태로 전송
    *   **응답(Response)**: 조건에 부합하는 종목 리스트와 간략한 시세 정보 반환

### B. 데이터베이스 쿼리 (`ClickHouse`)
스크리너 쿼리는 ClickHouse의 최신 파티션 데이터를 대상으로 실행됩니다.
```sql
-- (예시) 볼린저 밴드 하단 터치 우량주 스윙 스크리너
SELECT p.ticker, p.close, p.bb_lower, f.per, f.roe
FROM daily_prices p
JOIN fundamentals f ON p.ticker = f.ticker
WHERE p.date = (SELECT MAX(date) FROM daily_prices)
  AND p.close <= p.bb_lower -- 현재가가 볼린저 밴드 하단선 이하 (낙폭 과대)
  AND p.close > p.ma120    -- 장기 추세(120일선)는 살아있음
  AND f.per <= 10.0        -- 저평가 (PER 10 이하)
  AND f.roe >= 10.0        -- 우량주 (ROE 10 이상)
ORDER BY f.per ASC
LIMIT 50;
```

---

## 🎯 4. 최종 기획 확정 사항
대표님의 피드백에 따라 스크리너의 방향성이 다음과 같이 확정되었습니다.
1. **일봉(Daily) 기반 중장기 스윙 스크리너**: 실시간 초단타(스캘핑)보다는 매일 장 마감(혹은 실시간 일봉 반영) 기준으로 스윙/중장기 투자에 적합한 추세 매매 종목을 발굴합니다.
2. **재무 데이터(Fundamental) 필수 연동**: 차트뿐만 아니라 회사의 본질적 가치(PER, PBR, ROE, 배당수익률 등)를 함께 필터링할 수 있도록 백엔드 데이터 수집 파이프라인(Celery)에 재무제표 크롤링/API 연동이 추가됩니다.

---

## 🎨 5. 스크리너 결과 화면 (UI/UX) 기획
단순히 종목명만 나열하는 기존 증권사 앱과 차별화하기 위해, 핀테크 특유의 **직관적이고 화려한 카드형 UI(다크 모드 + 글래스모피즘)**로 설계합니다.

### 📱 스크리너 결과 카드(Card) 구성 요소
검색된 종목들이 상하 스크롤 리스트 형태로 노출되며, 각 카드는 다음 요소들을 포함합니다.

1. **기본 시세 및 트렌드**
    *   **종목명 & 티커**: 예) `삼성전자 (005930)`
    *   **현재가 및 등락률**: 상승은 강렬한 레드(또는 그린), 하락은 블루 계열로 하이라이팅. (예: `72,000원 (+2.4%)`)
    *   **미니 스파크라인(Sparkline)**: 카드 우측에 최근 5일간의 주가 흐름을 보여주는 **작은 미니 차트**를 배치하여, 상세 페이지에 들어가지 않고도 추세를 직관적으로 파악할 수 있게 합니다.

2. **매칭 조건 뱃지 (Highlight Badges)**
    *   유저가 왜 이 종목을 보게 되었는지(어떤 조건에 부합했는지)를 **컬러 뱃지** 형태로 달아줍니다.
    *   예) 조건식에 맞게 `[PER 8.5]`, `[RSI 28]`, `[BB 하단 터치]` 등의 뱃지가 카드 하단에 노출됩니다.

3. **차트 바로보기 (Expandable & Split View)**
    *   **모바일 (아코디언 UI)**: 종목 카드를 터치하면 상세 페이지로 넘어가지 않고, 그 자리에서 카드가 아래로 확장(Expand)되며 **인터랙티브 캔들 차트(Candlestick Chart)**가 즉시 나타납니다. 다른 페이지로 이동하는 피로감을 없애고 검색된 여러 종목의 차트를 스크롤하며 빠르게 훑어볼 수 있습니다.
    *   **웹 클라이언트 (Split View)**: 일반 유저용 웹 브라우저 환경에서는 넓은 화면을 활용하여 **좌/우 스플릿 뷰**를 제공합니다. 좌측에는 스크리너 검색 결과 리스트가, 우측에는 선택한 종목의 대형 차트와 보조지표가 실시간으로 렌더링되어 PC 주식 프로그램(HTS) 같은 전문적인 경험을 제공합니다.

4. **빠른 액션 버튼 (Quick Actions)**
    *   **관심 종목 담기 (⭐)**: 카드 우측 상단에 별모양 아이콘을 두어 즉시 워치리스트에 추가할 수 있도록 합니다.
    *   **상세정보 보기**: 호가창, 종목 토론방 등 전체 화면이 필요할 때 누르는 버튼을 확장된 차트 하단에 배치합니다.

5. **상단 컨트롤 바 (Top Bar)**
    *   **검색 결과 수**: "총 12개 종목이 검색되었습니다."
    *   **정렬(Sort) 기능**: '등락률순', '거래량순', 'PER 낮은순' 등으로 결과를 빠르게 정렬할 수 있는 드롭다운 필터를 제공합니다.
    *   **필터 수정(Edit)**: 기존에 설정한 슬라이더/조건식을 수정할 수 있도록 필터 바텀 시트(Bottom Sheet)를 띄우는 버튼입니다.


---

# 📄 `docs/server_setup.md`

# 미니PC 서버 최초 설정 런북 (Ubuntu 24.04)

> **범위**: 홈 서버(미니PC)에서 **딱 한 번** 수행하는 부트스트랩. 이후 배포는 `main` push → GitHub Actions가 자동 처리.
> **관련 문서**: [`run_and_deploy.md`](./run_and_deploy.md)(일상 실행·배포 빠른 참조) · [`deployment_guide.md`](./deployment_guide.md)(전체 아키텍처·트러블슈팅) · [`cloudflare_termius_guide.md`](./cloudflare_termius_guide.md)(SSH 터널·Termius) · [`claude_system_context.md`](./claude_system_context.md)(제약).
> **인그레스 원칙**: 외부 노출은 **Cloudflare Tunnel 전용**. Nginx/Traefik/Let's Encrypt/포트포워딩 금지.

전제: Ubuntu 24.04 + sudo · 도메인 `haezean.com` 이 Cloudflare에 연결됨 · GitHub 저장소 `kyuseokyi/stock_app` 접근 권한.

---

## 1. Docker + Compose v2 설치
```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 러너/사용자가 sudo 없이 docker 실행하도록 (재로그인 필요)
sudo usermod -aG docker $USER
```
> ⚠️ **재로그인(또는 `newgrp docker`)** 해야 그룹 반영. 안 하면 러너가 `permission denied ... docker.sock` 으로 실패한다.

---

## 2. GitHub Actions self-hosted runner 등록 (핵심 관문)
저장소 → **Settings → Actions → Runners → New self-hosted runner** → **Linux / x64** 선택.
화면에 나오는 **정확한 버전의 다운로드·`config.sh`·토큰 명령을 그대로** 복사해 서버에서 실행한다(토큰 유효 ~1시간).

```bash
# (GitHub이 제공하는 실제 명령을 사용 — 아래는 형태 예시)
mkdir ~/actions-runner && cd ~/actions-runner
# curl -o actions-runner-linux-x64-X.Y.Z.tar.gz -L https://github.com/actions/runner/releases/download/vX.Y.Z/actions-runner-linux-x64-X.Y.Z.tar.gz
tar xzf actions-runner-*.tar.gz
./config.sh --url https://github.com/kyuseokyi/stock_app --token <GITHUB이_준_토큰>

# 서비스로 상시 실행(부팅 시 자동)
sudo ./svc.sh install
sudo ./svc.sh start
```
확인: 저장소 Settings → Runners 에 러너가 **Idle(초록)** 으로 보이면 성공. `runs-on: self-hosted` 작업을 이 러너가 잡는다.
> ⚠️ 러너 실행 사용자가 **§1의 docker 그룹**에 있어야 한다.

---

## 3. 호스트 시크릿 디렉토리 (체크아웃 밖에 보관 — 반드시)
**왜**: 러너는 매 배포마다 `actions/checkout`이 `git clean -ffdx`를 돌려 **gitignore된 파일까지 삭제**한다. 체크아웃 안에 `.env.production`을 만들어도 **다음 배포에서 사라진다**. 그래서 시크릿은 체크아웃 밖 고정 경로에 두고, 워크플로가 매번 복사해 온다(§4에 반영됨).

```bash
# ⚠️ 소유자 = 러너 실행 사용자여야 한다. 워크플로의 cp 는 그 사용자로(sudo 없이) 실행되므로
#    root:root 로 두면 배포 시 "Permission denied"로 파일을 못 읽는다.
RUNNER_USER=summersnow            # 러너 서비스 실행 사용자로 교체(systemd 'Run as user' 값)
sudo mkdir -p /opt/stock_app/env
sudo chown -R "$RUNNER_USER:$RUNNER_USER" /opt/stock_app/env
sudo chmod 700 /opt/stock_app/env
```

### 3-1. `/opt/stock_app/env/.env.production` (앱 컨테이너용)
`backend/.env.example`을 복사하되 **아래를 반드시 바꾼다**. 특히 **DB 호스트는 `localhost`가 아니라 컨테이너 이름**(도커 네트워크 내부 통신).

```bash
sudo nano /opt/stock_app/env/.env.production
```
```ini
APP_ENV=production

# DB 호스트 = 컨테이너 이름 (localhost 아님!)
DATABASE_URL=postgresql+asyncpg://stock_user:<DB비번>@postgres:5432/stock_db
SYNC_DATABASE_URL=postgresql+psycopg2://stock_user:<DB비번>@postgres:5432/stock_db
REDIS_URL=redis://redis:6379/0
CLICKHOUSE_HOST=clickhouse
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<CH비번>
CLICKHOUSE_DB=stock_data

# 서비스 간 동일해야 함 — 강한 랜덤값으로
JWT_SECRET_KEY=<openssl rand -hex 32 결과>
JWT_ALGORITHM=HS256
JWT_EXPIRE_HOURS=12

ADMIN_EMAIL=admin@stock.app
ADMIN_PASSWORD=<강한 비번>

PUSH_BACKEND=mock

# 실데이터 수집: 실전키 + prod 모드 (비우면 Mock으로 폴백 — 성공처럼 보이는 깨진 배포)
KIS_MODE=prod
KIS_APP_KEY=<실전 앱키>
KIS_APP_SECRET=<실전 시크릿>
KIS_ACCOUNT_NO=
```
```bash
sudo chmod 600 /opt/stock_app/env/.env.production
```
> ⚠️ **DB 비번은 두 곳에서 일치해야 한다**: 위 `DATABASE_URL`/`CLICKHOUSE_PASSWORD` **와** §3-2의 `compose.env`. 한쪽만 강한 비번으로 두면 컨테이너 DB(기본값으로 초기화됨)에 앱이 **인증 실패**한다.

### 3-2. `/opt/stock_app/env/compose.env` (스토리지 분리 및 DB 설정)
`docker-compose.prod.yml`의 환경변수 치환(`${CLICKHOUSE_DATA_DIR}`, `${POSTGRES_PASSWORD}` 등)은 `backend/.env.production`이 아니라 **compose 프로젝트 루트의 `.env`**에서 읽습니다.

추가 SSD(`/Volumes/StockData`)로 대용량 시계열 DB 스토리지를 분리하거나 강한 비번을 쓸 때 사용합니다:
```ini
# --- [스토리지 분리 (추가 SSD 지정)] ---
CLICKHOUSE_DATA_DIR=/Volumes/StockData/clickhouse
POSTGRES_DATA_DIR=/Volumes/StockData/postgres
REDIS_DATA_DIR=/Volumes/StockData/redis

# --- [DB 인증정보 (선택)] ---
POSTGRES_USER=stock_user
POSTGRES_PASSWORD=<DB비번>      # §3-1 URL과 동일
POSTGRES_DB=stock_db
CLICKHOUSE_PASSWORD=<CH비번>    # §3-1과 동일
```
> 설정하지 않으면 기본 내장 Docker 볼륨(`clickhouse_data_prod` 등)과 기본 비밀번호를 사용합니다.

---

## 4. 워크플로의 시크릿 주입 (이미 반영됨 — 참고)
배포 워크플로(`deploy-server.yml`·`deploy-web.yml`)가 매 배포에서 `/opt/stock_app/env/.env.production`을 `backend/.env.production`으로 **복사(없으면 실패)**, `compose.env`가 있으면 루트 `.env`로 복사한다. → 시크릿은 git에 안 올라가고, 매 배포마다 호스트에서 주입된다.

---

## 5. Cloudflare Tunnel (인그레스)
`cloudflared` 설치:
```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```
[Cloudflare Zero Trust → Networks → Tunnels]에서 터널 생성 후, **Published application routes**에 3개 API 서브도메인을 추가(자세한 대시보드 절차는 `cloudflare_termius_guide.md` §3.1 참조):

| Hostname | Type | Service |
|---|---|---|
| `auth.haezean.com` | HTTP | `localhost:8001` (auth API) |
| `api.haezean.com` | HTTP | `localhost:8002` (stock API) |
| `blog.haezean.com` | HTTP | `localhost:8003` (blog API) |
| `app.haezean.com` | HTTP | `localhost:3000` (web_client) |
| `admin.haezean.com` | HTTP | `localhost:3001` (admin_web) |

> Type은 **HTTP**(로컬 uvicorn/serve는 평문). 외부 HTTPS는 Cloudflare 엣지가 종단한다 — 로컬 인증서 불필요.
> ⚠️ **DB 포트(5432·8123·9000·6379)에는 터널 호스트네임을 절대 붙이지 않는다.** 외부 노출 금지, LAN 전용. Cloudflare가 붙는 건 위 API·프론트 서브도메인뿐.

---

## 6. 배포 트리거 (서버/웹 분기)
배포는 **경로 기반 자동 + 수동** 두 워크플로로 분리돼 있다(같은 미니PC 대상). 프론트 배포가 수집 워커를 중단시키지 않는 게 분리의 핵심.

| 워크플로 | 자동 트리거 경로 | 배포 대상 |
|---|---|---|
| `.github/workflows/deploy-server.yml` (Deploy Server) | `backend/**`, `docker-compose.prod.yml` | auth/stock/blog API + celery worker/beat (DB는 depends_on) |
| `.github/workflows/deploy-web.yml` (Deploy Web) | `web_client/**`, `admin_web/**`, `docker-compose.prod.yml` | web_client(3000) + admin_web(3001) |

- **자동**: `dev → main` 병합 후 push하면, 변경된 경로에 해당하는 워크플로만 실행된다(둘 다 바뀌면 둘 다). `docker-compose.prod.yml` 변경은 양쪽 모두 트리거.
  ```bash
  git checkout main && git merge dev && git push origin main
  ```
- **수동**: GitHub Actions 탭 → `Deploy Server` 또는 `Deploy Web` → **Run workflow**(workflow_dispatch). 수집 시간(매일 20:30)을 피해 원하는 때 배포할 때 사용.
- 각 워크플로는 지정 서비스만 `up -d --build` 하므로 나머지 컨테이너·볼륨은 그대로 유지된다. `concurrency` 로 같은 대상 배포는 직렬화된다.

---

## 7. 스키마 부트스트랩 (최초 1회 — 생략하면 전 요청 500!)
`docker-compose.prod.yml`/배포 워크플로에는 **마이그레이션이 없다**. 첫 배포 후 볼륨이 비어 있으므로, 서버에서 **한 번** 스키마를 만든다(이미지에 deps가 system 설치돼 있어 `uv run` 불필요):
```bash
# 배포와 동일한 compose 프로젝트에서 실행해야 이미지/네트워크가 일치한다.
# 러너 기본 체크아웃 경로:
cd ~/actions-runner/_work/stock_app/stock_app
docker compose -f docker-compose.prod.yml run --rm stock_api alembic upgrade head
docker compose -f docker-compose.prod.yml run --rm stock_api python -m shared.clickhouse_schema
docker compose -f docker-compose.prod.yml run --rm auth_api python -m apps.auth.seed_admin
```
- `alembic upgrade head` — PostgreSQL 스키마(4개 마이그레이션)
- `shared.clickhouse_schema` — ClickHouse 테이블(멱등, 재실행 안전)
- `apps.auth.seed_admin` — 관리자 계정(`ADMIN_EMAIL`/`ADMIN_PASSWORD`)

---

## 8. 검증
```bash
docker compose -f docker-compose.prod.yml ps       # 8컨테이너 up/healthy 확인
docker compose -f docker-compose.prod.yml logs -f stock_api   # 부팅 에러 확인
curl -s https://api.haezean.com/graphql -H 'content-type: application/json' \
  -d '{"query":"{ __typename }"}'                  # Cloudflare 경유 응답 확인
```

---

## 9. 디스크 관리 (이미지·빌드캐시)
데이터(ClickHouse 시계열)는 압축돼 작지만, **매 배포의 `--build`로 오래된 이미지·빌드캐시가 누적**되는 게 유일한 디스크 관리 포인트다.

**① 오래된 이미지 자동 삭제** — 배포 워크플로(server/web)에 반영됨: 배포 끝에 `docker image prune -f`로 교체된 dangling 이미지 제거(실행 중 스택 이미지·볼륨은 보존). 별도 조치 불필요.

**② 빌드 캐시 10GB 상한** — Docker 데몬 GC로 설정(항상 자동 적용). `/etc/docker/daemon.json`:
```json
{
  "builder": { "gc": { "enabled": true, "defaultKeepStorage": "10GB" } }
}
```
```bash
sudo nano /etc/docker/daemon.json      # 다른 설정이 있으면 병합
sudo systemctl restart docker          # ⚠️ 모든 컨테이너 재시작 → 수집 중이면 끝난 뒤 적용
```
→ BuildKit이 캐시를 **10GB 이하로 유지**(초과분 자동 GC). 캐시를 남겨 빌드 속도는 유지하면서 상한만 건다.

**현황 확인 / 수동 정리**:
```bash
docker system df                       # 이미지/컨테이너/볼륨/빌드캐시 용량
df -h /                                # 디스크 여유
docker image prune -af                 # (필요시) 미사용 이미지 삭제
docker builder prune -f                # (필요시) 빌드 캐시 전체 삭제
```
> ⚠️ **`docker system prune --volumes` 절대 금지** — `pg_data_prod`·`clickhouse_data_prod`·`redis_data_prod` 볼륨(=DB 실데이터)이 삭제된다. `image`/`builder` prune만 볼륨을 건드리지 않는다.

---

## 10. 트러블슈팅
| 증상 | 원인/조치 |
|---|---|
| 러너가 작업을 안 잡음(대기) | 러너 오프라인이거나 docker 그룹 미가입(§1·§2) |
| 배포 성공했는데 접속 불가 | `docker compose logs stock_api`로 FastAPI 부팅 에러 확인 |
| DB 연결 에러 | `.env.production`의 DB 호스트가 `localhost` → **컨테이너 이름**(`postgres`/`redis`/`clickhouse`)이어야(§3-1) |
| DB 인증 실패 | `DATABASE_URL` 비번 ≠ `compose.env` 비번(§3 경고). 볼륨은 최초 비번으로 고정되므로 바꾸려면 볼륨 삭제 필요 |
| 배포 중 `.env.production` Permission denied | 시크릿 소유자가 `root`. 러너 사용자로 `sudo chown -R <러너>:<러너> /opt/stock_app/env`(§3) |
| 전 요청 500 (테이블 없음) | §7 스키마 부트스트랩 미실행 |
| alembic 돌렸는데 `relation "users" does not exist` | alembic이 `@localhost`(빈 곳)에 붙음. `env.py`는 `SYNC_DATABASE_URL`(=@postgres)을 자동 사용하도록 수정됨 — 구 이미지면 `-e ALEMBIC_DATABASE_URL='postgresql+psycopg2://stock_user:stock_password@postgres:5432/stock_db'` 로 재실행 후 seed_admin |
| 데이터가 Mock으로 나옴 | `KIS_APP_KEY` 비었거나 `KIS_MODE≠prod`(§3-1) |
| 전종목 수집이 특정 개수(예: ~928)부터 줄줄이 `Max retries exceeded` | 연결계열 실패. §11 참조(코드 완화 적용됨 — Session 재사용 + 적응형 쿨다운 + 연결계열 2차 재시도). 근본원인은 로그의 errno로 확정 |
| admin/app.haezean.com 에서 "백엔드 서버에 연결할 수 없습니다"(로그인/조회 실패) | **CORS**. 프론트 빌드는 정상(터널 URL 구워짐)인데 백엔드가 그 origin 을 거부한 것. develop 도메인(admin/app.haezean.com)은 `shared/cors.py`에 코드로 포함됨 → **최신 코드로 재배포하면 해결**. 재배포 전 즉시 완화: `.env.production`에 `CORS_ORIGINS=https://admin.haezean.com,https://app.haezean.com` 추가 후 `docker compose -f docker-compose.prod.yml up -d --force-recreate auth_api blog_api stock_api`(재빌드 X). 검증: `curl -s -D - -o /dev/null -X OPTIONS https://auth.haezean.com/api/v1/auth/login -H 'Origin: https://admin.haezean.com' -H 'Access-Control-Request-Method: POST' \| grep -i allow-origin` 가 origin 을 반환해야 함 |

## 11. 수집 신뢰성 (연결계열 실패 완화·진단)
KIS 시세 상한은 **20 TPS**. 우리는 8/s(=40%)로 도는데도 대량 순회(~928종목) 후 연결오류가 관찰됐다 → **TPS 초과가 원인이 아니다.** 코드에 3중 완화를 적용했다(`apps/collector/kis/client.py`, `apps/collector/tasks/universe.py`):

1. **커넥션 재사용**: `KISClient`가 인스턴스 `requests.Session`(keep-alive, 풀=4)으로 요청 → 매 요청 새 TCP+TLS 핸드셰이크 폭주를 제거.
2. **적응형 쿨다운**: 연결계열(`KISConnectionError`) 연속 실패가 임계치(기본 5) 이상이면 `60→120→…→600초`로 쉬었다 재개(성공 시 리셋). 4xx·rt_cd 논리오류는 대상 아님(즉시 격리).
3. **연결계열 2차 재시도**: 1차에서 연결계열로 실패한 종목만 쿨다운 후 한 번 더 시도(논리오류는 재시도 안 함).

튜닝 env(선택, `.env.production`): `KIS_RATE_PER_SEC`(기본 8), `KIS_COOLDOWN_THRESHOLD`(5), `KIS_COOLDOWN_BASE_SEC`(60), `KIS_COOLDOWN_MAX_SEC`(600).

**⚠️ 검증 순서(중요)**: 전종목 재시도 전 **20종목 프로브**부터.
```bash
# 20종목만 먼저 — 성공하면 차단 해제 상태, 실패하면 아직 원격 차단(코드로 못 고침 → 대기)
docker exec stock_celery_worker \
  celery -A apps.collector.celery_app call collector.collect_all_daily --kwargs '{"limit": 20}'
docker exec stock_celery_worker celery -A apps.collector.celery_app inspect active   # 진행 확인
docker logs -f stock_celery_worker                                                   # errno 확인
```

**근본원인 확정(다음 실패 시, 실행 *중*에)**: 코드가 실패를 `repr`로 남기므로 로그의 `[Errno …]`가 그대로 보인다. 의미:
| 로그의 errno | 원인 | 처방 |
|---|---|---|
| `[Errno 99]`/`[Errno 98] Cannot assign requested address` | 로컬 포트 고갈 | Session이 해결(적용됨). `sysctl net.ipv4.ip_local_port_range` 확인 |
| `Connection reset by peer`/TLS 핸드셰이크 실패 | 원격 엣지가 핸드셰이크 레이트 차단 | Session이 핸드셰이크 수를 급감시켜 해결 |
| `Read timed out`/`[Errno 110]` (connect) | 원격 지연/IP 차단 | 쿨다운이 완화. 코드로 근본 해결 불가 → 대기 |
| `dmesg`에 `nf_conntrack: table full` | conntrack 테이블 포화 | 코드 아님 → sysctl 조정 |

실행 *중* 미니PC에서 로컬 자원 소진 여부를 초 단위로 판별:
```bash
ss -tan state time-wait | wc -l                              # TIME_WAIT 소켓 수(수만이면 포트압박)
cat /proc/sys/net/netfilter/nf_conntrack_count               # 현재 conntrack 엔트리
cat /proc/sys/net/netfilter/nf_conntrack_max                 # 상한(count가 근접하면 포화)
dmesg | tail -30                                             # conntrack table full 경고 확인
```
> 재발 위치가 단서: **같은 개수(~900~1000)에서 또 막히면** 미확인 자원 상한, **랜덤/즉시면** 원격 차단. 전종목 1회가 깨끗이 끝나기 전엔 "해결"로 보고하지 않는다.


---

# 📄 `docs/superpowers/plans/2026-09-14-featured-posts.md`

# 추천 글(Featured Posts) 큐레이션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 게시글을 "홈 추천"으로 켜면 모바일 홈 화면에 최근에 켠 순으로 노출된다.

**Architecture:** `blog_posts`에 `featured_at TIMESTAMP NULL` 컬럼 하나를 추가(additive). 기존 REST `GET /api/v1/blogs`에 `featured` 필터만 얹고(새 엔드포인트 없음), 토글은 기존 PUT 경로 재사용. 관리자 목록에서 ⭐ 토글, 모바일 빈 홈을 추천 글 리스트로 교체하며 `BlogCard`를 blog 탭과 공유하도록 추출한다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Alembic + PostgreSQL(백엔드), React+Vite+axios(admin_web), React Native/Expo + Unistyles(mobile). 백엔드 테스트는 pytest + aiosqlite.

**Spec:** `docs/superpowers/specs/2026-09-14-featured-posts-design.md`

**참고 — 검증 전략:** 백엔드 filter/ordering만 자동 테스트(aiosqlite)로 잠근다. admin_web·mobile은 JS 테스트 하니스가 없으므로 빌드 통과 + 수동 클릭 검증으로 확인한다(이번 단위에 JS 테스트 인프라 신설은 YAGNI).

**커밋 규칙:** 모든 커밋 전 브랜치 가드 실행 — `b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q`. 커밋은 stock_app 루트에서 전체 폴더 대상. 커밋 메시지 말미에:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
```

---

## File Structure

| 레이어 | 파일 | 책임 |
|---|---|---|
| model | `backend/shared/models.py` | `BlogPost.featured_at` 컬럼 |
| migration | `backend/alembic/versions/f1e2d3c4b5a6_blog_posts_featured_at.py` (신규) | 컬럼 additive 추가/제거 |
| schema | `backend/apps/blog/schemas.py` | `BlogOut.featured_at`(응답), `BlogUpdate.featured`(쓰기) |
| repo | `backend/apps/blog/crud.py` | `list_blogs` featured 필터/정렬, `update_blog` featured→featured_at 번역 |
| router | `backend/apps/blog/routers/blogs.py` | `featured` 쿼리 파라미터 |
| test | `backend/tests/test_blog_featured.py` (신규) | crud 필터/정렬/토글 잠금 |
| test cfg | `backend/pyproject.toml` | pytest-asyncio + aiosqlite dev dep, asyncio_mode |
| admin | `admin_web/src/pages/BlogListPage.jsx` | 행별 ⭐ 추천 토글(낙관적 업데이트) |
| admin | `admin_web/src/api/blogs.js` | (변경 없음 — `updateBlog` 재사용) |
| mobile | `mobile/src/features/blog/blog-card.tsx` (신규) | `BlogCard`·`stripHtml`·`fmtDate` 추출 |
| mobile | `mobile/src/features/blog/api.ts` | `featured` 파라미터 + `featured_at` 매핑 |
| mobile | `mobile/src/features/blog/types.ts` | `featuredAt` 타입 |
| mobile | `mobile/src/features/blog/use-featured-posts.ts` (신규) | 추천 글 조회 훅 |
| mobile | `mobile/src/app/(tabs)/blog.tsx` | 추출한 `BlogCard` 사용 |
| mobile | `mobile/src/app/(tabs)/index.tsx` | 홈 = 추천 글 리스트 |
| docs | `README.md` | 추천 글 기능/필드 반영 |

---

## Task 1: 백엔드 모델 + Alembic 마이그레이션

**Files:**
- Modify: `backend/shared/models.py` (BlogPost, `view_count` 아래)
- Create: `backend/alembic/versions/f1e2d3c4b5a6_blog_posts_featured_at.py`

- [ ] **Step 1: 모델에 컬럼 추가**

`backend/shared/models.py` 의 `BlogPost` 에서 `view_count` 정의 바로 아래에 추가:

```python
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 홈 추천(큐레이션): 켠 시각. NULL=추천 아님. 홈은 featured_at DESC 로 노출.
    featured_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
```

> `DateTime`·`datetime` 은 이미 `models.py` 상단에 import 되어 있다(TimestampMixin에서 사용). 추가 import 불필요.

- [ ] **Step 2: 마이그레이션 파일 작성**

`backend/alembic/versions/f1e2d3c4b5a6_blog_posts_featured_at.py`:

```python
"""blog_posts.featured_at 추가 (홈 추천 큐레이션)

Revision ID: f1e2d3c4b5a6
Revises: cf0877c663a1
Create Date: 2026-09-14

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1e2d3c4b5a6"
down_revision: Union[str, Sequence[str], None] = "cf0877c663a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "blog_posts",
        sa.Column("featured_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_blog_posts_featured_at", "blog_posts", ["featured_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_blog_posts_featured_at", table_name="blog_posts")
    op.drop_column("blog_posts", "featured_at")
```

- [ ] **Step 3: 로컬 DB에 적용 (⚠️ 개발서버 터널 아닌 로컬 DB)**

먼저 로컬 DB가 떠 있는지/터널이 아닌지 확인 후:

```bash
cd backend
docker compose -f ../docker-compose.dev.yml up -d   # 로컬 DB (터널 세션이면 종료 먼저)
uv run alembic upgrade head
```
Expected: `Running upgrade cf0877c663a1 -> f1e2d3c4b5a6`

> ⚠️ `.env.development` 이 개발서버 터널(15432/18123)을 가리키면 공유 스키마가 바뀐다. 로컬 검증은 로컬 DB로. develop 반영은 서버 배포 시 별도(Task 8 §배포 노트).

- [ ] **Step 4: 롤백 왕복 확인**

```bash
uv run alembic downgrade -1 && uv run alembic upgrade head
```
Expected: 에러 없이 down→up 성공.

- [ ] **Step 5: 커밋**

```bash
cd ..
b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add backend/shared/models.py backend/alembic/versions/f1e2d3c4b5a6_blog_posts_featured_at.py
git commit -m "$(cat <<'EOF'
feat(blog): BlogPost.featured_at 컬럼 + 마이그레이션 (홈 추천)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 2: 백엔드 스키마 (featured 입출력 필드)

**Files:**
- Modify: `backend/apps/blog/schemas.py` (`BlogUpdate`, `BlogOut`)

- [ ] **Step 1: `BlogUpdate` 에 쓰기 필드 추가**

`BlogUpdate` 클래스에 필드 추가:

```python
class BlogUpdate(BaseModel):
    board_id: int | None = None
    title: str | None = Field(None, max_length=255)
    content: str | None = None
    thumbnail_url: str | None = Field(None, max_length=512)
    featured: bool | None = Field(None, description="홈 추천 on/off")
```

- [ ] **Step 2: `BlogOut` 에 응답 필드 추가**

`BlogOut` 클래스에 `view_count` 아래로 추가:

```python
class BlogOut(BlogBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    author_id: int | None
    view_count: int
    featured_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
```

> `featured_at` 만 노출하면 충분하다. 클라이언트는 `featured_at != null` 로 추천 여부를 판단한다(admin 토글 상태 표시).

- [ ] **Step 3: import 로 문법 확인**

```bash
cd backend && uv run python -c "from apps.blog import schemas; print(schemas.BlogUpdate.model_fields.keys()); print('featured_at' in schemas.BlogOut.model_fields)"
```
Expected: `dict_keys([... 'featured'])` 와 `True`

- [ ] **Step 4: 커밋**

```bash
cd .. && b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add backend/apps/blog/schemas.py
git commit -m "$(cat <<'EOF'
feat(blog): BlogUpdate.featured / BlogOut.featured_at 스키마

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 3: 백엔드 crud (필터/정렬 + featured 번역) — TDD

**Files:**
- Modify: `backend/pyproject.toml` (dev deps + asyncio_mode)
- Create: `backend/tests/test_blog_featured.py`
- Modify: `backend/apps/blog/crud.py` (`list_blogs`, `update_blog`)

- [ ] **Step 1: 테스트 의존성 추가**

`backend/pyproject.toml` 의 dev 의존성 그룹(기존 `pytest>=9.1.1` 이 있는 배열)에 두 줄 추가:

```toml
    "pytest>=9.1.1",
    "pytest-asyncio>=0.24.0",
    "aiosqlite>=0.20.0",
```

그리고 `[tool.pytest.ini_options]` 에 `asyncio_mode` 추가:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "-q"
asyncio_mode = "auto"
```

설치:
```bash
cd backend && uv sync
```

- [ ] **Step 2: 실패하는 테스트 작성**

`backend/tests/test_blog_featured.py`:

```python
"""홈 추천(featured) 필터·정렬·토글 crud 회귀 테스트.

공유 DB 하니스가 없어 self-contained aiosqlite 인메모리 세션을 쓴다.
"""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog import crud, schemas
from shared.models import Base, BlogPost, Board


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _seed(session, n: int = 3) -> tuple[Board, list[BlogPost]]:
    board = Board(name="테스트", order_index=0)
    session.add(board)
    await session.commit()
    await session.refresh(board)
    posts = []
    for i in range(n):
        p = BlogPost(board_id=board.id, title=f"글{i}", content="<p>x</p>")
        session.add(p)
        posts.append(p)
    await session.commit()
    for p in posts:
        await session.refresh(p)
    return board, posts


async def test_featured_none_returns_all(session):
    _, posts = await _seed(session)
    total, items = await crud.list_blogs(session)
    assert total == 3
    assert len(items) == 3


async def test_featured_filter_and_order(session):
    _, posts = await _seed(session)
    # feature 순서를 id 순서와 반대로: posts[2] 를 먼저, posts[0] 를 나중에 추천.
    # featured_at DESC 면 [posts[0], posts[2]] (나중에 켠 게 위),
    # id DESC tie-break 만이라면 [posts[2], posts[0]] 가 나온다 → 정렬 주체를 구분한다.
    await crud.update_blog(session, posts[2], schemas.BlogUpdate(featured=True))
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))

    total, items = await crud.list_blogs(session, featured=True)
    assert total == 2
    assert [p.id for p in items] == [posts[0].id, posts[2].id]


async def test_unfeature_removes_from_list(session):
    _, posts = await _seed(session)
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=False))
    total, items = await crud.list_blogs(session, featured=True)
    assert total == 0
    assert items == []


async def test_update_other_field_keeps_featured(session):
    """featured 를 안 보낸 수정은 featured_at 을 건드리지 않는다(회귀 방지)."""
    _, posts = await _seed(session)
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(title="수정됨"))
    total, _ = await crud.list_blogs(session, featured=True)
    assert total == 1


async def test_refeature_preserves_original_time(session):
    """이미 추천된 글에 featured=True 재전송해도 featured_at 이 바뀌지 않는다."""
    _, posts = await _seed(session)
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    first = posts[0].featured_at
    assert first is not None
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    assert posts[0].featured_at == first
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

```bash
cd backend && uv run pytest tests/test_blog_featured.py -v
```
Expected: FAIL — `list_blogs()` 에 `featured` 인자 없음(TypeError) / `update_blog` 이 `featured` 를 컬럼으로 setattr 시도해 에러.

- [ ] **Step 4: `list_blogs` 에 featured 필터/정렬 추가**

`backend/apps/blog/crud.py` 의 `list_blogs` 를 아래로 교체:

```python
async def list_blogs(
    db: AsyncSession,
    *,
    board_id: int | None = None,
    featured: bool | None = None,
    page: int = 1,
    size: int = 20,
) -> tuple[int, list[BlogPost]]:
    """(total, items) 페이지네이션 결과.

    featured=True 면 추천(featured_at IS NOT NULL)만 최근에 켠 순으로 반환.
    """
    base = select(BlogPost)
    count_stmt = select(func.count()).select_from(BlogPost)
    if board_id is not None:
        base = base.where(BlogPost.board_id == board_id)
        count_stmt = count_stmt.where(BlogPost.board_id == board_id)
    if featured is True:
        base = base.where(BlogPost.featured_at.is_not(None))
        count_stmt = count_stmt.where(BlogPost.featured_at.is_not(None))
        order = (BlogPost.featured_at.desc(), BlogPost.id.desc())
    else:
        order = (BlogPost.created_at.desc(), BlogPost.id.desc())

    total = (await db.execute(count_stmt)).scalar_one()
    stmt = base.order_by(*order).offset((page - 1) * size).limit(size)
    items = list((await db.execute(stmt)).scalars().all())
    return total, items
```

- [ ] **Step 5: `update_blog` 에 featured→featured_at 번역 추가**

같은 파일의 `update_blog` 를 아래로 교체(상단에 `datetime` import 추가):

```python
from datetime import datetime, timezone
```

```python
async def update_blog(
    db: AsyncSession, post: BlogPost, data: schemas.BlogUpdate
) -> BlogPost:
    values = data.model_dump(exclude_unset=True)
    # featured(불리언) 은 컬럼이 아니라 featured_at(타임스탬프)으로 번역한다.
    # 이미 추천 중인 글에 featured=True 를 다시 보내도 최초로 켠 시각을 보존한다(홈 순서 유지).
    if "featured" in values:
        if values.pop("featured"):
            if post.featured_at is None:
                post.featured_at = datetime.now(timezone.utc)
        else:
            post.featured_at = None
    for key, value in values.items():
        setattr(post, key, value)
    await db.commit()
    await db.refresh(post)
    return post
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

```bash
cd backend && uv run pytest tests/test_blog_featured.py -v
```
Expected: 5 passed. 이어서 기존 테스트 회귀 확인:
```bash
uv run pytest -q
```
Expected: 기존 15개 + 신규 4개 전부 pass.

- [ ] **Step 7: 커밋**

```bash
cd .. && b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add backend/apps/blog/crud.py backend/tests/test_blog_featured.py backend/pyproject.toml backend/uv.lock
git commit -m "$(cat <<'EOF'
feat(blog): list_blogs featured 필터/정렬 + update_blog featured 번역 (+테스트)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 4: 백엔드 라우터 (featured 쿼리 파라미터)

**Files:**
- Modify: `backend/apps/blog/routers/blogs.py` (`read_blogs`)

- [ ] **Step 1: `read_blogs` 에 featured 파라미터 추가**

`read_blogs` 를 아래로 교체:

```python
@router.get("", response_model=schemas.BlogListOut)
async def read_blogs(
    board_id: int | None = Query(None, description="게시판 ID로 필터"),
    featured: bool | None = Query(None, description="true면 홈 추천글만"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    total, items = await crud.list_blogs(
        db, board_id=board_id, featured=featured, page=page, size=size
    )
    return schemas.BlogListOut(total=total, page=page, size=size, items=items)
```

- [ ] **Step 2: 로컬 서버로 수동 검증**

blog 서버 기동 후:
```bash
cd backend && uv run uvicorn apps.blog.main:app --port 8000 &
sleep 2
curl -s "http://localhost:8000/api/v1/blogs?featured=true&size=5" | head -c 300
```
Expected: `{"total":...,"items":[...]}` (초기엔 total 0). 기존 `curl "http://localhost:8000/api/v1/blogs"` 도 여전히 전체 반환.

- [ ] **Step 3: 커밋**

```bash
b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add backend/apps/blog/routers/blogs.py
git commit -m "$(cat <<'EOF'
feat(blog): GET /blogs featured 쿼리 파라미터

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 5: admin_web 추천 토글

**Files:**
- Modify: `admin_web/src/pages/BlogListPage.jsx`

- [ ] **Step 1: import 에 `updateBlog` 추가**

`BlogListPage.jsx` 상단 import 를 교체:

```jsx
import { deleteBlog, listBlogs, updateBlog } from '../api/blogs'
```

- [ ] **Step 2: 토글 핸들러 추가**

`onDelete` 함수 바로 아래에 추가(같은 낙관적 업데이트+롤백 패턴):

```jsx
  const onToggleFeatured = async (post) => {
    const next = !post.featured_at
    const prev = data
    // 낙관적 반영: 해당 행만 즉시 갱신(깜빡임 방지)
    setData((d) => ({
      ...d,
      items: d.items.map((i) =>
        i.id === post.id
          ? { ...i, featured_at: next ? new Date().toISOString() : null }
          : i,
      ),
    }))
    try {
      await updateBlog(post.id, { featured: next })
      showToast(next ? '홈 추천으로 설정했습니다.' : '홈 추천을 해제했습니다.', {
        icon: next ? '⭐' : '🔕',
      })
    } catch {
      setData(prev) // 실패 시 롤백
      showToast('추천 설정에 실패했습니다.', { icon: '⚠️' })
    }
  }
```

- [ ] **Step 3: 테이블에 "추천" 컬럼 추가**

`<thead>` 의 `<tr>` 에서 "제목" `<th>` 다음에 추가:

```jsx
              <th className="px-4 py-3 font-medium">제목</th>
              <th className="px-4 py-3 text-center font-medium">추천</th>
              <th className="px-4 py-3 font-medium">게시판</th>
```

`<tbody>` 의 각 행에서 제목 `<td>` 다음에 추가:

```jsx
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => onToggleFeatured(p)}
                      title={p.featured_at ? '홈 추천 해제' : '홈 추천 설정'}
                      className="text-lg leading-none"
                    >
                      {p.featured_at ? '⭐' : '☆'}
                    </button>
                  </td>
```

그리고 로딩/빈 상태 행의 `colSpan={5}` 을 두 곳 모두 **`colSpan={6}`** 으로 변경(컬럼이 하나 늘었으므로).

- [ ] **Step 4: 빌드 검증**

```bash
cd admin_web && npm run build
```
Expected: 빌드 성공(에러 0).

- [ ] **Step 5: 수동 클릭 검증**

`npm run dev` 후 게시글 관리 화면에서: ☆ 클릭 → ⭐ 로 바뀌고 "홈 추천으로 설정했습니다" 토스트. 다시 클릭 → ☆ + 해제 토스트. 새로고침해도 상태 유지(서버 반영 확인).

- [ ] **Step 6: 커밋**

```bash
cd .. && b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add admin_web/src/pages/BlogListPage.jsx
git commit -m "$(cat <<'EOF'
feat(admin): 게시글 목록 행별 홈 추천 토글(⭐)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 6: mobile API·타입·훅

**Files:**
- Modify: `mobile/src/features/blog/types.ts`
- Modify: `mobile/src/features/blog/api.ts`
- Create: `mobile/src/features/blog/use-featured-posts.ts`

- [ ] **Step 1: 타입에 `featuredAt` 추가**

`types.ts` 의 `BlogPost` 에 `viewCount` 아래로 추가:

```typescript
  viewCount: number;
  featuredAt: string | null; // ISO, null이면 추천 아님
  createdAt: string; // ISO
```

- [ ] **Step 2: api.ts 매핑 + featured 파라미터**

`api.ts` 의 `RawBlog` 타입에 `view_count` 아래로 추가:

```typescript
  view_count: number;
  featured_at: string | null;
  created_at: string;
```

`toBlogPost` 의 `viewCount` 아래로 추가:

```typescript
    viewCount: r.view_count,
    featuredAt: r.featured_at,
    createdAt: r.created_at,
```

`fetchBlogList` 시그니처와 쿼리에 `featured` 추가:

```typescript
export async function fetchBlogList(params?: {
  boardId?: number;
  featured?: boolean;
  page?: number;
  size?: number;
}): Promise<BlogListResponse> {
  const raw = await blogApi.get<RawBlogList>('/api/v1/blogs', {
    board_id: params?.boardId,
    featured: params?.featured,
    page: params?.page,
    size: params?.size ?? 20,
  });
  return {
    total: raw.total,
    page: raw.page,
    size: raw.size,
    items: raw.items.map(toBlogPost),
  };
}
```

- [ ] **Step 3: 추천 글 훅 작성**

`mobile/src/features/blog/use-featured-posts.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';

import { fetchBlogList } from './api';
import type { BlogPost } from './types';

type State = {
  data: BlogPost[];
  loading: boolean;
  error: string | null;
};

/** 홈 추천 글(featured_at DESC)을 불러온다. */
export function useFeaturedPosts(size = 20) {
  const [state, setState] = useState<State>({ data: [], loading: true, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetchBlogList({ featured: true, size });
      setState({ data: res.items, loading: false, error: null });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `서버 오류 (${e.status})`
          : '네트워크 오류 — blog 서비스(:8000)가 실행 중인지 확인하세요';
      setState({ data: [], loading: false, error: msg });
    }
  }, [size]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}
```

- [ ] **Step 4: 타입체크**

```bash
cd mobile && npx tsc --noEmit
```
Expected: 에러 0.

- [ ] **Step 5: 커밋**

```bash
cd .. && b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add mobile/src/features/blog/types.ts mobile/src/features/blog/api.ts mobile/src/features/blog/use-featured-posts.ts
git commit -m "$(cat <<'EOF'
feat(mobile): featured 파라미터/매핑 + useFeaturedPosts 훅

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 7: mobile BlogCard 추출 + 홈 화면

**Files:**
- Create: `mobile/src/features/blog/blog-card.tsx`
- Modify: `mobile/src/app/(tabs)/blog.tsx`
- Modify: `mobile/src/app/(tabs)/index.tsx`

- [ ] **Step 1: `BlogCard` 를 공용 컴포넌트로 추출**

`mobile/src/features/blog/blog-card.tsx`:

```tsx
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { BlogPost } from './types';

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {post.title}
      </Text>
      <Text style={styles.cardSnippet} numberOfLines={2}>
        {stripHtml(post.content)}
      </Text>
      <Text style={styles.cardMeta}>
        조회 {post.viewCount} · {fmtDate(post.createdAt)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.gap(2),
    gap: theme.gap(0.5),
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  cardSnippet: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
  },
  cardMeta: {
    marginTop: theme.gap(0.5),
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
}));
```

- [ ] **Step 2: `blog.tsx` 를 추출본 사용으로 교체**

`blog.tsx` 에서 로컬 `stripHtml`·`fmtDate`·`BlogCard` 정의와 그 `card*` 스타일을 제거하고, 상단 import 에 추가:

```tsx
import { BlogCard } from '@/features/blog/blog-card';
```

`styles` 객체에서 `card`, `cardTitle`, `cardSnippet`, `cardMeta` 항목을 삭제한다(나머지 `center/hint/errorTitle/retry/retryText/list/listContent/sep` 는 유지). `renderItem` 은 그대로 `<BlogCard post={item} />` 를 쓴다.

- [ ] **Step 3: 홈 화면 = 추천 글 리스트**

`mobile/src/app/(tabs)/index.tsx` 전체 교체:

```tsx
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { BlogCard } from '@/features/blog/blog-card';
import { useFeaturedPosts } from '@/features/blog/use-featured-posts';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { data, loading, error, reload } = useFeaturedPosts();

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator />
        <Text style={styles.hint}>불러오는 중…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorTitle}>추천 글을 불러오지 못했습니다</Text>
        <Text style={styles.hint}>{error}</Text>
        <Pressable style={styles.retry} onPress={reload}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>📌 추천 글</Text>
        <Text style={styles.hint}>아직 추천 글이 없습니다</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={[styles.listContent, { paddingTop: insets.top + 16 }]}
      data={data}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={<Text style={styles.title}>📌 추천 글</Text>}
      renderItem={({ item }) => <BlogCard post={item} />}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    gap: theme.gap(1),
    padding: theme.gap(3),
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.colors.text,
    marginBottom: theme.gap(1.5),
  },
  hint: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  retry: {
    marginTop: theme.gap(1),
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(2),
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  retryText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  list: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  listContent: {
    padding: theme.gap(2),
  },
  sep: {
    height: theme.gap(1.5),
  },
}));
```

- [ ] **Step 4: 타입체크 + 회귀 확인**

```bash
cd mobile && npx tsc --noEmit
```
Expected: 에러 0. blog 탭 카드가 추출 후에도 동일하게 보이는지(수동) + 홈에 추천 글 노출/빈 상태 확인.

- [ ] **Step 5: 커밋**

```bash
cd .. && b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add mobile/src/features/blog/blog-card.tsx "mobile/src/app/(tabs)/blog.tsx" "mobile/src/app/(tabs)/index.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): 홈을 추천 글 리스트로 교체 + BlogCard 공용 추출

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 8: 문서 업데이트 + 배포 노트

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 에 추천 글 기능 반영**

`README.md` 에서 블로그/기능 설명 섹션에 한 항목 추가(정확한 위치는 기존 목차에 맞춰):

```markdown
- **홈 추천 글(큐레이션)**: 관리자 게시글 목록에서 ⭐ 토글로 "홈 추천"을 켜면(`blog_posts.featured_at`),
  모바일 홈 탭에 최근에 켠 순으로 노출된다. API: `GET /api/v1/blogs?featured=true`.
```

- [ ] **Step 2: 배포 노트 확인(마이그레이션 실행 시점)**

⚠️ **정정(실제 확인)**: `deploy-server.yml`·`docker-compose.prod.yml`·`Dockerfile` 어디에도 `alembic upgrade` 스텝이 **없다**(컨테이너는 `uvicorn …` 만 실행). 따라서 featured_at 마이그레이션은 자동 반영되지 않으며, 신버전 코드는 ORM에 `featured_at` 을 선언하므로 컬럼이 없으면 blog 조회가 500 난다. **배포 담당자가 대상 DB에 수동 `alembic upgrade head` 를 신버전 코드보다 먼저(또는 함께) 실행**해야 한다.

- [ ] **Step 3: 전체 테스트 최종 확인**

```bash
cd backend && uv run pytest -q && cd ..
```
Expected: 전부 pass.

- [ ] **Step 4: 커밋**

```bash
b=$(git branch --show-current); [ "$b" = "dev" ] || git checkout dev -q
git add README.md docs/run_and_deploy.md
git commit -m "$(cat <<'EOF'
docs: 홈 추천 글 기능 README 반영

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## 배포 (사용자 확인 후)

- **⚠️ 먼저: 대상 DB에 `alembic upgrade head` 수동 실행**(파이프라인 자동 스텝 없음). 신버전 코드가 뜨기 전에 `featured_at` 컬럼이 존재해야 blog 조회가 500 나지 않는다.
- `dev` → `main` 병합 push 시:
  - `backend/**` 변경 → **Deploy Server** 워크플로가 blog API 재빌드(단, 마이그레이션은 위에서 수동 선행).
  - `admin_web/**` 변경 → **Deploy Web**.
  - mobile 은 EAS 별도(자동 배포 대상 아님).
- 수집 시간(20:30) 회피. 마이그레이션 자체는 additive(nullable) 라 컬럼 추가는 무중단.

---

## Self-Review 결과

- **Spec 커버리지:** 데이터(§2)=Task1, 백엔드 필터/토글(§3)=Task2·3·4, 관리자(§4)=Task5, 모바일 홈(§5)=Task6·7, 문서/배포=Task8. 후속 단위(§7 web_client/상세)는 의도적으로 제외 — 계획에 미포함이 맞음.
- **Placeholder 스캔:** 모든 코드 스텝에 실제 코드 포함. "적절히/나중에" 없음.
- **타입 일관성:** `featured`(API 입력, 불리언) ↔ `featured_at`(컬럼/응답, 타임스탬프) 구분 일관. mobile `featuredAt`(camel) ↔ `featured_at`(raw) 매핑 명시. `colSpan` 5→6 반영. `useFeaturedPosts` 시그니처 훅↔홈 일치.


---

# 📄 `docs/superpowers/specs/2026-07-11-admin-chart-capture-design.md`

# 어드민 차트 캡처 고도화 설계 (종목 검색 + 기간 설정)

- 작성일: 2026-07-11
- 관련 문서: `docs/prompts/04_admin_web.md`(5단계 핵심), `docs/prompts/06_stock_api.md`

## 배경 / 목표
기존 어드민 TipTap 에디터의 '차트 삽입'은 모의 OHLCV를 즉석 렌더링만 했다.
이를 고도화해 **국내외 종목·주요 지수를 검색**하고, **조회 기간(시작/종료일)** 을 지정하면
해당 차트를 렌더링한 뒤 이미지로 캡처해 본문에 삽입한다.

## 핵심 결정
- **API 방식**: Strawberry **GraphQL** (`06_stock_api.md` 스펙 준수, mobile의 graphql-request와 일관)
- **데이터 소스**: **온더플라이(on-the-fly) 시드 데이터** — DB 저장 없이 요청 시점에 결정적 생성
  - ClickHouse/Postgres 마이그레이션 **불필요**. 실데이터(KIS/ClickHouse) 전환은 생성 함수 교체로 대응
- **종목 카탈로그**: `stock_api` **인메모리** 목록 (Postgres `StockMeta` 미사용)

## A. stock_api 백엔드 (포트 8002)
디렉토리: `backend/apps/stock_api/`
- `seed_catalog.py` — 인메모리 종목/지수 목록
  - 국내 주식(~15), 미국 주식(~15), 주요 지수(~6). 필드: `symbol, name, market, country, currency`
  - `market` 예: `KOSPI/KOSDAQ/NASDAQ/NYSE/INDEX`
- `services/chart.py` — 온더플라이 OHLCV 생성
  - `symbol + date` 해시를 시드로 결정적 랜덤워크 → 같은 입력이면 항상 동일 결과
  - candle: `date, open, high, low, close, volume` + MA5/MA20 계산 제공
- `graphql/` (types.py, schema.py)
  - `searchStocks(query: String!): [Stock!]!` — 이름/심볼 부분일치, 국내+해외+지수 통합
  - `getChartData(symbol: String!, startDate: String!, endDate: String!): ChartData!`
    - `candles: [Candle!]!`, 선택적 지표(`ma5, ma20`)
  - Strawberry `GraphQLRouter` 를 FastAPI `/graphql` 에 마운트
- 의존성: `strawberry-graphql`
- CORS: 기존 5173/3000 허용 유지

## B. admin_web ChartSnapshotModal 고도화
- `src/api/stockClient.js` — `graphql-request` GraphQLClient (`VITE_STOCK_API_URL`, 기본 `http://localhost:8002/graphql`)
- 모달 UX 3단계
  1. 검색창(debounce) → `searchStocks` → 결과 리스트(종목명·심볼·시장 배지)
  2. 종목 선택 + 기간(시작/종료일, 기본 최근 3개월)
  3. `getChartData` → ECharts 캔들+MA 렌더 → 기존 `getDataURL()` 캡처 → 본문 `<img>` 삽입(로직 재사용)
  - 로딩/에러/빈결과 처리, 기존 모의데이터 생성부 제거

## C. 환경변수 · 문서
- `VITE_STOCK_API_URL` 추가, README 갱신
- 기능 단위 자동 커밋(백엔드 / 프론트 분리)

## 데이터 흐름
```
에디터 [차트 삽입] → 검색모달 → GraphQL searchStocks (8002)
  → 종목선택 + 기간 → getChartData (8002, 온더플라이 생성)
  → ECharts 렌더 → getDataURL() → TipTap <img> 삽입
```

## 비범위 (이후 단계)
- KIS OpenAPI 실연동 / ClickHouse 적재 / 수집 파이프라인
- 지표 확대(RSI, 볼린저 등), 종목 마스터의 Postgres 영속화


---

# 📄 `docs/superpowers/specs/2026-07-11-admin-chart-drawing-design.md`

# 어드민 차트 드로잉 도구 설계 (v1: 수평선·사각형·텍스트)

- 작성일: 2026-07-11
- 관련 문서: `docs/prompts/04_admin_web.md`(5단계 드로잉), `05_user_web.md`, `03_mobile_app.md`

## 배경 / 목표
어드민 '차트 삽입' 모달에서 캡처 전, 사용자가 차트 위에 분석을 직접 그릴 수 있게 한다.
v1은 **수평선 · 사각형 · 텍스트** 3종을 구현하고, 이중 추세선(3클릭 채널)은 다음 단계로 미룬다.

## 핵심 제약
캡처는 `getEchartsInstance().getDataURL()` → **ECharts 캔버스만** 이미지화된다.
따라서 드로잉은 반드시 **ECharts `graphic` 요소**로 그려야 캡처 이미지에 포함된다.
(별도 HTML/div 오버레이는 캡처되지 않음)

## 핵심 결정
- **그리기 방식**: 클릭해서 직접 그리기 (원샷 — 삽입 시 이미지로 구워져 재편집 불필요)
- **좌표 저장**: 픽셀이 아닌 **데이터 좌표**(x=카테고리 인덱스, y=가격)로 저장 → 리렌더/캡처 정합성 유지
- **로직 분리**: `useChartDrawings` 훅으로 분리 → 향후 web_client/mobile 재사용

## 구성 요소
### 1. 드로잉 상태 훅 `useChartDrawings.js`
- 도형 배열: `{ id, type: 'hline'|'rect'|'text', ... }`
  - hline: `{ price }`
  - rect: `{ x1, y1, x2, y2 }` (데이터 좌표)
  - text: `{ x, y, text }`
- API: `shapes, addShape, removeSelected, clearAll, selectedId, setSelectedId, tool, setTool`

### 2. 툴바 (모달 상단)
- 버튼: 수평선 / 사각형 / 텍스트 / 선택 / 선택삭제 / 전체지우기
- 활성 도구 하이라이트

### 3. 차트 인터랙션 (ECharts `zr` 이벤트 + `convertFromPixel`)
- **수평선**: 클릭 1회 → 해당 가격에 수평선 + 우측 가격 라벨
- **사각형**: mousedown→drag→up 대각 영역 → 반투명 사각형
- **텍스트**: 클릭 → HTML 입력창 → 확정 시 `graphic` text 배치
- 생성된 도형은 `draggable`로 미세조정 가능

### 4. 렌더링
- `shapes` → `graphic` 배열로 변환, `convertToPixel('grid', [xIndex, price])`로 데이터→픽셀 변환
- ECharts `graphic` 옵션에 반영 (선/사각형/텍스트 + 가격 라벨)

### 5. 캡처
- 기존 `getDataURL` 그대로 → `graphic`이 캔버스에 있으므로 자동 포함
- 삽입 후 도형 상태 초기화(`clearAll`)

## 데이터 흐름
```
툴바 도구 선택 → 차트 클릭/드래그 → useChartDrawings에 도형 추가(데이터좌표)
  → graphic 렌더 → 본문 삽입 시 getDataURL 캡처(도형 포함) → clearAll
```

## 비범위 (이후 단계)
- 이중 추세선(3클릭 평행 채널 + 중심선)
- web_client / mobile 차트 드로잉 재사용
- 도형 스타일 커스터마이즈(색상/두께 선택)


---

# 📄 `docs/superpowers/specs/2026-07-11-web-client-temp-login-comments-design.md`

# web_client 임시 로그인 + 댓글 작성 설계

- 작성일: 2026-07-11
- 관련: `docs/prompts/05_user_web.md`, `docs/architecture_plan.md`

## 배경 / 목표
web_client는 블로그 조회만 가능하고 댓글은 읽기 전용이다.
일반 유저가 **댓글을 작성**할 수 있게 하되, 카카오/구글 앱키는 아직 없으므로
**임시 로그인(닉네임 입력)**으로 먼저 동작시키고, 이후 실제 OAuth로 스왑한다.

## 현재 구조(재사용)
- 댓글 작성 API `POST /api/v1/blogs/{id}/comments`는 이미 존재하며 **JWT 인증(get_current_user)** 필요, author 자동 연결.
- blog 서비스(8000)는 공유 `JWT_SECRET_KEY`로 auth(8001) 발급 토큰을 검증(MSA).
- User: `email`(unique, nullable), `nickname`, `provider/provider_id`(nullable), `role`(FREE/PREMIUM/ADMIN).

## 핵심 결정
- **임시 로그인 = 닉네임만 입력** (비밀번호·외부키 불필요).
- **DB 마이그레이션 없음**: 임시 유저는 `provider=null`, `email = {slug(nickname)}@guest.local` 로 upsert(같은 닉네임=같은 계정), `role=FREE`.
- 기존 인증형 댓글 엔드포인트 **그대로 재사용**.
- 카카오/구글은 이후 "upsert → 토큰 발급" 동일 경로로 교체(스왑 가능).

## 백엔드 (auth 8001)
- 신규 `POST /api/v1/auth/guest`
  - Request: `{ nickname: str }` (1~20자, 공백 트림)
  - 로직: `email = slug(nickname)@guest.local` 로 User 조회→없으면 생성(nickname, role=FREE, is_active=True) → `create_access_token(subject=user.id, role=...)` → `TokenResponse` 반환.
- 스키마 `GuestLoginRequest { nickname }` 추가. 응답은 기존 `TokenResponse` 재사용.

## 프론트 (web_client 3000)
- `store/auth.js` — zustand + localStorage 영속. `{ user, token, login(nickname), logout() }`
- `api/client.js` — 요청 인터셉터로 Bearer 자동 부착(조회 무해/작성 필수), 401 → 로그아웃+재로그인 유도
- `api/auth.js` — `guestLogin(nickname)`
- `api/blog.js` — `createComment(blogId, content)` 추가
- `components/LoginModal.jsx` — 닉네임 입력("닉네임으로 시작") *(임시)*
- `components/Layout.jsx` — 헤더에 로그인/로그아웃 + 닉네임
- `pages/PostDetailPage.jsx` — 댓글 폼
  - 로그인 + comments_enabled → 입력폼(작성 후 목록 갱신)
  - 미로그인 → "로그인하고 댓글 작성" 버튼(모달)
  - 댓글 비활성 게시판 → 기존 안내 유지

## 데이터 흐름
```
닉네임 입력 → auth:8001 /auth/guest → JWT+user 저장(localStorage)
→ 댓글 작성 POST blog:8000 /blogs/{id}/comments (Bearer)
→ 공유 secret 검증 → author=유저 → 목록 갱신
```

## 에러 처리
- 닉네임 빈값/길이 초과 → 프론트 검증
- 401(토큰 만료/무효) → 로그아웃 후 재로그인 유도
- 403(댓글 비활성) → 안내 문구

## 비범위 (이후)
- 실제 카카오/구글 OAuth (앱키 준비 후, 동일 토큰 경로로 교체)
- 좋아요, 프로필, 관심종목, 댓글 수정/삭제 UI(백엔드는 이미 존재)


---

# 📄 `docs/superpowers/specs/2026-07-21-phase1-kis-ohlcv-vertical-slice-design.md`

# Phase 1 (a) 수직 슬라이스 — KIS 국내 일봉 수집 파이프라인

- 작성일: 2026-07-21
- **개정 2026-08-06**: 시장코드 `J`(KRX) → **`UN`(KRX+넥스트레이드 통합)** 로 변경. `J` 단독은 넥스트레이드(NXT, 2025-03 출범) 물량이 빠져 MTS 차트와 값이 달랐음(005930 08-05: J C246000/V22.5M vs UN C242000/V43.3M=MTS 일치). "KIS 수집 세부" 절 참조. → 후속 (b) 슬라이스: `docs/superpowers/specs/2026-08-06-phase1b-universe-collection-design.md`
- 관련: `docs/ROADMAP.md`(Phase 1), `docs/screener_plan.md`, `docs/ams-reference/02-data-collection.md`
- ams 원본 참조: `app/kis_worker.py`, `app/tasks/collector/daily_ohlcv_fetcher.py`, `app/libs/external_api/kis_client.py`

## 목표
삼성전자(**005930**) 1종목으로 **KIS 국내 일봉 실수집 → ClickHouse 적재 → stock_api가 CH에서 조회**까지
전 경로를 관통·검증하는 얇은 수직 슬라이스. (전종목·beat·해외·재무·리샘플은 다음 슬라이스)

## 아키텍처 매핑 (ams Sanic/APScheduler → stock_app Celery)
| ams | stock_app |
|---|---|
| `kis_stock('production')` 토큰 | `collector/kis/client.py` + **Redis 토큰 공유 캐시** |
| `DailyOHLCVFetcherJob.process_job` | Celery 태스크 `collect_daily_ohlcv(ticker, start?, end?)` |
| Redis 수동/정기 핸들러 | Celery `.delay()`(수동). beat는 다음 슬라이스 |
| BulkImportJob(큐) | 태스크 내 처리(1종목이라 큐 불필요) |
| 겹침창 `today-30d~+2d` | 동일 채택 |

## 구성 요소
```
backend/apps/collector/
  kis/
    client.py     # OAuth 토큰(Redis 공유 캐시, 재시도/백오프) + 국내 일봉 조회
    fetcher.py    # KIS 응답 → 도메인 OHLCV(dict) 변환 (필드매핑·수정주가)
  repositories/
    clickhouse_ohlcv.py   # OHLCV+MA → daily_prices Bulk Insert (멱등)
  indicators.py   # pandas-ta 기반 MA5/20/50/120 계산 (공용)
  tasks/ohlcv.py  # Celery 태스크 collect_daily_ohlcv
```

## 핵심 결정
### ① ClickHouse 멱등 적재 — `ReplacingMergeTree`
- 현재 `MergeTree`는 겹침 재수집 시 (종목,날짜) 행이 중복됨.
- `ReplacingMergeTree(ingested_at)` + `ORDER BY (ticker, date)` 로 변경 → 최신 적재분만 유지.
- 조회 시 `FINAL`(또는 `argMax`)로 최신만 선택.
- `daily_prices`에 `ingested_at DateTime DEFAULT now()` 컬럼 추가. (데이터 비어있어 스키마 교체 비용 0)

### ② 파생 지표는 "조회 시 계산"
- ClickHouse 저장: **OHLCV + MA5/20/50/120** (+ 기존 bb/rsi/macd 컬럼은 당장 null, 향후 스크리너용).
- 볼린저(σ 가변)·정배열/역배열·매물대는 **stock_api가 읽을 때 계산**(기존 온더플라이 함수 재사용).
- σ 슬라이더·매물대 토글 기능 유지 + 저장 컬럼 단순화.

## KIS 수집 세부
- 엔드포인트: `uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` (응답 `output2` 배열)
- 파라미터: `FID_INPUT_DATE_1/2`(기간), `FID_PERIOD_DIV_CODE='D'`, **`FID_ORG_ADJ_PRC='0'`(수정주가)**, **`FID_COND_MRKT_DIV_CODE='UN'`(KRX+NXT 통합 — MTS와 값 일치)**
  - 시장코드: `J`=KRX 단독, `NX`=넥스트레이드 단독, `UN`=통합(거래량=합산). MTS는 UN 표시 → UN 사용 필수.
  - (참고) `FID_ORG_ADJ_PRC`는 액면분할/병합만 반영, 배당은 미반영 → 수정=원주가 동일. 배당 수정주가는 별개 이슈.
- 필드매핑: `stck_bsop_date→date, stck_oprc→open, stck_hgpr→high, stck_lwpr→low, stck_clpr→close, acml_vol→volume`
- 토큰: `POST /oauth2/tokenP`(client_credentials) → Redis 키 `kis:{mode}:{appkey}` 공유 캐시(TTL ~12h, 발급제한 대응)
- 재시도: 5xx·타임아웃·연결오류만, 지수 백오프. 4xx 즉시 실패.
- 모드: `KIS_MODE`(기본 vps 모의투자) → `KISConfig.base_url`

## stock_api 조회 (하이브리드)
- `getChartData(symbol, ...)`: CH에 해당 ticker 데이터가 있으면 **CH 조회**(FINAL) → 파생지표 계산 → 반환.
- 없으면 기존 **온더플라이 시드**로 폴백. (005930은 CH, 나머지는 시드)

## 에러 처리
- 토큰 발급 실패 → 예외 로그 + 태스크 실패(재시도).
- KIS 4xx(잘못된 종목/파라미터) → 즉시 실패, 로그.
- 빈 응답/휴장일 → 정상(0행 적재 스킵).

## 검증(완료 기준)
1. `collect_daily_ohlcv("005930")` 실행 → CH `daily_prices`에 005930 행 적재.
2. **재실행 시 행 수 불변**(멱등, `SELECT count() ... FINAL`).
3. 어드민/웹 차트에서 005930이 **실데이터**로 렌더(온더플라이 아님).

## 비범위 (다음 슬라이스)
- 전종목 루프 + Celery beat 스케줄 + AsyncLimiter 본격 적용
- 해외 주식/지수, 재무(fundamentals), 리샘플(주/월봉)
- 정배열/역배열·매물대의 CH 컬럼 영속화(스크리너 성능용)


---

# 📄 `docs/superpowers/specs/2026-08-06-phase1b-universe-collection-design.md`

# Phase 1 (b) — 국내 전종목 수집 확장

- 작성일: 2026-08-06
- 선행: `2026-07-21-phase1-kis-ohlcv-vertical-slice-design.md` (a 슬라이스, 005930 1종목)
- 관련: `docs/ROADMAP.md`(Phase 1-b), 메모리 `kis-market-code-un-nxt`

## 목표
(a)에서 검증한 단일 종목 파이프라인을 **국내 전종목(~2,800)** 으로 확장한다.
핵심은 종목 리스트가 15개든 2,800개든 동일한 **수집 인프라**(마스터 로더·레이트리밋·실패격리·beat).

## 구성 요소
```
backend/apps/collector/
  kis/master.py       # KRX 전종목 마스터(.mst) 다운로드/파싱 → (종목코드, 이름, 시장)
  stock_master.py     # load_domestic_tickers(source) — 소스 무관 로더(mst|fallback|auto)
  rate_limit.py       # RateLimiter(per_sec) — 동기 최소간격 보장
  tasks/universe.py   # collect_all_daily / backfill_all_daily (공통 루프 _run_universe)
```

## 핵심 결정
### ① 종목 마스터 = 소스 무관(pluggable), 매 수집마다 재로드
- `STOCK_MASTER_SOURCE`: `mst`(KRX .mst 전종목) | `fallback`(대형주 20) | `auto`(기본: mst→실패시 fallback).
- KIS 시세 API는 "전종목 목록"을 주지 않는다. 신규상장/상장폐지는 **KIS가 매일 갱신하는 .mst를 재다운로드**해야 반영됨 → 수집 태스크가 매 실행 시 `load_domestic_tickers()` 재호출.
- **다운로드 호스트**: `https://new.real.download.dws.co.kr/common/master/{kospi,kosdaq}_code.mst.zip` (dws.co.kr). ⚠️ 초기에 `dw.koreainvestment.com`으로 잘못 넣어 NXDOMAIN → dws.co.kr로 정정. 파싱: 고정폭·CP949, 라인 앞부분 `[0:9]`=단축코드/`[21:]`=한글명, 뒤 228바이트=수치필드.
  - 검증(2026-08-06 로컬 worker): KOSPI+KOSDAQ **4,383 instrument** 로드·수집 성공(주식+ETF/ETN/펀드/스팩 포함). 펀드/투자회사 등은 일봉 빈 응답 → 실패격리로 0행 스킵.

### ② 레이트리밋 = 동기 최소간격
- 수집 루프는 단일 Celery 워커 스레드에서 순차 실행 → `RateLimiter(per_sec)`로 호출 간 최소간격 보장.
- `KIS_RATE_PER_SEC`(기본 8; 실전 ~20/s 한도 내 보수적).
- 현 구조는 **동기 순차**(요청 latency 바운드). 전종목 성능이 부족하면 async(aiolimiter) 병렬로 승격(백로그). ams는 `AsyncLimiter` 사용.

### ③ 실패격리(failure isolation)
- 종목별 `try/except`로 한 종목 실패가 전체 루프를 막지 않음. 실패는 집계·샘플 반환.
- 상장폐지/합병 종목은 빈 응답 → 0행 적재(정상, 예외 아님).

### ④ 시장코드 UN (a에서 확립)
- 전종목도 `FID_COND_MRKT_DIV_CODE='UN'`(KRX+NXT 통합). 기존 J 수집분은 UN 재수집 필요.

## 태스크
| 태스크 | 용도 | 창/범위 |
|---|---|---|
| `collector.collect_all_daily(limit?, source?, rate_per_sec?)` | 전종목 일봉 정기수집 | 겹침창 today-30d~+2d |
| `collector.backfill_all_daily(months=14, ...)` | 전종목 장기 백필(청킹) | 종목별 전 시계열 MA 일괄 |

- MA는 종목별 **전체 시계열에 한 번만** 계산(청크별 계산 시 MA120 깨짐 — a 슬라이스 백필과 동일 원칙).

## Celery beat
- `collect-all-daily`: 매일 **20:30(Asia/Seoul)**. NXT 애프터마켓(~20:00) 종료 후 통합 일봉 확정 시점 이후.

## 검증(완료 기준)
1. `collect_all_daily(source='fallback')` → 다종목 적재, 종목별 MA 계산, 멱등. ✅ (fallback 20 → 18적재, 상폐 2종목 무시, 실패 0)
2. 실환경 `.mst` 로드 → **4,383 instrument** 수집. ✅ (로컬 worker, 정정 URL) — worker+beat 가동, 매일 20:30 자동수집.
3. 종목별 실패가 전체를 막지 않음(격리). ✅

## 비범위 (다음)
- `.mst` 실환경 값검증 + async 병렬 승격
- 해외/지수/재무, 정배열·역배열·매물대 CH 컬럼 영속화
- searchStocks(seed_catalog 15종목)와 수집 마스터 통합(현재 별개)


---

# 📄 `docs/superpowers/specs/2026-08-06-stock-meta-master-unification-design.md`

# stock_meta 종목 마스터 일원화

- 작성일: 2026-08-06
- 관련: `docs/ROADMAP.md`(Phase 1-b, Phase 2 스크리너 전제), 메모리 `kis-market-code-un-nxt`

## 배경 / 문제
종목 마스터가 세 곳에 흩어져 있다:
- `stock_meta`(Postgres, `shared/models.py`): 정의만 있고 **미사용**.
- `seed_catalog`(stock_api): 하드코딩 36종목(국내15+미국+지수) → `searchStocks`·차트 종목해석.
- `.mst`(collector, `stock_master.load_domestic_tickers`): KRX 전종목 → 수집 루프.

→ 국내 종목 정보의 **단일 출처(Single Source of Truth)** 를 `stock_meta`로 일원화한다.

## 범위 결정
- **국내 전용(A)**: `stock_meta` = KRX 전종목(.mst 적재). 미국/지수는 아직 실데이터 없음(온더플라이) → 이번 범위 밖.
- **미국/지수는 하이브리드 유지(A-2)**: `searchStocks`·차트에서 미국/지수는 `seed_catalog` 그대로 사용(회귀 방지). Phase 1-b 해외 연동 시 마스터+시세 함께 교체.
- 미국 종목마스터(`nasmst/nysmst/amsmst.cod`)는 존재하지만, 시세 수집이 별개 작업이라 지금은 도입하지 않음.

## 데이터 흐름
```
KRX .mst (매 수집 시 다운로드)
   │ sync_master: upsert(active) + .mst에 없는 기존종목 is_active=false(상폐)
   ▼
stock_meta (Postgres, 단일 국내 마스터)
   ├── collector : is_active=true KR → 수집 대상
   └── stock_api : stock_meta(KR) 검색·해석 + seed(미국/지수) 병합
```

## 컴포넌트

### ① 스키마 — 변경 없음
`StockMeta(ticker PK, name, market=MarketType{KOSPI,KOSDAQ}, is_active, created/updated)` 가 `.mst`(KR) 를 그대로 수용. 국내는 country=KR/currency=KRW 상수 처리 → **마이그레이션 불필요**.

### ② 공용 리포지토리 `shared/stock_meta_repo.py` (신규, 동기 세션)
- `sync_master(session, rows: list[(ticker,name,market)]) -> dict` — upsert(active) + 누락분 is_active=false. 멱등. 반환 {upserted, deactivated, active_total}.
- `list_active(session) -> list[(ticker,name,market)]` — 수집 대상(collector).
- `search_active(session, query, limit=20) -> list[StockMeta]` — 이름/코드 부분일치(stock_api).
- `get_active(session, ticker) -> StockMeta | None` — 단건(차트 해석).

동기 세션(`SyncSessionLocal`)을 쓴다. stock_api는 이미 ClickHouse를 동기(clickhouse_connect)로 접근하므로 일관적이며, GraphQL 리졸버를 async로 재구성할 필요가 없다.

### ③ collector 변경
- `stock_master.load_domestic_tickers()`: `.mst` 직접 로드 → **stock_meta에서 로드**(비면 .mst 동기화 후 로드, self-healing). `fallback` 정적리스트 유지.
- `collect_all_daily`/`backfill_all_daily` 시작 시 `.mst`→`sync_master` 1회(신규상장/상폐 반영).

### ④ stock_api 변경
- `searchStocks`: `search_active`(KR) + `seed_catalog.search`(미국/지수) 병합, 중복 제거.
- `resolve_stock`(차트): `get_active`(KR) 우선 → 없으면 `seed_catalog.get_by_symbol`(미국/지수).
- 국내 결과는 country=KR/currency=KRW 로 매핑.

## 회귀 방지 (Regression Prevention)
- 미국/지수 검색·차트 그대로 동작(seed 유지).
- stock_meta 최초 비었을 때 자동 .mst 동기화 → 검색/수집 깨지지 않음.
- ClickHouse 하이브리드(수집종목=실데이터, 그 외=온더플라이) 경로 유지.

## 검증(완료 기준)
1. `sync_master` 멱등: 2회 실행 시 active_total 동일, 상폐 종목 is_active=false.
2. `collect_all_daily` 후 stock_meta에 KRX 종목 적재(수천 건), 수집은 stock_meta 기준 동작.
3. `searchStocks("삼성")` → stock_meta(전종목), `searchStocks("애플")` → seed. 둘 다 반환.
4. `getChartData` 국내(005930 CH 실데이터)·미국(AAPL 온더플라이) 정상.

## 비범위 (다음)
- 미국/지수 마스터(.cod) + 해외 시세 수집(Phase 1-b 해외).
- ETF/펀드/스팩 필터링(현재는 .mst 전량 적재).
- searchStocks 랭킹/정렬 고도화.


---

# 📄 `docs/superpowers/specs/2026-09-14-featured-posts-design.md`

# 추천 글(Featured Posts) 큐레이션 — 설계

- 날짜: 2026-09-14
- 상태: 설계 확정 (구현 대기)
- 범위(이번 단위): 관리자가 게시글을 "홈 노출(추천)"로 켜면, **모바일 홈 화면**에 최근에 켠 순으로 노출된다.

## 1. 배경 / 목적

모바일 홈 탭(`mobile/src/app/(tabs)/index.tsx`)은 현재 빈 `ScreenPlaceholder`다. 첫 진입 화면을
관리자가 직접 편성한 **추천 글**로 채워 앱의 첫인상을 만든다.

- **종목 추천은 하지 않는다**(사용자 결정). 큐레이션 대상은 "글"이다.
- 기존 `blog_posts`를 재사용하므로 새 테이블/새 백엔드 스택이 없다(회귀 위험 최소).
- 정렬은 **자동(최근에 켠 순)**. 관리자가 순서를 수동 지정하지 않는다.

## 2. 데이터 모델

`BlogPost`(`backend/shared/models.py:139`)에 컬럼 하나 추가:

```python
featured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

- "추천 켬" = `featured_at = now()`, "끔" = `NULL`.
- `is_featured`라는 개념은 곧 `featured_at IS NOT NULL`.
- 홈 정렬 = `ORDER BY featured_at DESC` → **최근에 켠 글이 맨 위**.

> **왜 불리언이 아니라 타임스탬프인가**: 불리언 하나면 정렬이 `created_at`으로 밀려
> "오래된 글을 위로 고정"이 불가능하다. 타임스탬프 한 컬럼이면 비용은 동일하면서
> "최근에 켠 순"을 정확히 구현한다.

### 마이그레이션 (Alembic)

- **additive & backward-compatible**: `nullable=True`(기본 `NULL`)로만 추가 → *구버전* blog API(이 컬럼을 모르는 코드)는 계속 동작한다.
- ⚠️ **그러나 이번 배포의 신버전 코드는 ORM 모델에 `featured_at` 을 선언**하므로, 대상 DB에 컬럼이 없으면 blog 조회 전반이 500 이 난다. 즉 **마이그레이션이 신버전 코드보다 먼저(또는 함께) 대상 DB에 적용돼야 한다** — "배포 순서 무관" 아님.
- ⚠️ **자동 마이그레이션 없음**: `deploy-server.yml`·`docker-compose.prod.yml`·`Dockerfile` 어디에도 `alembic upgrade` 스텝이 없다(컨테이너는 `uvicorn …` 만 실행). 따라서 배포 담당자가 **수동으로 `alembic upgrade head` 를 대상 DB에 실행**해야 한다(초기 부트스트랩 이후의 모든 마이그레이션에 해당하는 기존 운영 갭).
- ⚠️ **실행 대상 DB 주의(Regression Prevention, CLAUDE.md §6)**:
  `alembic upgrade head`를 **개발서버 DB에 터널로 붙은 상태**로 돌리면
  공유 develop 스키마가 바뀐다(`docs/db_access.md`, `run_and_deploy.md` §3 참고).
  - 로컬 검증은 로컬 DB(`docker-compose.dev.yml`)에서.
  - develop/prod 반영은 서버 배포 시 **수동 `alembic upgrade head` 1회**(조용한 시간, 수집 20:30 회피).

## 3. 백엔드 (blog 서비스, 새 엔드포인트 없음)

기존 `GET /api/v1/blogs`에 필터만 추가한다.

- `apps/blog/routers/blogs.py`: 목록 엔드포인트에 `featured: bool | None = None` 쿼리 파라미터.
- `apps/blog/crud.py`: `featured is True`면 `WHERE featured_at IS NOT NULL ORDER BY featured_at DESC`.
  (기존 필터/정렬은 그대로 — 회귀 없음)
- `apps/blog/schemas.py`:
  - 응답 스키마에 `featured_at`(또는 파생 `is_featured`) 노출.
  - 글 수정(PATCH) 스키마에 `featured: bool | None` 쓰기 필드 추가(관리자 토글용).
- 토글은 기존 글 수정 경로를 재사용: `featured=true` → `featured_at=now()`, `featured=false` → `NULL`.

## 4. 관리자 화면 (admin_web)

`admin_web/src/pages/BlogListPage.jsx` 각 행에 **⭐ 추천 토글 버튼** 추가.

- 클릭 시 추천 on/off 를 PATCH 로 전송.
- 같은 파일 `onDelete`에 이미 있는 **낙관적 업데이트 + 롤백 + `showToast`** 패턴 재사용
  (깜빡임 없이 즉시 반영, 실패 시 롤백 & 토스트).
- 별도 큐레이션 페이지 없이 글 목록에서 바로 편성(가장 적은 클릭).

## 5. 모바일 홈 화면 (client, 이번 단위의 최종 산출)

`mobile/src/app/(tabs)/index.tsx` 를 추천 글 리스트로 교체.

```
┌─ 홈 ───────────────────────┐
│  📌 추천 글                 │  ← 섹션 헤더
│  ┌───────────────────────┐ │
│  │ [썸네일] 제목            │ │  ← BlogCard (blog 탭과 공유)
│  │ 본문 요약 두 줄…        │ │
│  │ 조회 n · 2026.09.10    │ │
│  └───────────────────────┘ │
│  … (featured_at DESC, 최대 N개)
└────────────────────────────┘
```

- 조회: `GET /api/v1/blogs?featured=true&size=N` (기존 모바일 REST 경로 그대로).
- **`BlogCard` 컴포넌트를 `blog.tsx`에서 `mobile/src/features/blog/`로 추출**해
  홈·블로그 탭이 한 카드를 공유(중복 렌더 방지 = 회귀 방지).
- 로딩/에러/빈 상태는 blog 탭 패턴 재사용.
- 빈 상태(추천 글 0개): "아직 추천 글이 없습니다" 안내.

### 탭 동작 (확정: A — 탭 이동 없음)

- 이번 단위는 카드 탭 시 이동 없음. 모바일엔 글 상세 화면이 없고, 블로그 탭도 동일하다.
- 본문 HTML은 TipTap 차트 삽입으로 **base64 PNG data URL**을 포함 → 텍스트 렌더 부적절.
  카드는 `stripHtml` 요약만 표시.
- 상세 보기는 별도 다음 단위(§7)로 둔다.

## 6. 파일 터치 리스트

| 레이어 | 파일 | 변경 |
|---|---|---|
| model | `backend/shared/models.py` (BlogPost) | `featured_at` 컬럼 |
| migration | `backend/alembic/versions/*` | additive nullable 컬럼 추가 |
| schema | `backend/apps/blog/schemas.py` | 응답 필드 + PATCH 쓰기 필드 |
| repo/service | `backend/apps/blog/crud.py` | `featured` 필터 + 정렬 |
| router | `backend/apps/blog/routers/blogs.py` | `featured` 쿼리 파라미터 |
| admin | `admin_web/src/pages/BlogListPage.jsx` | 행별 추천 토글(낙관적 업데이트 재사용) |
| mobile | `mobile/src/features/blog/api.ts` | `featured` 파라미터 + `RawBlog`/`toBlogPost`에 `featured_at` |
| mobile | `mobile/src/features/blog/types.ts` | `featuredAt` 타입 |
| mobile | `mobile/src/features/blog/*` | 추천 글 조회 훅(기존 `use-blog-list` 확장/신규) |
| mobile | `mobile/src/features/blog/blog-card.tsx` (신규) | `BlogCard` 추출 |
| mobile | `mobile/src/app/(tabs)/blog.tsx` | 추출한 `BlogCard` 사용으로 교체 |
| mobile | `mobile/src/app/(tabs)/index.tsx` | 홈 = 추천 글 리스트 |

## 7. 이번 단위에서 제외 (후속 단위 후보)

- **모바일 글 상세 화면**: `mobile/src/app/blog/[id].tsx` + WebView로 HTML(차트 포함) 렌더.
  → 이게 생기면 홈/블로그 카드 탭을 상세로 연결.
- **web_client 추천 섹션**: `web_client/src/pages/HomePage.jsx`는 현재 첫 게시판으로
  리다이렉트만 한다. 웹은 이미 글 상세(`PostDetailPage`, `/posts/:id`)와 `listBlogs`가
  있어, 홈에 추천 섹션을 얹는 것은 저비용 후속 단위.
- 추천 개수 상한/수동 정렬/테마(컬렉션) 그룹핑 — 필요해지면 확장.

## 8. 검증 관점

- 백엔드: `featured=true` 필터가 `featured_at IS NOT NULL`만 반환하고 `featured_at DESC` 정렬.
  기존 `?board_id=` / 페이지네이션 동작 불변(회귀 테스트).
- 마이그레이션: 로컬 DB에서 upgrade/downgrade 왕복 확인.
- admin: 토글 켜고 → 모바일 홈에 즉시 반영(순서 맨 위), 끄면 사라짐.
- 기존 blog 탭 카드 렌더가 추출 후에도 동일(시각 회귀 없음).


---

# 📄 `docs/trading_game_plan.md`

# 🎮 실시간 트레이딩 게임 (Trading Game) 종합 마스터 기획서

> **문서 상태:** 기획 및 아키텍처 확정 (Ready for Implementation)  
> **최종 수정일:** 2026-10-07  
> **대상 서비스:** Web Client (`/web_client`), Admin Web (`/admin_web`), Backend (`/backend`), Mobile (`/mobile`)

---

## 1. 프로젝트 배경 및 기획 방향

### 1.1 기획 의도
- 글로벌 인기 앱인 **'Trading Game: Stocks & Forex'**의 직관적이고 스릴 넘치는 게임 방식을 벤치마킹하여, 주식을 모르는 초보자도 1초 만에 이해하고 즐길 수 있는 가상 트레이딩 게임을 구축한다.
- 기존 증권사 HTS의 난해하고 지루한 진입장벽을 제거하고, **"게임 80% + 교육 20%"** 비율로 플레이하면서 저절로 실전 투자 원칙(리스크 관리, 캔들/이평선 분석, 기업 가치 이해)을 체득하는 **마이크로 러닝(Micro-Learning)**을 구현한다.

### 1.2 왜 일반 HTS 방식이 아닌 'Trading Game' 방식인가?

| 구분 | 일반 증권사 HTS / MTS | 우리가 구축하는 Trading Game | 채택 사유 |
| :--- | :--- | :--- | :--- |
| **체결 방식** | **호가창 대기 (지정가/시장가 매칭)**<br>호가 잔량이 소진되어야 체결 | **원클릭 즉시 체결 (No Waiting)**<br>한투 최신 틱 가격으로 딜레이 없이 즉시 포지션 오픈 | 대기 없는 빠른 속도감과 높은 게임성 제공 |
| **방향성** | **현물 매수(Long Only)** 중심<br>(개인 공매도 제한적) | **Long(상승) / Short(하락) 양방향**<br>하락장에서도 숏 베팅 가능 | 하락장에서도 랭킹 역전 및 배틀 가능 |
| **레버리지** | 신용융자 등 복잡한 조건 필요 | **x1, x2, x5 배율 선택** | 작은 시세 변동에도 짜릿한 손익 변동성 제공 |
| **인터페이스** | 복잡한 호가창, 수량/가격 다이얼로그 | 캔들 차트 하단 **큰 [BUY 📈] / [SELL 📉] 버튼 2개** | 모바일/웹 어디서나 원터치 플레이 |
| **포지션 피드백** | 잔고 평가 화면 별도 조회 | 포지션 카드에 **실시간 손익(+15.4%, +₩150,000) 카운팅** | 즉각적인 도파민과 시각적 몰입도 극대화 |

---

## 2. 핵심 게임 규칙 & 시즌제 운영 정책

### 2.1 시즌제 운영 (1달 주기)
1. **시즌 운영 주기**: 매월 1일 09:00 시작 ~ 매월 말일 15:30 정규장 마감 시 종료 (1개월 시즌).
2. **1개 종목 고정 배틀 (Fair Play)**:
   - 유저가 종목을 개별 선택하는 것이 아니라, 시스템이 **시즌 대표 종목 1개**를 지정 (예: 삼성전자, SK하이닉스, KODEX 레버리지 등 유동성이 풍부한 대형주).
   - 모든 유저가 완전히 동일한 차트와 시장 상황에서 승부하므로 운이 아닌 실력 기반의 공정한 경쟁 성립.
3. **가상 시드머니**: 시즌 시작 시 전 유저에게 동일하게 **10,000,000원** 지급.
4. **시즌 마감 및 초기화 (Reset)**:
   - 말일 15:30 장 마감 즉시 보유 중인 모든 포지션은 최종 체결가로 자동 시장가 청산.
   - 최종 수익률(ROI %) 확정 후 **최고 수익률 순으로 1위~100위를 [명예의 전당]에 영구 박제**.
   - 다음 달 1일이 되면 새 종목 발표와 함께 모든 유저의 자본금이 1,000만 원으로 전원 리셋.

### 2.2 주문 및 포지션 룰
- **포지션 방향**: 
  - `BUY (Long)`: 주가 상승 시 수익
  - `SELL (Short)`: 주가 하락 시 수익
- **투자 비중 조절**: 25% / 50% / 100%(전액) 원터치 칩 버튼.
- **배율 (Multiplier)**: 1x (현물), 2x, 5x 중 선택.
  - *[추가]* **아카데미 해금(Unlock) 시스템**: 5배 레버리지 등 고위험 기능은 '리스크 관리 퀴즈'를 수료해야 해금.
- **자동 익절/손절 (Take Profit / Stop Loss)**:
  - 포지션 진입 시 슬라이더로 TP(+5%, +10%) 및 SL(-2%, -5%)을 설정 가능. 시세 도달 시 자동 청산.
- **수수료 및 세금**: 가상 편도 수수료 0.015% 반영.
- **시장 심리(Sentiment) 미터기**: 실시간 게임 참여 유저들의 Long vs Short 베팅 비율을 노출하여 전략적 재미 제공.

---

## 3. 24시간 에듀테인먼트 시스템 (4대 교육 모듈)

장이 열리는 낮 시간과 장이 닫히는 밤/주말 시간대를 분리하여 24시간 끊김 없는 재미와 교육을 제공한다.

```mermaid
flowchart TD
    subgraph DayLoop ["☀️ 낮 시간 (09:00 ~ 15:30) : 실시간 장중 라이브 배틀"]
        D1["한투 실시간 소켓 1종목 시세 스트리밍"] --> D2["[BUY / SELL] 원클릭 트레이딩 배틀"]
        D2 -->|매매 순간| D3["[교육 1-B] 상황별 스마트 넛지<br>(과매수 경고, 원칙 손절 칭찬 등)"]
        D2 -->|차트 상단| D4["[교육 1-A] 관리자 모닝 브리핑 & 지지/저항선<br>[교육 4] 1달 종목 펀더멘털 이슈 카드"]
    end

    subgraph NightLoop ["🌙 야간 / 주말 (15:30 ~ 익일 09:00) : 애프터마켓 러닝"]
        N1["실제 장 마감 (휴장)"] --> N2["[교육 1-A] 관리자 장마감 복기 리포트"]
        N1 --> N3["[교육 3] 10초 차트 패턴 퀴즈<br>(블라인드 차트 맞히기)"]
        N3 -->|정답 보상| N4["다음 날 쓸 수 있는 가상머니 / 경험치 획득"]
    end

    subgraph SeasonLoop ["🏆 시즌 전체 (1달) 동기부여"]
        S1["[교육 2] 단계별 트레이딩 퀘스트<br>(손절선 설정, 분할매수 실천)"]
        S2["실시간 랭킹 (Top 100) & 말일 명예의 전당 등재"]
    end

    D2 --> S1
    N4 --> D2
    D2 --> S2
```

### 3.1 투 트랙(2-Track) 스마트 코치 시스템
1. **Track 1: 관리자 데일리 시황 코치 (Admin-Managed Daily)**
   - **모닝 브리핑 (장전 08:30 등록)**:
     - 오늘 시황 전망, 예상 시나리오, 오늘의 추천 지지선/저항선 입력.
     - 지지선/저항선은 **유저 차트에 보라색/주황색 점선으로 자동 오버레이**되어 차트 분석 실전 감각을 길러줌.
   - **이브닝 마감 복기 (장후 15:40 등록)**:
     - 오늘 주가 변동 원인(외인/기관 수급, 뉴스) 분석.
     - 오늘 랭킹 상위 트레이더들의 매매 타이밍(진입/청산) 복기 해설.
2. **Track 2: 인-게임 실시간 액션 코치 (Rule-based Real-time)**
   - 매매 순간 1~2초간 토스트/말풍선 피드백:
     - RSI 80 이상 과매수 구간 추격매수 시: ⚠️ *"과열 구간입니다! 추격 매수는 위험해요."*
     - -2% 이내 손절 청산 시: 💡 *"원칙대로 손실을 잘 끊어냈습니다! 훌륭한 자금 관리입니다."*
     - 자본금 100% 몰빵 시: 💬 *"몰빵 대신 분할 매수로 리스크를 관리해 보세요."*

### 3.2 단계별 트레이딩 퀘스트 (Duolingo Style)
- **Quest 1:** 첫 Stop-Loss(손절선) 걸고 거래해보기 $\rightarrow$ 보상: + 가상머니 50만 원
- **Quest 2:** 이동평균선 골든크로스 발생 시 매수하기 $\rightarrow$ 보상: + 가상머니 100만 원
- **Quest 3:** 1회 거래 시 자본금 20% 이하로 3회 분할 매수하기 $\rightarrow$ 보상: '원칙주의자' 배지
- **Quest 4:** 손익비 2:1 이상으로 익절하기 $\rightarrow$ 보상: + 랭킹 보너스 점수

### 3.3 연속 출석(Streak) 및 습관 형성
- **Streak 시스템:** 매일 아침 '모닝 브리핑'을 읽거나 1회 이상 매매 시 Streak 불꽃이 유지됨.
- 특정 연속 출석일 달성 시 추가 가상머니 및 프로필 뱃지 보상 지급.

### 3.4 시즌 마감 'Trading MBTI' 리포트
- 단순 수익률 랭킹 외에 개인의 매매 패턴을 분석한 맞춤형 리포트 제공.
- 예: "냉철한 원칙주의자 (손절 준수율 90%)", "불나방 (RSI 과매수 구간 추격매수 비율 높음)" 등의 칭호 부여.

### 3.5 야간/주말 차트 퀴즈 (Pattern Hunter)
- 장이 끝난 야간/주말 유저 이탈을 방어하는 핵심 킬러 기능.
- 실제 과거 차트의 뒷부분을 가려놓고 10초 내에 **[오를까? 📈] [내릴까? 📉]** 선택.
- 정답 공개 시 망치형 캔들, 이중바닥, 헤드앤숄더 등 패턴 해설 제공 및 가상 시드머니 지급.

### 3.4 1달 종목 기업 이슈 카드
- 차트 상단에 배치되는 3줄 카드:
  - 📊 핵심 밸류: PER 12배, PBR 1.1배 (업종 평균 대비 저평가)
  - 📰 수급/뉴스: "외국인 4일 연속 순매수", "D램 가격 반등 호재"

---

## 4. UI / UX 화면 와이어프레임

### 4.1 유저 플레이 화면 (Web Client / Mobile)
```
┌─────────────────────────────────────────────────────────────┐
│ [시즌 1기] 삼성전자 (005930) | 종료 D-18     내 순위: 24위 / +24.5%│
│ 자본금: ₩12,450,000      [🏆 랭킹] [🤝 지인리그] [🎯 퀘스트]│
├─────────────────────────────────────────────────────────────┤
│ 🌅 [오늘의 코치 가이드] "71,000원 지지선 반등 여부를 주목하세요!" (▼)│
├─────────────────────────────────────────────────────────────┤
│ 📊 유저 베팅 심리: [ 🔴 Long 65%  |  🔵 Short 35% ]          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  73,500 ------------------------------------ [추천 저항선]  │
│                   ▲  캔들 차트 (실시간 틱 반영)              │
│  71,000 - - - - - - - - - - - - - - - - - - [추천 지지선]  │
│                                                             │
│  💬 [코칭 팝업]: "RSI 78 돌파! 추격 매수는 물릴 위험이 높아요"│
├─────────────────────────────────────────────────────────────┤
│ [내 포지션] 삼성전자 LONG x2배  |  평가손익: +₩180,000 (+14.4%) │
│ 진입가: 71,200원 (현재가 72,100원)      [즉시 전액 청산하기]  │
├─────────────────────────────────────────────────────────────┤
│ 비중: [ 25% ]  [ 50% ]  [ 100% ]       배율: [ 1x ]  [ 2x ]  [ 5x ] │
│    [ 📈 BUY (상승 베팅) ]          [ 📉 SELL (하락 베팅) ]    │
└─────────────────────────────────────────────────────────────┘
 * 15:30 이후: 차트 영역이 [🧩 야간 10초 차트 퀴즈 도전!] 모드로 전환
```

### 4.2 관리자 웹 화면 (`admin_web` - 스마트 코치 관리)
```
[관리자 웹 > 트레이딩 게임 > 데일리 스마트 코치 발행]
───────────────────────────────────────────────────────────────
• 시즌 선택 : [ 시즌 1기 - 삼성전자 (005930) ▼ ]
• 발행 유형 : 🔘 장전 모닝 브리핑 (08:30)   ⚪ 장마감 이브닝 복기 (15:40)
• 적용 일자 : 2026-10-07
• 차트 상단 1줄 롤링 멘트 :
  [ 미국 반도체 지수 +3% 급등! 시초가 갭상승 후 71,000원 지지 확인 권장 ]
• 오늘의 핵심 가격 라인 (차트 위 자동 점선 오버레이) :
  - 추천 지지선: [ 71,000 ] 원
  - 추천 저항선: [ 73,500 ] 원
• 상세 시황 코칭 본문 (Markdown 에디터) :
  [ 오늘 새벽 엔비디아 실적 기대감으로 필라델피아 반도체 지수가 강세를 보였습니다... ]
───────────────────────────────────────────────────────────────
[  임시저장  ]    [ 🚀 유저 화면에 실시간 발행하기 ]
```

---

## 5. 시스템 아키텍처 및 데이터 흐름

```mermaid
flowchart TD
    subgraph KIS ["한국투자증권 (KIS OpenAPI)"]
        KW["KIS WebSocket Server<br>(H0STCNT0 실시간 체결가)"]
    end

    subgraph Backend ["우리 백엔드 (FastAPI + Redis + DB)"]
        subgraph Daemon ["수집 데몬"]
            CONSUMER["KIS WebSocket Consumer<br>(단일 세션 유지 & 자동 재연결)"]
        end

        subgraph RedisLayer ["Redis (초고속 인메모리)"]
            PUB_SUB["Redis Pub/Sub<br>(channel: stock:tick:{ticker})"]
            ZSET["Redis Sorted Set<br>(game:season:{id}:ranking)"]
        end

        subgraph CoreApp ["FastAPI Services"]
            WS_GATEWAY["Client WebSocket Gateway<br>(실시간 Fan-out 브로드캐스트)"]
            ORDER_ENG["가상 주문/체결 엔진<br>(시장가 체결 & TP/SL 모니터링)"]
            ADMIN_API["Admin / Coach / Quest API"]
        end

        subgraph DB ["PostgreSQL"]
            PG_DB[("PostgreSQL DB<br>(seasons, accounts, positions,<br>trades, hall_of_fame, coach_msgs)")]
        end
    end

    subgraph Client ["프론트엔드 (Web / Mobile)"]
        UI_USER["유저 트레이딩 화면<br>(Web Client & Mobile)"]
        UI_ADMIN["관리자 웹 화면<br>(Admin Web)"]
    end

    KW -->|실시간 체결 틱| CONSUMER
    CONSUMER -->|Tick 발행| PUB_SUB
    PUB_SUB -->|최신 시세 스트림| WS_GATEWAY
    PUB_SUB -->|최신가 참조| ORDER_ENG

    WS_GATEWAY -->|WebSocket 중계| UI_USER
    UI_USER -->|주문 / 청산 요청| ORDER_ENG
    ORDER_ENG -->|잔고 및 포지션 저장| PG_DB
    ORDER_ENG -->|실시간 수익률 갱신| ZSET

    ZSET -->|실시간 랭킹 Top 100| UI_USER
    UI_ADMIN -->|스마트 코치 시황 발행| ADMIN_API
    ADMIN_API -->|코칭 데이터 저장| PG_DB
    PG_DB -->|코칭 멘트 & 지지/저항선| UI_USER
```

---

## 6. 데이터베이스 테이블 설계 (PostgreSQL)

### 6.1 `game_seasons` (시즌 마스터)
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | Serial (PK) | 시즌 식별자 |
| `season_number` | Integer | 시즌 기수 (예: 1, 2, ...) |
| `ticker` | Varchar(20) | 시즌 고정 종목 코드 (예: '005930') |
| `stock_name` | Varchar(50) | 종목명 (예: '삼성전자') |
| `start_at` | Timestamp | 시즌 시작일시 (매월 1일 09:00) |
| `end_at` | Timestamp | 시즌 종료일시 (매월 말일 15:30) |
| `initial_cash` | BigInt | 시작 자본금 (기본: 10,000,000) |
| `status` | Varchar(20) | 'READY', 'ACTIVE', 'FINISHED' |

### 6.2 `game_accounts` (유저 시즌별 가상 계좌)
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 계좌 ID |
| `user_id` | UUID (FK) | 유저 식별자 |
| `season_id` | Integer (FK) | 참가 시즌 ID |
| `cash_balance` | Numeric(15,2) | 보유 현금(예수금) |
| `total_asset` | Numeric(15,2) | 예수금 + 포지션 평가자산 |
| `current_roi` | Numeric(8,4) | 현재 수익률 (%) |
| `max_roi` | Numeric(8,4) | 시즌 중 기록한 최고 수익률 (%) |
| `total_trades` | Integer | 총 거래 횟수 |
| `win_trades` | Integer | 익절 성공 횟수 |

### 6.3 `game_positions` (활성 포지션)
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 포지션 ID |
| `account_id` | UUID (FK) | 계좌 ID |
| `side` | Varchar(10) | 'LONG' (상승) / 'SHORT' (하락) |
| `entry_price` | Numeric(12,2) | 진입 체결단가 |
| `size_amount` | Numeric(15,2) | 투자 원금 |
| `leverage` | Integer | 레버리지 배율 (1, 2, 5) |
| `stop_loss_price` | Numeric(12,2) | 손절 기준가 (선택) |
| `take_profit_price` | Numeric(12,2) | 익절 기준가 (선택) |
| `status` | Varchar(20) | 'OPEN', 'CLOSED' |
| `created_at` | Timestamp | 진입 일시 |

### 6.4 `game_trades` (청산 완료 내역)
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 거래 ID |
| `account_id` | UUID (FK) | 계좌 ID |
| `side` | Varchar(10) | 'LONG' / 'SHORT' |
| `entry_price` | Numeric(12,2) | 진입가 |
| `exit_price` | Numeric(12,2) | 청산가 |
| `pnl_amount` | Numeric(15,2) | 실현 손익금 |
| `roi_pct` | Numeric(8,4) | 실현 수익률 (%) |
| `closed_reason` | Varchar(20) | 'MANUAL', 'TAKE_PROFIT', 'STOP_LOSS', 'SEASON_END' |
| `closed_at` | Timestamp | 청산 일시 |

### 6.5 `hall_of_fame` (명예의 전당 아카이브)
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | Serial (PK) | 기록 ID |
| `season_id` | Integer (FK) | 시즌 ID |
| `rank` | Integer | 최종 순위 (1~100) |
| `user_id` | UUID (FK) | 유저 ID |
| `user_nickname` | Varchar(50) | 닉네임 |
| `final_roi` | Numeric(8,4) | 최종 수익률 (%) |
| `final_asset` | Numeric(15,2) | 최종 총자산 |
| `win_rate` | Numeric(5,2) | 승률 (%) |

### 6.6 `game_coach_messages` (관리자 스마트 코치 브리핑)
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | Serial (PK) | 메시지 ID |
| `season_id` | Integer (FK) | 시즌 ID |
| `target_date` | Date | 코칭 적용 날짜 |
| `coach_type` | Varchar(20) | 'MORNING', 'EVENING', 'IN_PLAY' |
| `title` | Varchar(100) | 브리핑 제목 |
| `summary_nudge` | Varchar(200) | 차트 상단 1줄 롤링 텍스트 |
| `content_md` | Text | 상세 시황 및 전략 마크다운 본문 |
| `support_price` | Numeric(12,2) | 차트 위 추천 지지선 (Nullable) |
| `resistance_price`| Numeric(12,2) | 차트 위 추천 저항선 (Nullable) |
| `published_at` | Timestamp | 발행 일시 |
| `author_id` | UUID (FK) | 작성 관리자 ID |

### 6.7 `chart_quiz_pool` (야간 차트 패턴 퀴즈 풀)
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | Serial (PK) | 퀴즈 ID |
| `ticker` | Varchar(20) | 퀴즈 대상 종목 코드 |
| `pattern_type` | Varchar(50) | 패턴 분류 (예: '망치형캔들', '이중바닥', '골든크로스') |
| `chart_snapshot` | JSON | 가려진 시점까지의 캔들 OHLCV 배열 |
| `answer` | Varchar(10) | 정답 ('UP', 'DOWN') |
| `actual_change` | Numeric(6,2) | 이후 실제 변동률 (%) |
| `explanation` | Text | 패턴 기술적 분석 교육 해설 |
| `reward_cash` | Integer | 맞췄을 때 지급하는 가상머니 (예: 200,000원) |

### 6.8 `user_streaks` (연속 출석 및 참여 데이터)
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `user_id` | UUID (PK) | 유저 식별자 |
| `current_streak` | Integer | 현재 연속 달성 일수 |
| `highest_streak` | Integer | 최대 연속 달성 일수 |
| `last_activity_date`| Date | 마지막 활동(모닝 브리핑 조회/매매) 일자 |

### 6.9 `private_leagues` (지인 리그)
| 컬럼명 | 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 리그 ID |
| `season_id` | Integer (FK) | 해당 리그가 속한 시즌 ID |
| `league_name` | Varchar(50) | 리그 이름 (예: "우리끼리 단타대회") |
| `owner_id` | UUID (FK) | 방장 유저 ID |
| `invite_code` | Varchar(10) | 초대 코드 |

---

## 7. 단계별 개발 로드맵 (Milestones)

```
[Phase 1: 기획 확정 및 DB 스키마 마이그레이션]
  ├── 게임 테이블 모델링 (SQLAlchemy) & 마이그레이션 (Alembic)
  └── 기초 데이터 시딩 (시즌 1기 생성, 차트 퀴즈 20문항)

[Phase 2: 한투 실시간 WebSocket 시세 수집기 구축]
  ├── KIS 실시간 WebSocket Client (H0STCNT0 TR 연동)
  ├── 수집 데몬 프로세스 & 자동 재연결 로직 구현
  └── Redis Pub/Sub 채널 발행 검증

[Phase 3: 가상 체결 엔진 및 클라이언트 중계 WS Gateway]
  ├── FastAPI WebSocket Gateway (클라이언트 시세 중계)
  ├── 원클릭 가상 주문/체결 (BUY/SELL) 및 자동 TP/SL 감시 엔진
  └── 실시간 PnL 계산 및 마진콜(강제청산) 처리

[Phase 4: 실시간 랭킹 & 시즌 정산 시스템]
  ├── Redis ZSET 기반 실시간 랭킹 (Top 100) 정산 API
  └── 시즌 마감 스케줄러 (Celery Beat) & 명예의 전당 적재

[Phase 5: 교육 & 스마트 코치 모듈 + 관리자 웹(admin_web)]
  ├── [admin_web] 관리자 스마트 코치 작성/발행 페이지 개발
  ├── 인-게임 실시간 상황별 코칭(Nudge) 룰 엔진
  ├── 단계별 퀘스트 로직 및 보상 처리
  └── 야간 10초 차트 퀴즈 API

[Phase 6: 프론트엔드 UI 화면 구현 (web_client / mobile)]
  ├── 실시간 캔들 차트 & 원클릭 매수/매도 트레이딩 패널
  ├── 차트 위 관리자 지지선/저항선 오버레이 & 코칭 배너
  ├── 실시간 랭킹 & 명예의 전당 뷰
  └── 야간 퀴즈 모달 & 퀘스트 뷰
```


---

# 📄 `docs/windows_setup.md`

# Windows 개발 환경 설정 가이드 (Windows Setup Guide)

이 문서는 Windows 11 환경에서 `stock_app` 프로젝트의 로컬 개발 환경(인프라 DB, 백엔드 마이크로서비스, 웹 프론트엔드, 모바일 앱)을 구성하고 운용하는 방법을 정리한 가이드입니다.

---

## 1. 아키텍처 및 런타임 구성

Windows 환경에서는 **Windows 네이티브(PowerShell/CMD)** 와 **WSL2 (Ubuntu 24.04)** 를 결합한 하이브리드 구성을 사용합니다.

```
[Windows Host]
  ├─ 소스 코드 저장소: E:\work_space\stock
  ├─ Git (MinGit 2.56.0)
  ├─ uv (0.12.23) + Python 3.12.15 (backend/.venv)
  ├─ Node.js (v24 LTS) & npm (v11)
  └─ docker / docker-compose (WSL2 엔진 연동 shim)
        │
        ▼ (WSL2 상호운용 / NAT 네트워크)
[WSL2 - Ubuntu 24.04]
  ├─ 마운트 경로: /mnt/e/work_space/stock
  ├─ Docker Engine (29.1.3) + systemd 자동실행
  └─ 컨테이너: stock_postgres(5432), stock_clickhouse(8123), stock_redis(6379)
```

- **파일 동기화**: `E:\work_space\stock`은 WSL2의 `/mnt/e/work_space/stock`으로 실시간 마운트되므로 코드가 완벽히 공유됩니다.
- **포트 공유**: WSL2에서 열린 포트(5432, 8123, 6379) 및 각 서비스 포트(8001, 8000, 8002, 5173, 3000)는 Windows 브라우저와 개발 도구에서 `localhost`로 그대로 접근 가능합니다.

---

## 2. 설치 도구 및 PATH 등록 정보

모든 도구는 UAC(관리자 권한 승인 창) 없이 일반 사용자 권한으로 설치되어 있으며, Windows 사용자 환경 변수(`User PATH`)에 영구 등록되어 있습니다.

| 도구 | 설치 경로 / 방식 | 비고 |
|---|---|---|
| **Git** | `%LOCALAPPDATA%\Programs\Git\cmd` | MinGit 64-bit |
| **Java 매니저 (vfox)** | `%LOCALAPPDATA%\Programs\Git\cmd\vfox.exe` | Java 다중 버전 관리 (`JAVA_HOME` 자동 관리) |
| **Java (JDK 17 LTS)** | `%USERPROFILE%\.vfox\sdks\java` | OpenJDK 17 (React Native 표준) |
| **Python 매니저 (Conda)** | `%USERPROFILE%\miniconda3\Scripts\conda.exe` | Miniconda 26.7.1 가상환경 관리 |
| **Python 빌더 (uv)** | `%LOCALAPPDATA%\Microsoft\WinGet\Packages\astral-sh.uv_*` | 백엔드 가상환경/패키지 고속 동기화 |
| **Node 매니저 (fnm / nvm)** | `%LOCALAPPDATA%\Programs\Git\cmd\fnm.exe`, `nvm.cmd` | Node.js 다중 버전 관리 (nvm 명령어 호환) |
| **Docker Shim** | `%LOCALAPPDATA%\Programs\Git\cmd\docker.cmd` | WSL2 Docker 호출 래퍼 |
| **Docker Compose** | `%LOCALAPPDATA%\Programs\Git\cmd\docker-compose.cmd` | WSL2 Docker Compose 호출 래퍼 |

### 2-1. 버전 매니저 설정 상세 및 사용법 (Version Management)

모바일(React Native), 백엔드(FastAPI), 프론트엔드(React) 개발 시 라이브러리 간 호환성을 보장하기 위해 Java, Python, Node.js 버전 매니저가 각각 구성되어 있습니다.

```
[버전 매니저 체계]
  ├─ Java   : vfox (VersionFox) ──> JAVA_HOME 자동 스위칭 (%USERPROFILE%\.vfox\sdks\java)
  ├─ Python : Conda (Miniconda3) ──> 가상환경 격리 (%USERPROFILE%\miniconda3)
  │           └─ (보조) uv       ──> backend/.venv 고속 패키지 동기화
  └─ Node   : fnm (nvm 래퍼)     ──> Node.js 버전 전환 (%LOCALAPPDATA%\fnm_multishells)
```

#### ☕ Java 버전 관리 (`vfox`)
Android 빌드 및 Gradle 도구는 환경변수 **`JAVA_HOME`** 을 기반으로 동작합니다. `vfox`는 버전을 전환할 때 레지스트리의 `JAVA_HOME`과 심볼릭 링크(`%USERPROFILE%\.vfox\sdks\java`)를 자동으로 갱신하므로, **Android Studio나 빌드 스크립트를 재설정할 필요가 없습니다.**

- **자주 쓰는 명령어**:
  ```cmd
  vfox search java                      # 설치 가능한 Java 버전 목록 조회
  vfox install java@17.0.2+8            # Java 17 LTS 설치 (React Native / Expo SDK 57 표준)
  vfox install java@11.0.16+8           # Java 11 LTS 설치 (구형 안드로이드 빌드용)
  vfox install java@21.0.2+13           # Java 21 LTS 설치 (최신 도구용)
  vfox use -g java@17.0.2+8             # 전역(Global) 기본 버전을 17로 지정 (JAVA_HOME 자동 변경)
  vfox use -p java@17.0.2+8             # 현재 디렉터리(.tool-versions) 전용 버전 설정
  vfox list java                        # 로컬에 설치된 Java 버전 목록 확인
  java -version                         # 활성화된 Java 버전 확인
  ```
- **JAVA_HOME 확인**:
  ```cmd
  echo %JAVA_HOME%                      # C:\Users\<사용자>\.vfox\sdks\java 출력 확인
  ```

#### 🐍 Python 가상환경 및 버전 관리 (`conda`)
`CLAUDE.md` 규칙에 정의된 백엔드 가상환경(`stock_app`)을 생성하고 관리할 수 있습니다.

- **자주 쓰는 명령어**:
  ```cmd
  conda create -n stock_app python=3.12 -y   # 프로젝트 권장 Python 3.12 가상환경 생성
  conda activate stock_app                 # stock_app 가상환경 활성화
  conda deactivate                         # 가상환경 비활성화
  conda env list                           # 설치된 가상환경 목록 확인
  conda env remove -n <이름>                # 가상환경 삭제
  ```
- **Conda와 uv 연동**:
  - `conda activate stock_app` 활성화 후 `backend/` 폴더에서 `uv sync`를 실행하면, Conda 가상환경과 완벽히 동기화되어 독립적인 패키지 관리가 가능합니다.

#### 🟢 Node.js 버전 관리 (`nvm` / `fnm`)
`nvm` 명령어가 고속 Rust 기반 엔진인 `fnm`으로 연결되어 있으며, `.nvmrc` 및 `.node-version` 파일을 지원합니다.

- **자주 쓰는 명령어**:
  ```cmd
  nvm install 20                        # Node.js 20 LTS 버전 설치
  nvm install 22                        # Node.js 22 LTS 버전 설치
  nvm install 24                        # Node.js 24 LTS 버전 설치 (현재 기본)
  nvm use 20                            # 현재 세션에서 Node 20으로 전환
  nvm default 22                        # 전역 기본 버전을 Node 22로 지정
  nvm list                              # 설치된 Node.js 버전 목록 확인
  node -v                               # 현재 Node 버전 확인
  ```

---

## 3. WSL2 및 Docker 권한 설정

WSL2 내부의 일반 사용자(`kyu`)가 `sudo`나 권한 오류 없이 Docker를 사용할 수 있도록 아래 설정이 완료되어 있습니다:

1. **Docker 그룹 권한**:
   ```bash
   sudo usermod -aG docker kyu
   ```
2. **Docker 데몬 자동 실행**:
   `/etc/wsl.conf`에 `systemd=true` 활성화 및 `systemctl enable docker` 설정 완료.
3. **sudo 패스워드리스 (NOPASSWD)**:
   개발 편의를 위해 `/etc/sudoers.d/kyu`에 `kyu ALL=(ALL) NOPASSWD:ALL` 구성 완료 (계정 기본 비번: `1234`).

---

## 4. 로컬 인프라 및 서비스 실행 방법

### 방법 A: Windows 원클릭 스크립트 활용 (추천)
`scripts/` 폴더에 배치 스크립트가 준비되어 있습니다:

- **DB 시작 (최초 1회 또는 재부팅 후)**:
  ```cmd
  scripts\start-infra.cmd
  ```
  PostgreSQL(5432), ClickHouse(8123), Redis(6379) 컨테이너가 백그라운드 구동됩니다.
- **전체 서비스 일괄 실행**:
  ```cmd
  scripts\start-services.cmd
  ```
  인증(8001), 블로그(8000), 주식API(8002), 관리자웹(5173), 유저웹(3000)이 각각의 콘솔 창으로 뜹니다.
- **DB 정지**:
  ```cmd
  scripts\stop-infra.cmd
  ```

### 방법 B: Windows 터미널(PowerShell/CMD) 수동 실행
```powershell
# 백엔드 의존성 및 테스트
cd backend
uv run pytest

# 서비스 개별 실행
uv run uvicorn apps.auth.main:app      --reload --port 8001
uv run uvicorn apps.blog.main:app      --reload --port 8000
uv run uvicorn apps.stock_api.main:app --reload --port 8002

# 웹 프론트엔드
cd admin_web  && npm run dev   # http://localhost:5173
cd web_client && npm run dev   # http://localhost:3000
```

### 방법 C: WSL2 터미널(Ubuntu)에서 실행
```bash
cd /mnt/e/work_space/stock

# 백엔드 실행
cd backend
uv run uvicorn apps.auth.main:app --reload --port 8001

# 프론트엔드 실행
cd /mnt/e/work_space/stock/admin_web
npm run dev
```

---

## 5. 모바일 앱 (`mobile/`) 개발 가이드

모바일 프로젝트는 **React Native (Expo SDK 57) + expo-router + Unistyles v3** 기반입니다.

### Q: 모바일 개발은 어디서 어떻게 진행하나요?
모바일 앱 소스 코드는 루트의 **[`mobile/`](../mobile)** 디렉터리에 위치하며, Windows에서 아래 3가지 방식으로 개발을 진행합니다:

### (1) 웹 브라우저 모드 (`npm run web`) — 가장 빠르고 간편 (추천)
UI 구조, 레이아웃, 상태 관리(Zustand), GraphQL/REST API 연동 등 대부분의 기능 개발은 브라우저에서 모바일 뷰로 즉시 확인 가능합니다.
```powershell
cd mobile
npm run web
```
- 브라우저가 열리며 핫 리로딩(코드 저장 시 즉시 화면 갱신)이 지원됩니다.
- 별도의 모바일 에뮬레이터나 빌드 대기 시간 없이 즉시 개발할 수 있습니다.

### (2) Android 개발 빌드 (`npm run android`)
실제 스마트폰 터치 인터랙션, 네이티브 모듈 검증이 필요할 때 사용합니다.
- **사전 요구사항**: Windows에 [Android Studio](https://developer.android.com/studio) 설치 및 Android SDK, 환경변수(`ANDROID_HOME`) 설정 필요.
- **주의사항**:
  - 본 프로젝트는 C++ 네이티브 모듈인 **Unistyles v3**를 사용하므로 앱스토어의 기본 **Expo Go 앱에서는 구동되지 않습니다**.
  - 최초 1회 **개발 클라이언트 빌드(Dev Build)** 를 기기/에뮬레이터에 설치해야 합니다:
    ```powershell
    cd mobile
    npm run android                # 에뮬레이터 실행
    npm run android:dev:device     # USB 디버깅 연결된 안드로이드 실기기
    ```
- **실기기 테스트 시 API 주소**:
  - 스마트폰 실기기는 개발 PC의 `localhost`에 직접 닿지 않으므로, `mobile/.env.development`의 URL을 개발 PC의 로컬 네트워크 IP(예: `http://192.168.0.x:8000`)로 변경해야 합니다.

### (3) iOS 개발 빌드
- iOS 시뮬레이터 및 IPA 빌드는 **macOS (Xcode)** 환경이 필수입니다.
- Windows 단독 환경에서는 iOS 네이티브 빌드가 불가하므로, 다음 방법을 사용합니다:
  - 평소 개발: **웹 모드(`npm run web`)** 또는 **Android 에뮬레이터**로 로직 및 UI 검증
  - iOS 실기기 검증: EAS Cloud Build(`eas build --profile development --platform ios`) 활용

---

## 6. 접속 정보 요약

- **관리자 웹**: [http://localhost:5173](http://localhost:5173) (계정: `admin@stock.app` / `admin1234`)
- **일반 유저 웹**: [http://localhost:3000](http://localhost:3000)
- **Auth API Swagger**: [http://localhost:8001/docs](http://localhost:8001/docs)
- **Blog API Swagger**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Stock GraphQL**: [http://localhost:8002/graphql](http://localhost:8002/graphql)
- **DB 포트**: PostgreSQL `5432`, ClickHouse `8123`, Redis `6379`


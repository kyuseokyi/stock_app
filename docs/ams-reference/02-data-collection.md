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

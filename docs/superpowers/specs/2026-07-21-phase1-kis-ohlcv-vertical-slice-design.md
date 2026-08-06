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

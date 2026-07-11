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

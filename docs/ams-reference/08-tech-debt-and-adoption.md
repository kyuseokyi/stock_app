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

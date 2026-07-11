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

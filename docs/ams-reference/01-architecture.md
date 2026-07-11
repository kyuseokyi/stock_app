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

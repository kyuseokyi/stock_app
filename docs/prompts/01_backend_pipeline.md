[명령어: 이 작업은 `backend/` 디렉토리 안에서 수행하세요. 사전에 `00_master_prompt.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 한국투자증권 OpenAPI를 이용하여 주식 일봉 데이터를 수집하는 `Celery` 기반 데이터 파이프라인 워커(Worker)를 구축하는 것입니다.

## [실행 단계 - Step by Step]
1. **의존성 설치**: `backend/` 디렉토리로 이동하여 `uv add celery redis pandas pandas-ta clickhouse-connect requests websockets` 명령어로 패키지를 설치하세요.
2. **앱 생성 (MSA 구조)**: `backend/apps/collector/` 디렉토리를 만들고, Redis를 브로커로 사용하는 Celery 애플리케이션(`celery_app.py`)을 초기화하세요.
3. **스케줄러 셋업**: `celery-beat`를 사용하여 매일 오후 4시(장 마감 후)에 동작하는 스케줄을 설정하세요.
4. **공통 모델 참조**: 데이터 적재 시 `backend/shared/models.py`를 활용하거나 ClickHouse 쿼리를 모듈화하세요.
5. **[중요] 수집 로직 (Custom API Client)**: 한국투자증권 OpenAPI 연동 시 외부 패키지(`mojito2`, `pykis`)에 의존하지 마세요. 대신 해당 오픈소스들의 코드와 공식 문서를 벤치마킹하여 `requests` 기반으로 **직접 Custom API Client 클래스**를 작성하세요. (OAuth 토큰 발급, Hashkey 생성, 초당 호출 제한을 피하기 위한 `asyncio.sleep` 또는 retry 로직 필수 포함)
6. **지표 연산 및 적재**: 수집한 OHLCV 데이터를 `pandas-ta`를 통해 MA5, MA20, MA50, MA120 (이동평균선), Bollinger Bands(표준편차), RSI(14) 등의 지표로 연산하세요. 재무 데이터(PER, PBR, ROE)도 수집하여 ClickHouse의 `daily_prices` 및 `fundamentals` 테이블에 Bulk Insert 하세요.
7. **검증**: 로컬 환경(`docker-compose.dev.yml`에 설정된 ClickHouse, Redis)에서 `celery worker`를 띄워 정상적으로 적재되는지 테스트하세요.

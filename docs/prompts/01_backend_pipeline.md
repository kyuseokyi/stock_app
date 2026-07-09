[명령어: 이 작업은 `backend/` 디렉토리 안에서 수행하세요. 사전에 `00_master_prompt.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 한국투자증권 OpenAPI를 이용하여 주식 일봉 데이터를 수집하는 `Celery` 기반 데이터 파이프라인 워커(Worker)를 구축하는 것입니다.

## [실행 단계 - Step by Step]
1. **의존성 설치**: `backend/` 디렉토리로 이동하여 `uv add celery redis pandas pandas-ta clickhouse-connect` 명령어로 패키지를 설치하세요.
2. **Celery 셋업**: `backend/worker/` 디렉토리를 만들고, Redis를 브로커로 사용하는 Celery 애플리케이션(`celery_app.py`)을 초기화하세요.
3. **스케줄러 셋업**: `celery-beat`를 사용하여 매일 오후 4시에 동작하는 스케줄을 설정하세요.
4. **수집 로직 (Task)**: 한국투자증권 API 인증(토큰 발급) 및 종목별 OHLCV 일봉 데이터를 수집하는 Python 스크립트를 작성하세요. (호출 제한 회피용 `asyncio.sleep` 필수)
5. **지표 연산 및 적재**: 수집한 데이터를 `pandas-ta`를 통해 MA20, MA60, Bollinger Bands, RSI(14)를 계산한 후, ClickHouse의 `daily_prices` 테이블에 Bulk Insert 하는 로직을 Task에 포함하세요.
6. **검증**: 로컬 환경(`docker-compose.dev.yml`에 설정된 ClickHouse, Redis)에서 Celery worker를 띄워 정상적으로 적재되는지 테스트하세요.

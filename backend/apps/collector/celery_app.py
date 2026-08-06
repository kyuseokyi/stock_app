"""Celery 애플리케이션 부트스트랩.

Redis 를 브로커/백엔드로 사용하는 Celery 인스턴스를 초기화한다.
실제 데이터 수집/푸시 Task 구현은 후속 단계(docs/prompts/01_backend_pipeline.md)에서
`apps/collector/tasks/` 하위에 추가한다. 여기서는 뼈대(설정 + 스케줄)만 정의한다.

실행 예:
    uv run celery -A apps.collector.celery_app worker --loglevel=info
    uv run celery -A apps.collector.celery_app beat   --loglevel=info
"""

from __future__ import annotations

import os

from celery import Celery
from celery.schedules import crontab

# 로컬 개발 기본값은 docker-compose.dev.yml 의 Redis 를 가리킨다.
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "stock_app",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "apps.collector.tasks.notifications",
        "apps.collector.tasks.ohlcv",
        "apps.collector.tasks.backfill",
        "apps.collector.tasks.universe",
    ],
)

celery_app.conf.update(
    timezone="Asia/Seoul",
    enable_utc=False,
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)

# celery-beat 스케줄.
# 넥스트레이드(NXT) 애프터마켓이 20:00 까지라 통합(UN) 일봉은 그 이후 확정된다.
# → 전종목 일봉 수집을 매일 20:30(Asia/Seoul)에 실행.
celery_app.conf.beat_schedule = {
    "collect-all-daily": {
        "task": "collector.collect_all_daily",
        "schedule": crontab(hour=20, minute=30),
        # 마스터 소스는 STOCK_MASTER_SOURCE(기본 auto: .mst→실패시 fallback)
    },
}

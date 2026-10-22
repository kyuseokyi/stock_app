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
        "apps.collector.tasks.settle_season",
        "apps.collector.tasks.quiz",
        "apps.collector.tasks.weekly_close",
        "apps.collector.tasks.market_data",
        "apps.collector.tasks.canslim",
        "apps.collector.tasks.market_groups",
        "apps.collector.tasks.screener",
        "apps.collector.tasks.patterns",
        "apps.collector.tasks.push_sends",
        "apps.collector.tasks.bootstrap",
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
        # 전종목 일봉 → 국내 지수 → 투자자별 순매수(한 작업에서 차례로 — KIS 호출이 겹치지 않게).
        # 마스터 소스는 STOCK_MASTER_SOURCE(기본 auto: .mst→실패시 fallback), 동기화 때 종목 프로필·업종·테마도 갱신
        "task": "collector.daily_market_pipeline",
        "schedule": crontab(hour=20, minute=30),
    },
    # 국내 지수 — KRX 정규장 마감(15:30) 10분 뒤. 지수는 NXT 와 무관하게 15:30 종가로 확정.
    # 20:30 일일 파이프라인의 국내 지수 단계는 안전망으로 그대로 둔다(같은 날짜 덮어쓰기).
    "collect-kr-indices": {
        "task": "collector.collect_market_indices",
        "schedule": crontab(hour=15, minute=40, day_of_week="mon-fri"),
        "kwargs": {"region": "KR"},
    },
    # 장중 국내 지수·원/달러 30초 갱신(Redis market:intraday) — 거래일 09:00~15:35 KST 만 KIS 호출,
    # 그 밖에는 태스크가 바로 끝난다. 워커가 바빠 밀린 실행은 25초 뒤 버린다(몰아서 실행 방지).
    # 끄기: INTRADAY_INDICES_ENABLED=false. 설계 docs/superpowers/specs/2026-10-20-intraday-index-design.md
    "poll-intraday-indices": {
        "task": "collector.poll_intraday_indices",
        "schedule": 30.0,
        "options": {"expires": 25},
    },
    # 미국 지수·환율·대표 종목 — 미국 장 마감(서머타임 05:00 / 그 외 06:00 KST) 뒤. 미국 월~금 → 한국 화~토 아침
    "collect-us-indices": {
        "task": "collector.collect_market_indices",
        "schedule": crontab(hour=6, minute=30, day_of_week="tue-sat"),
        "kwargs": {"region": "US"},
    },
    # 안전망 — 06:30 이 실패했거나 종가가 늦게 확정된 날을 메꾼다(멱등)
    "collect-us-indices-retry": {
        "task": "collector.collect_market_indices",
        "schedule": crontab(hour=7, minute=30, day_of_week="tue-sat"),
        "kwargs": {"region": "US"},
    },
    # 미국 거시 지표(FRED) — FRED_API_KEY 없으면 건너뜀
    "collect-macro-series": {
        "task": "collector.collect_macro_series",
        "schedule": crontab(hour=8, minute=0),
    },
    "collect-ipo-events": {
        "task": "collector.collect_ipo_events",
        "schedule": crontab(hour=21, minute=30),
    },
    # 재무비율 — 실적은 분기마다 바뀌므로 주 1회(토)
    "collect-fundamentals": {
        "task": "collector.collect_fundamentals",
        "schedule": crontab(hour=10, minute=0, day_of_week=6),
    },
    # 재무가 바뀐 뒤 CANSLIM C·A 반영(같은 기준일 재계산 — 멱등). 재무 수집(약 6분) 뒤
    "compute-canslim-after-fundamentals": {
        "task": "collector.compute_canslim",
        "schedule": crontab(hour=10, minute=40, day_of_week=6),
    },
    "settle-trading-season": {
        "task": "settle_trading_season",
        "schedule": crontab(hour=20, minute=40),
    },
    # 차트 퀴즈 풀 보충 — 일봉 수집·정산 이후. 미시도 재고 < QUIZ_POOL_MIN_UNSEEN 일 때만 생성
    "generate-chart-quiz": {
        "task": "collector.generate_chart_quiz",
        "schedule": crontab(hour=21, minute=0),
    },
    # 주간 랭킹 마감 — 월요일 장 시작(09:00) 전. 지난주 Top 10 기록·1~3위 보상
    "close-trading-week": {
        "task": "close_trading_week",
        "schedule": crontab(hour=8, minute=50, day_of_week=1),
    },
    # 월간 랭킹 마감(분기 시즌만) — 매월 1일 장 시작 전, 주간 마감(08:50)과 겹치지 않게 08:55
    "close-trading-month": {
        "task": "close_trading_month",
        "schedule": crontab(hour=8, minute=55, day_of_month=1),
    },
    # 펀드 리포트 알림 예약 발송 — 1분마다 예약 시각이 지난 것을 집는다(워커 중단 중 지난 예약은 재기동 후 지연 발송)
    "dispatch-scheduled-pushes": {
        "task": "collector.dispatch_scheduled_pushes",
        "schedule": 60.0,
        "options": {"expires": 55},
    },
}

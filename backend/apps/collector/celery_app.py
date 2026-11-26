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

from shared.clickhouse_schema import market_data_readonly

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
        "apps.collector.tasks.edu_game",
        "apps.collector.tasks.market_data",
        "apps.collector.tasks.canslim",
        "apps.collector.tasks.market_groups",
        "apps.collector.tasks.screener",
        "apps.collector.tasks.patterns",
        "apps.collector.tasks.featured",
        "apps.collector.tasks.push_sends",
        "apps.collector.tasks.bootstrap",
        "apps.collector.tasks.daily_surge",
        "apps.ai_analyst.tasks",
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
    # 키움 VI 발동 종목(오늘 특징주 카드) — 거래일 09:00~15:30 5분마다(하루 79회 + 연속조회). 키움 키가 없거나
    # 장 밖(15:35~15:55 포함)·휴장일이면 태스크가 호출 없이 끝난다. 그날 연속 3회 실패면 남은 호출 중단. 밀린 실행은 버린다
    "poll-vi-stocks": {
        "task": "collector.poll_vi_stocks",
        "schedule": crontab(minute="*/5", hour="9-15", day_of_week="mon-fri"),
        "options": {"expires": 240},
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
    # 원/달러 매매기준율(한국은행 ECOS 731Y001, 일별) — ECOS_API_KEY 없으면 건너뜀.
    # 매매기준율은 당일 오전(서울외국환중개 고시) 값이 그날 날짜로 ECOS 에 오르는데, 반영 시각이 일정하지 않다.
    # 평일 10:30 에 돌리면 적어도 전 영업일 값은 확실히 있고(홈은 '전일 기준'으로 보여 준다), 당일 값이 늦으면
    # 17:30 안전망이 채운다. 매번 30일 겹쳐 받아(ReplacingMergeTree) 하루 실패해도 다음 실행이 메꾼다.
    "collect-ecos-usdkrw": {
        "task": "collector.collect_ecos_usdkrw",
        "schedule": crontab(hour=10, minute=30, day_of_week="mon-fri"),
    },
    "collect-ecos-usdkrw-retry": {
        "task": "collector.collect_ecos_usdkrw",
        "schedule": crontab(hour=17, minute=30, day_of_week="mon-fri"),
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
    # 급등락·테마 분석 — 상용 20:30 일봉 파이프라인이 끝난 뒤. 상용 일봉 읽기 → PG 저장(개발 prod_readonly 에서도 유지)
    # 일봉이 덜 쌓였으면(1,000종목 미만) 건너뛴다. 설계 docs/superpowers/specs/2026-11-26-daily-surge-theme-analyzer-design.md
    "analyze-daily-surge": {
        "task": "collector.analyze_daily_surge",
        "schedule": crontab(hour=22, minute=10, day_of_week="mon-fri"),
    },
    "settle-trading-season": {
        "task": "settle_trading_season",
        "schedule": crontab(hour=20, minute=40),
    },
    # 교육용 합성 종가 게임 — 평일 20:00 새 가상 일봉 1개 + 전 계좌 손절·익절·종가 정산(PG 만 사용).
    # 오늘 이미 진행했으면(관리자 advance-day 포함) 건너뛴다. prod_readonly 에서도 그대로 돈다(READONLY_DISABLED_BEATS 아님)
    "edu-game-advance-day": {
        "task": "edu_game_advance_day",
        "schedule": crontab(hour=20, minute=0, day_of_week="mon-fri"),
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
    # ---- AI 시황 분석(apps/ai_analyst/tasks.py) — 키(GEMINI 등)가 없으면 태스크가 skipped 로 바로 끝난다
    # 모닝 브리핑 — 미국 지수(06:30·07:30)·FRED(08:00) 수집 뒤, 개장 전
    "ai-morning-briefing": {
        "task": "ai.generate_morning_briefing",
        "schedule": crontab(hour=8, minute=30, day_of_week="mon-fri"),
    },
    # 주간 마감 브리핑 — 금요일 미국 마감 지수(토 06:30·07:30 수집) 뒤. 주말 동안 시황 탭에 이 브리핑이 보인다
    "ai-weekly-briefing": {
        "task": "ai.generate_weekly_briefing",
        "schedule": crontab(hour=8, minute=30, day_of_week="sat"),
    },
    # 급등락 순위 — 2분 간격, KIS 만(분당 1~2건). 09:10~15:30 밖·휴장일은 태스크가 KIS 호출 없이 거른다. 밀린 실행은 버린다
    "ai-market-movers-list": {
        "task": "ai.refresh_market_movers_list",
        "schedule": crontab(minute="*/2", hour="9-15", day_of_week="mon-fri"),
        "options": {"expires": 100},
    },
    # 급등락 원인 — 10분 간격. 09:10~15:30 밖(09:00·15:40·15:50)·휴장일은 태스크가 거른다. 밀린 실행은 버린다
    "ai-market-movers": {
        "task": "ai.analyze_market_movers",
        "schedule": crontab(minute="*/10", hour="9-15", day_of_week="mon-fri"),
        "options": {"expires": 540},
    },
    # 투자자 수급 — 장 마감 직후 잠정치, 18:10 확정치(pykrx) 갱신
    "ai-investor-flow-close": {
        "task": "ai.collect_investor_flow",
        "schedule": crontab(hour=15, minute=45, day_of_week="mon-fri"),
    },
    "ai-investor-flow-final": {
        "task": "ai.collect_investor_flow",
        "schedule": crontab(hour=18, minute=10, day_of_week="mon-fri"),
    },
    # KRX 로그인(pykrx)이 없으면 KIS investor_daily 폴백인데, 그 적재가 20:30 일일 파이프라인이라 15:45·18:10 은
    # 전 거래일 숫자다 → 파이프라인 뒤에 한 번 더 모아 당일 숫자로 맞춘다(기준일이 바뀌면 해설도 새로 만든다).
    "ai-investor-flow-after-pipeline": {
        "task": "ai.collect_investor_flow",
        "schedule": crontab(hour=22, minute=0, day_of_week="mon-fri"),
    },
    # 스크리너 통과 종목 정성 평가(DART·뉴스·Gemini) — 이미 평가한 종목은 건너뛴다
    "ai-screener-evaluation": {
        "task": "ai.evaluate_screener_stocks",
        "schedule": crontab(hour=16, minute=0, day_of_week="mon-fri"),
    },
}


# ---- 개발 서버가 상용 ClickHouse 를 읽기 전용으로 쓸 때(MARKET_DATA_SOURCE=prod_readonly)
# 상용 CH 에 쓰는(또는 의미 없이 KIS 를 부르는) beat 를 빼고, 개발 경량 파이프라인 하나를 넣는다.
# 설정이 없으면(상용·로컬·지금의 개발) beat_schedule 은 위 그대로다.
# 설계 docs/superpowers/specs/2026-11-18-dev-reads-prod-clickhouse-design.md 4절
READONLY_DISABLED_BEATS = frozenset({
    "collect-all-daily",                   # 일일 파이프라인(일봉·지수·수급·CANSLIM·스크리너·패턴…) → 경량 파이프라인으로 대체
    "collect-kr-indices",                  # market_index_daily
    "collect-us-indices",                  # market_index_daily
    "collect-us-indices-retry",
    "collect-fundamentals",                # fundamentals_periodic
    "compute-canslim-after-fundamentals",  # canslim_*
})
DEV_PIPELINE_BEAT = "dev-readonly-pipeline"


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


def readonly_beat_schedule(schedule: dict) -> dict:
    """prod_readonly 용 beat — READONLY_DISABLED_BEATS 를 빼고 경량 파이프라인(기본 23:30, DEV_PIPELINE_HOUR/MINUTE)을 더한다."""
    out = {name: entry for name, entry in schedule.items() if name not in READONLY_DISABLED_BEATS}
    out[DEV_PIPELINE_BEAT] = {
        # 마스터 동기화 → 시장 그룹(로컬 CH) → 신고저가(Redis). 상용 20:30 파이프라인이 끝난 뒤여야 당일 기준
        "task": "collector.dev_readonly_pipeline",
        "schedule": crontab(hour=_env_int("DEV_PIPELINE_HOUR", 23), minute=_env_int("DEV_PIPELINE_MINUTE", 30)),
    }
    return out


if market_data_readonly():
    celery_app.conf.beat_schedule = readonly_beat_schedule(celery_app.conf.beat_schedule)

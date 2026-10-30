"""AI 시황 분석 Celery 태스크 — 모닝 브리핑·급등락 원인·수급 해설·스크리너 정성 평가.

원칙(Graceful Fail): 외부 키가 없거나 휴장일이면 `{"skipped": 사유}`, 예외는 잡아서 `{"error": ...}` 로 끝낸다
(워커를 흔들지 않고, 비밀값은 로그에 남기지 않는다 — repr 은 300자로 자른다).
스케줄은 `apps/collector/celery_app.py` beat_schedule 의 `ai-*` 항목.
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime

from apps.ai_analyst.services import investor_flow_ai, market_movers, morning_brief, stock_qualitative
from apps.collector.celery_app import celery_app
from apps.collector.intraday_indices import KST
from shared import market_calendar
from shared.database import SyncSessionLocal
from shared.sync_redis import get_sync_redis

log = logging.getLogger(__name__)

# 급등락 중복 실행 잠금 — beat 간격(10분)보다 짧게 둬서, 하드 시간 제한으로 프로세스가 죽어 finally 가
# 돌지 못해도 다음 회차 전에 풀린다.
MOVERS_LOCK_KEY = "ai:market:movers:lock"
MOVERS_LOCK_TTL = 540


# ---------------------------------------------------------------- 외부 의존(테스트에서 바꿔 끼운다)
def _now() -> datetime:
    """KST 기준 현재 시각 — 워커 컨테이너가 UTC 여도 08:30 브리핑 날짜가 하루 밀리지 않게."""
    return datetime.now(KST)


def _today() -> date:
    return _now().date()


def _kis_client():
    """급등락 순위 조회용 KIS 클라이언트 — 기존 단독 태스크와 같은 초당 상한."""
    from apps.collector.kis.client import KISClient
    from apps.collector.rate_limit import RateLimiter
    from apps.collector.tasks.universe import _DEFAULT_RATE

    return KISClient(limiter=RateLimiter(_DEFAULT_RATE))


def _release_lock(redis, token: str) -> None:
    """내 토큰일 때만 해제(collector.poll_intraday_indices 와 같은 방식). 실패하면 TTL 로 풀린다."""
    try:
        if redis.get(MOVERS_LOCK_KEY) == token:
            redis.delete(MOVERS_LOCK_KEY)
    except Exception as e:  # noqa: BLE001
        log.warning("급등락 잠금 해제 실패: %s", type(e).__name__)


# ---------------------------------------------------------------- 모닝 브리핑(평일 08:30)
@celery_app.task(name="ai.generate_morning_briefing", soft_time_limit=300, time_limit=360)
def generate_morning_briefing() -> dict:
    try:
        today = _today()
        if not market_calendar.is_trading_day(today):
            return {"skipped": "holiday"}
        with SyncSessionLocal() as db:
            got = morning_brief.generate(today, session=db)
        if got is None:
            return {"skipped": "no_briefing"}  # 키 없음·지수 없음·Gemini 실패 — 서비스가 사유를 로그로 남긴다
        return {"date": got.get("date"), "headline": got.get("headline")}
    except Exception as e:  # noqa: BLE001
        log.exception("모닝 브리핑 태스크 실패")
        return {"error": repr(e)[:300]}


# ---------------------------------------------------------------- 급등락 원인(평일 9~15시 10분 간격)
# ignore_result — 하루 40회 돌고 아무도 결과를 읽지 않는다.
@celery_app.task(name="ai.analyze_market_movers", ignore_result=True, soft_time_limit=240, time_limit=300)
def analyze_market_movers() -> dict:
    """09:10~15:30(거래일)에만 KIS·Gemini 를 부른다. beat 는 09:00·15:40·15:50 에도 깨우므로 여기서 거른다."""
    redis = None
    client = None
    token = uuid.uuid4().hex
    locked = False
    try:
        now = _now()
        if not market_movers.in_session_window(now):
            return {"skipped": "outside_session"}
        redis = get_sync_redis()
        if not redis.set(MOVERS_LOCK_KEY, token, nx=True, ex=MOVERS_LOCK_TTL):
            return {"skipped": "locked"}
        locked = True
        client = _kis_client()
        # force=True — 캐시 TTL(600s)과 beat 간격(10분)이 같아 force 없으면 캐시 적중으로 20분마다만 갱신된다
        result = market_movers.analyze(now, kis_client=client, force=True)
        if "skipped" in result:
            return result
        keywords = market_movers.hot_keywords(result)  # 자체 캐시(30분)로 주기를 조절
        return {"updated_at": result.get("updated_at"), "gainers": len(result.get("gainers") or []),
                "losers": len(result.get("losers") or []), "keywords": len(keywords)}
    except Exception as e:  # noqa: BLE001 — 시간 제한 예외 포함
        log.exception("급등락 분석 태스크 실패")
        return {"error": repr(e)[:300]}
    finally:
        if client is not None:
            client.close()
        if locked:
            _release_lock(redis, token)


# ---------------------------------------------------------------- 투자자 수급(평일 15:45, 18:10)
@celery_app.task(name="ai.collect_investor_flow", soft_time_limit=600, time_limit=660)
def collect_investor_flow() -> dict:
    """15:45 잠정치, 18:10 pykrx 확정치 갱신. 같은 기준일·출처면 서비스가 AI 해설을 재사용한다."""
    try:
        today = _today()
        if not market_calendar.is_trading_day(today):
            return {"skipped": "holiday"}
        with SyncSessionLocal() as db:
            got = investor_flow_ai.build(today, session=db, force=False)
        if got is None:
            return {"skipped": "no_data"}
        return {"date": got.get("date"), "source": got.get("source"), "ai_comment": got.get("ai_comment") is not None}
    except Exception as e:  # noqa: BLE001
        log.exception("투자자 수급 태스크 실패")
        return {"error": repr(e)[:300]}


# ---------------------------------------------------------------- 스크리너 정성 평가(평일 16:00)
@celery_app.task(name="ai.evaluate_screener_stocks", soft_time_limit=1800, time_limit=1900)
def evaluate_screener_stocks() -> dict:
    try:
        today = _today()
        if not market_calendar.is_trading_day(today):
            return {"skipped": "holiday"}
        with SyncSessionLocal() as db:
            return stock_qualitative.evaluate_batch(today, session=db)
    except Exception as e:  # noqa: BLE001
        log.exception("스크리너 정성 평가 태스크 실패")
        return {"error": repr(e)[:300]}

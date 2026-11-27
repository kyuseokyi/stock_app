"""AI Lab B단계 서비스 — 분석(정량 미리 보기 → 저장분 재사용 또는 구조화 추론 1회 → 검증 → upsert)·조회·일괄 분석.

비용 보호
- 같은 (종목, 기준일) 리포트가 있으면 추론을 부르지 않고 저장분을 돌려준다(force=True 일 때만 다시 분석).
- 같은 종목 동시 분석은 Redis 잠금(ai:skills:analyze:<ticker>)으로 막는다 — 내 토큰일 때만 해제, 죽어도 TTL 로 풀림.
  Redis 장애면 잠금 없이 진행한다(저장분 재사용 규칙은 그대로라 비용 폭주는 없다).
동기 함수(CH·PG 동기 클라이언트·외부 API) — 라우터는 run_in_threadpool 로, 일괄 분석은 Celery 태스크가 부른다.
설계: docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md 3절
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from apps.ai_analyst.clients import gemini_client
from apps.ai_analyst.skills import report_repository as repo
from apps.ai_analyst.skills import service as quant_service
from apps.ai_analyst.skills import skill_runner
from shared.database import SyncSessionLocal
from shared.sync_redis import get_sync_redis

log = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")
LOCK_PREFIX = "ai:skills:analyze:"
LOCK_TTL = 300  # 추론 1회(수십 초) + 정량 계산보다 넉넉히
BATCH_LOCK_KEY = "ai:skills:batch:lock"
BATCH_LOCK_TTL = 1300  # 태스크 하드 시간 제한(1260초)보다 조금 길게
BATCH_MAX = 5
SOURCES = ("surge", "leaders")

_MESSAGES = {
    "NOT_FOUND": "종목 일봉이 없습니다.",
    "ANALYZING": "이 종목을 분석하는 중입니다. 잠시 뒤 다시 시도하세요.",
    "GEMINI_UNAVAILABLE": "AI 키가 설정되지 않아 분석할 수 없습니다.",
    "AI_RESPONSE_INVALID": "AI 응답이 없거나 검증을 통과하지 못해 저장하지 않았습니다.",
}


class AnalyzeError(Exception):
    def __init__(self, code: str, reason: str | None = None):
        super().__init__(code)
        self.code = code
        self.reason = reason
        self.message = _MESSAGES.get(code, code)


# ---------------------------------------------------------------- 외부 의존(테스트에서 바꿔 끼운다)
def _gemini():
    return gemini_client.get_gemini_client()


def _redis():
    return get_sync_redis()


def _today() -> date:
    return datetime.now(KST).date()


def lock_key(ticker: str) -> str:
    return f"{LOCK_PREFIX}{ticker}"


def _acquire(r, key: str, ttl: int) -> tuple[bool, str | None]:
    """(잡음 여부, 토큰). Redis 장애면 (True, None) — 잠금 없이 진행."""
    token = uuid.uuid4().hex
    try:
        return bool(r.set(key, token, nx=True, ex=ttl)), token
    except Exception as e:  # noqa: BLE001
        log.warning("AI Lab 잠금 실패 — 잠금 없이 진행 (%s)", type(e).__name__)
        return True, None


def _release(r, key: str, token: str | None) -> None:
    if token is None:
        return
    try:
        if r.get(key) == token:
            r.delete(key)
    except Exception as e:  # noqa: BLE001 — 실패하면 TTL 로 풀린다
        log.warning("AI Lab 잠금 해제 실패 (%s)", type(e).__name__)


# ---------------------------------------------------------------- 분석
def analyze(ticker: str, *, force: bool = False, skills: list[str] | None = None) -> dict:
    """저장된 리포트 dict(+ cached). 실패는 AnalyzeError(code, reason)."""
    ticker = ticker.strip()
    r = _redis()
    got, token = _acquire(r, lock_key(ticker), LOCK_TTL)
    if not got:
        raise AnalyzeError("ANALYZING")
    try:
        preview = quant_service.quant_preview(ticker)
        if preview is None:
            raise AnalyzeError("NOT_FOUND")
        as_of = date.fromisoformat(str(preview["as_of"]))
        if not force:
            with SyncSessionLocal() as session:
                saved = repo.get(session, ticker, as_of)
            if saved is not None:
                return {**saved, "cached": True}
        client = _gemini()
        if client is None:
            raise AnalyzeError("GEMINI_UNAVAILABLE")
        result = skill_runner.run(preview, skills, client)
        if not result.ok:
            raise AnalyzeError("AI_RESPONSE_INVALID", result.reason)
        with SyncSessionLocal() as session:
            saved = repo.upsert(session, result.values)
        return {**saved, "cached": False}
    finally:
        _release(r, lock_key(ticker), token)


# ---------------------------------------------------------------- 조회
def list_reports(page: int = 1, page_size: int = 20, ticker: str | None = None) -> dict:
    with SyncSessionLocal() as session:
        return repo.list_page(session, page=page, page_size=page_size, ticker=(ticker or "").strip() or None)


def get_report(ticker: str, as_of: date | None = None) -> dict | None:
    with SyncSessionLocal() as session:
        return repo.get(session, ticker.strip(), as_of) if as_of else repo.latest(session, ticker.strip())


# ---------------------------------------------------------------- 일괄 분석(Celery 태스크가 부른다)
def _leaders(limit: int) -> list[str]:
    """기존 주도주 화면 기본값(시장 전체·유동성 통과·점수순)의 상위 — stock_qualitative 후보와 같은 호출."""
    from apps.stock_api.services import canslim_query

    res = canslim_query.screen(market="ALL", min_pass=0, sort="score", liquid_only=True, limit=limit, offset=0)
    return [it["ticker"] for it in (res or {}).get("items") or []][:limit]


def batch_targets(source: str, limit: int) -> list[str]:
    limit = max(1, min(int(limit), BATCH_MAX))
    if source == "leaders":
        return _leaders(limit)
    with SyncSessionLocal() as session:
        return repo.surge_top(session, limit)


def _kst_date(v) -> date | None:
    if not v:
        return None
    t = datetime.fromisoformat(str(v))
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)  # sqlite 등 시간대 없는 값은 UTC(now()) 로 본다
    return t.astimezone(KST).date()


def _has_today_report(ticker: str, today: date) -> bool:
    with SyncSessionLocal() as session:
        last = repo.latest(session, ticker)
    if last is None:
        return False
    return last["as_of_date"] == today.isoformat() or _kst_date(last.get("updated_at")) == today


def batch_top(source: str, limit: int = BATCH_MAX) -> dict:
    """대상 종목을 차례로 분석(force=False). 오늘 리포트가 있으면 건너뛴다. 키가 없으면 바로 끝낸다."""
    if source not in SOURCES:
        return {"error": f"unknown source {source}"}
    r = _redis()
    got, token = _acquire(r, BATCH_LOCK_KEY, BATCH_LOCK_TTL)
    if not got:
        return {"skipped": "locked"}
    try:
        tickers = batch_targets(source, limit)
        today = _today()
        out: dict = {"source": source, "targets": tickers, "analyzed": [], "skipped": [], "failed": []}
        for t in tickers:
            if _has_today_report(t, today):
                out["skipped"].append({"ticker": t, "reason": "TODAY_EXISTS"})
                continue
            try:
                rep = analyze(t, force=False)
            except AnalyzeError as e:
                if e.code == "GEMINI_UNAVAILABLE":
                    out["stopped"] = e.code
                    break
                bucket = "skipped" if e.code == "ANALYZING" else "failed"
                out[bucket].append({"ticker": t, "reason": e.reason or e.code})
                continue
            except Exception as e:  # noqa: BLE001 — 한 종목 실패가 나머지를 막지 않게
                log.exception("AI Lab 일괄 분석 실패 %s", t)
                out["failed"].append({"ticker": t, "reason": type(e).__name__})
                continue
            (out["skipped"] if rep.get("cached") else out["analyzed"]).append(
                {"ticker": t, "reason": "SAME_AS_OF"} if rep.get("cached") else t)
        return out
    finally:
        _release(r, BATCH_LOCK_KEY, token)


def batch_running() -> bool:
    try:
        return bool(_redis().exists(BATCH_LOCK_KEY))
    except Exception as e:  # noqa: BLE001
        log.warning("AI Lab 일괄 잠금 조회 실패 (%s)", type(e).__name__)
        return False

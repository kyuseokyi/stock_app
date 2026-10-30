"""투자자별 수급 전광판 + AI 2줄 해설 — `apps.collector.investor_flow.collect` → 업종명 → Gemini → Redis.

collect 가 None(pykrx·KIS 폴백 모두 실패)이거나 예외면 이전 캐시를 덮지 않고 None.
Gemini 가 없으면 ai_comment=None 으로라도 캐시한다(수급 숫자 자체는 유효).
"""
from __future__ import annotations

import logging
from datetime import date, datetime

from apps.ai_analyst import cache, prompts
from apps.ai_analyst.clients.gemini_client import get_gemini_client
from apps.ai_analyst.schemas import InvestorFlowComment, InvestorFlowResponse
from apps.collector.intraday_indices import KST

log = logging.getLogger(__name__)


# ---------------------------------------------------------------- 외부 의존(테스트에서 바꿔 끼운다)
def _collect(day: date, *, ch=None, session=None) -> dict | None:
    from apps.collector import investor_flow

    return investor_flow.collect(day, ch=ch, session=session)


def _sector_map(session=None) -> dict[str, str]:
    """{ticker: 업종(중분류) 이름} — market_repo.profile_map(중분류 코드) + sector_name_map(코드→이름) 재사용."""
    from shared import market_repo

    own = session is None
    if own:
        from shared.database import SyncSessionLocal
        session = SyncSessionLocal()
    try:
        names = market_repo.sector_name_map(session)
        return {t: names[code] for t, (code, _m) in market_repo.profile_map(session).items() if code in names}
    finally:
        if own:
            session.close()


def _gemini():
    return get_gemini_client()


def _now() -> datetime:
    return datetime.now(KST)


# ---------------------------------------------------------------- 진입점
def _comment(raw: dict, session, *, force: bool) -> str | None:
    # 같은 기준일·출처의 해설이 이미 캐시에 있으면 재사용(Gemini 재호출 안 함)
    if not force:
        prev = cache.get_json(cache.INVESTOR_FLOW_KEY) or {}
        if prev.get("ai_comment") and prev.get("date") == raw.get("date") and prev.get("source") == raw.get("source"):
            return prev["ai_comment"]
    gemini = _gemini()
    if gemini is None:
        return None
    try:
        sectors = _sector_map(session)
    except Exception as exc:  # noqa: BLE001 — 업종명은 보조 정보, 없어도 해설은 진행
        log.warning("업종 맵 조회 실패(%s) — 업종명 없이 해설", type(exc).__name__)
        if session is not None:
            session.rollback()
        sectors = {}
    prompt = prompts.investor_flow_prompt(raw.get("foreign_top"), raw.get("institution_top"),
                                          raw.get("pension_top"), raw.get("double_buy"), sectors)
    resp = gemini.generate_json(prompt, InvestorFlowComment, system=prompts.SYSTEM_PROMPT)
    return resp.comment if resp is not None else None


def build(day: date, *, ch=None, session=None, force: bool = False) -> dict | None:
    """수급 집계 + AI 해설 → 캐시(INVESTOR_FLOW_KEY) 후 계약 모양 dict. 수집 실패면 캐시를 건드리지 않고 None."""
    try:
        raw = _collect(day, ch=ch, session=session)
    except Exception as exc:  # noqa: BLE001 — KIS 폴백의 PG 유니버스 예외 등이 그대로 올라온다
        log.warning("투자자 수급 수집 실패(%s) — 이전 캐시 유지", type(exc).__name__)
        if session is not None:
            session.rollback()
        return None
    if raw is None:
        return None
    body = InvestorFlowResponse(
        date=raw.get("date"), source=raw.get("source"),
        foreign_top=raw.get("foreign_top") or [], institution_top=raw.get("institution_top") or [],
        pension_top=raw.get("pension_top") or [], double_buy=raw.get("double_buy") or [],
        ai_comment=_comment(raw, session, force=force),
        updated_at=_now().isoformat(timespec="seconds"),
    ).model_dump()
    cache.put_json(cache.INVESTOR_FLOW_KEY, body, cache.INVESTOR_FLOW_TTL)
    return body


def get_cached() -> dict:
    """API 용 — 캐시가 없으면 계약의 빈 모양."""
    hit = cache.get_json(cache.INVESTOR_FLOW_KEY)
    if not hit:
        return InvestorFlowResponse().model_dump()
    try:
        return InvestorFlowResponse.model_validate(hit).model_dump()
    except Exception:  # noqa: BLE001 — 형식이 깨진 캐시는 빈 모양으로(API 500 방지)
        log.warning("수급 캐시 형식 오류 — 빈 값 반환")
        return InvestorFlowResponse().model_dump()

"""AI 모닝 글로벌 브리핑 — 전일 미국 마감 지수·환율·FRED 거시 지표(+선택: 미국 증시 뉴스) → Gemini → PG.

지수·거시 값은 시장 탭 서비스(`apps.stock_api.services.market_query`)의 `overview()` 를 그대로 재사용한다(로직 복제 금지).
브리핑은 AI 산출물이라 Gemini 가 없거나 실패하면 None(원시 데이터만 저장하지 않는다).
"""
from __future__ import annotations

import logging
from datetime import date

from sqlalchemy.orm import Session

from apps.ai_analyst import prompts, repository
from apps.ai_analyst.clients.gemini_client import get_gemini_client
from apps.ai_analyst.clients.naver_news import get_naver_news_client
from apps.ai_analyst.schemas import MorningBriefingResponse

log = logging.getLogger(__name__)

# 브리핑에 넣을 지수 코드(순서 = 프롬프트 순서). 코드는 apps/collector/market_indices._BASE 기준.
BRIEF_INDEX_CODES = ("US:SPX", "US:COMP", "US:NDX", "US:DJI", "US:SOX", "US:VIX", "FX:USDKRW", "KR:0001", "KR:1001")
US_NEWS_QUERY = "뉴욕증시"
US_NEWS_COUNT = 5
HEADLINE_MAX = 255  # ai_daily_briefings.headline String(255)


# ---------------------------------------------------------------- 외부 의존(테스트에서 바꿔 끼운다)
def _overview() -> dict:
    """시장 탭 개요(지수·거시) — 지연 import 로 stock_api 의존을 이 함수 안에만 둔다."""
    from apps.stock_api.services import market_query

    return market_query.overview()


def _gemini():
    return get_gemini_client()


def _news():
    return get_naver_news_client()


# ---------------------------------------------------------------- 입력 변환(순수 함수)
def brief_indices(indices: list[dict]) -> list[dict]:
    """market_query._indices() 행 → 프롬프트 입력 [{name, close, change_rate}]. 기준일을 이름에 붙인다."""
    by_code = {i.get("code"): i for i in indices or []}
    out = []
    for code in BRIEF_INDEX_CODES:
        i = by_code.get(code)
        if not i or i.get("close") is None:
            continue
        out.append({"name": f"{i.get('name')} [{i.get('date')}]", "close": i["close"], "change_rate": i.get("chg1d")})
    return out


def brief_macro(macro: list[dict]) -> list[dict]:
    """market_query._macro() 행 → [{name, value}]. prev 는 직전 '값'이지 등락률이 아니므로 change_rate 는 넣지 않고
    단위·기준일·직전 값을 이름에 붙여 모델이 비교하게 한다."""
    out = []
    for m in macro or []:
        if m.get("value") is None:
            continue
        label = f"{m.get('name')}({m.get('unit')}, {m.get('date')} 기준"
        if m.get("prev") is not None:
            label += f", 직전 {float(m['prev']):,.2f}"
        out.append({"name": label + ")", "value": m["value"]})
    return out


def _us_news():
    """키가 없으면 None — 프롬프트에서 뉴스 섹션 자체를 뺀다([] 를 넘기면 '(관련 뉴스 없음)' 이 생긴다)."""
    client = _news()
    if client is None:
        return None
    try:
        return client.search(US_NEWS_QUERY, display=US_NEWS_COUNT, sort="date") or None
    except Exception as exc:  # noqa: BLE001 — 뉴스는 선택 입력
        log.warning("미국 증시 뉴스 조회 실패(%s) — 뉴스 없이 진행", type(exc).__name__)
        return None


# ---------------------------------------------------------------- 진입점
def generate(day: date, *, session: Session, force: bool = False) -> dict | None:
    """day 의 브리핑을 만들어 PG 에 저장하고 API 모양 dict 로 반환. 이미 있으면(force 아님) Gemini 없이 그대로."""
    if not force:
        got = get_latest(day, session=session)
        # get_briefing 은 그날 것이 없으면 이전 최근 1건을 주므로 날짜가 같을 때만 적중
        if got and got.get("date") == day.isoformat():
            return got

    gemini = _gemini()
    if gemini is None:
        log.warning("Gemini 키 없음 — 모닝 브리핑 생략")
        return None

    try:
        ov = _overview() or {}
    except Exception as exc:  # noqa: BLE001 — CH 장애
        log.warning("시장 개요 조회 실패(%s) — 모닝 브리핑 생략", type(exc).__name__)
        return None
    indices = brief_indices(ov.get("indices") or [])
    if not indices:
        # 근거 데이터 없이 생성하면 지어내게 된다(프롬프트 원칙 1)
        log.warning("지수 데이터 없음 — 모닝 브리핑 생략")
        return None
    macro = brief_macro(ov.get("macro") or [])

    prompt = prompts.morning_brief_prompt(indices, macro, _us_news())
    resp = gemini.generate_json(prompt, MorningBriefingResponse, system=prompts.SYSTEM_PROMPT)
    if resp is None:
        return None
    resp = resp.model_copy(update={"headline": resp.headline[:HEADLINE_MAX]})
    try:
        repository.upsert_briefing(session, day, resp)
    except Exception as exc:  # noqa: BLE001 — PG 저장 실패는 결과 없음으로
        log.warning("모닝 브리핑 저장 실패(%s)", type(exc).__name__)
        session.rollback()
        return None
    return repository.get_briefing(session, day)


def get_latest(day: date, *, session: Session) -> dict | None:
    """API 용 — day 의 브리핑, 없으면 그 이전 최근 1건. PG 장애면 None(API 는 200 + 빈 값)."""
    try:
        return repository.get_briefing(session, day)
    except Exception as exc:  # noqa: BLE001
        log.warning("모닝 브리핑 조회 실패(%s)", type(exc).__name__)
        session.rollback()
        return None

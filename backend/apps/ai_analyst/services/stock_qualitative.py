"""스크리너(CANSLIM) 통과 종목 정성 분석 — DART 공시 90일 + 지뢰 힌트 + 뉴스 → Gemini → PG(ai_stock_evaluations).

후보는 기존 CANSLIM 조회 서비스(`apps.stock_api.services.canslim_query.screen`)를 읽기만 해서 얻는다(수정 금지).
모바일 주도주 화면 기본값(시장 전체·유동성 통과·점수순)과 같은 정렬의 상위 N 개 — 화면 위쪽 카드부터 뱃지가 붙는다.
⚠️ canslim_daily 는 일봉 파이프라인(20:30) 뒤에 계산되므로, 16:00 평가 시점의 최신 결과는 보통 전 거래일 기준이다.
"""
from __future__ import annotations

import logging
from datetime import date

from sqlalchemy.orm import Session

from apps.ai_analyst import prompts, repository
from apps.ai_analyst.clients.gemini_client import get_gemini_client
from apps.ai_analyst.clients.naver_news import get_naver_news_client
from apps.ai_analyst.clients.opendart import get_opendart_client, red_flag_hints
from apps.ai_analyst.schemas import ScreenerQualitativeResponse

log = logging.getLogger(__name__)

CANDIDATE_LIMIT = 30
DART_DAYS = 90
NEWS_COUNT = prompts.NEWS_PER_ITEM  # 5
HOOK_MAX = 255  # ai_stock_evaluations.hook_summary String(255)
_LETTER_STATE = {1: "통과", 0: "미통과", -1: "해당없음", -2: "대기"}
_LETTER_NAMES = {"c": "C(분기 실적)", "a": "A(연간 실적)", "n": "N(신고가)", "s": "S(수급)", "l": "L(주도주)",
                 "i": "I(기관·외국인)", "m": "M(시장 방향)"}


# ---------------------------------------------------------------- 외부 의존(테스트에서 바꿔 끼운다)
def _screen(limit: int) -> dict:
    from apps.stock_api.services import canslim_query

    return canslim_query.screen(market="ALL", min_pass=0, sort="score", liquid_only=True, limit=limit, offset=0)


def _gemini():
    return get_gemini_client()


def _news():
    return get_naver_news_client()


def _dart():
    return get_opendart_client()


# ---------------------------------------------------------------- 후보
def summarize(item: dict) -> dict:
    """canslim_query.screen 항목 → 프롬프트용 한국어 요약 {항목: 값}."""
    letters = item.get("letters") or {}
    out = {
        "기준일": item.get("date"),
        "점수": item.get("score"),
        "통과 개수": item.get("pass_count"),
        "업종": item.get("sector_name"),
        "RS": item.get("rs"),
        "52주 고가 대비(%)": item.get("pct_from_high"),
    }
    for k, label in _LETTER_NAMES.items():
        if k in letters:
            out[label] = _LETTER_STATE.get(letters[k], str(letters[k]))
    return {k: v for k, v in out.items() if v is not None}


def candidates(day: date, *, limit: int = CANDIDATE_LIMIT) -> list[dict]:
    """CANSLIM 최신 기준일(≤ day 가 보통) 상위 limit 종목 → [{ticker, name, summary}]. 조회 실패면 []."""
    try:
        res = _screen(limit) or {}
    except Exception as exc:  # noqa: BLE001 — CH 장애
        log.warning("CANSLIM 후보 조회 실패(%s)", type(exc).__name__)
        return []
    as_of = res.get("date")
    if as_of and as_of != day.isoformat():
        log.info("CANSLIM 최신 기준일 %s 로 %s 정성 평가 후보를 고름", as_of, day.isoformat())
    out = []
    for it in (res.get("items") or [])[:limit]:
        out.append({"ticker": it["ticker"], "name": it.get("name") or it["ticker"],
                    "summary": summarize({**it, "date": as_of})})
    return out


# ---------------------------------------------------------------- 평가
def _apply_dart_floor(resp: ScreenerQualitativeResponse, hints: list[str]) -> ScreenerQualitativeResponse:
    """안전 쪽 보정: DART 공시에서 위험 키워드(CB·BW·유상증자·횡령 등)가 잡혔으면 AI 가 CLEAN 이라 해도 최소 WARNING.
    공시라는 사실 근거가 있는 위험을 모델 판단으로 지우지 않게 한다. 빠진 힌트는 red_flags 에 덧붙인다."""
    if not hints:
        return resp
    flags = list(resp.red_flags)
    flags += [h for h in hints if h not in flags]
    level = "WARNING" if resp.red_flag_level == "CLEAN" else resp.red_flag_level
    return resp.model_copy(update={"red_flag_level": level, "red_flags": flags})


def evaluate(day: date, ticker: str, name: str, canslim_summary, *, session: Session,
             dart=None, news=None, gemini=None) -> dict | None:
    """한 종목 정성 평가 → PG 저장 후 dict. Gemini 없으면 None. dart·news·gemini 를 안 주면 env 키로 만든다."""
    gemini = gemini if gemini is not None else _gemini()
    if gemini is None:
        return None
    dart = dart if dart is not None else _dart()
    news = news if news is not None else _news()

    disclosures = []
    if dart is not None:
        try:
            disclosures = dart.disclosures(ticker, days=DART_DAYS)
        except Exception as exc:  # noqa: BLE001
            log.warning("DART 공시 조회 실패(%s): %s", ticker, type(exc).__name__)
    hints = red_flag_hints(disclosures)
    articles = []
    if news is not None:
        try:
            articles = news.search(name, display=NEWS_COUNT, sort="date")
        except Exception as exc:  # noqa: BLE001
            log.warning("종목 뉴스 조회 실패(%s): %s", ticker, type(exc).__name__)

    prompt = prompts.stock_qualitative_prompt(ticker, name, canslim_summary, disclosures, hints, articles)
    resp = gemini.generate_json(prompt, ScreenerQualitativeResponse, system=prompts.SYSTEM_PROMPT)
    if resp is None:
        return None
    # ticker 는 모델 값을 믿지 않고 인자로 덮는다. hook_summary 는 PG String(255) 에 맞춘다
    resp = resp.model_copy(update={"ticker": ticker, "hook_summary": resp.hook_summary[:HOOK_MAX]})
    resp = _apply_dart_floor(resp, hints)
    repository.upsert_evaluation(session, day, resp)
    return {**resp.model_dump(), "date": day.isoformat()}


def evaluate_batch(day: date, *, session: Session, limit: int = CANDIDATE_LIMIT) -> dict:
    """후보 일괄 평가 — 이미 평가한 종목은 건너뛰고, 종목별 실패는 격리한다."""
    gemini = _gemini()
    if gemini is None:
        return {"skipped": "no_gemini_key"}  # 30종목 DART·뉴스 호출도 하지 않는다
    cands = candidates(day, limit=limit)
    if not cands:
        return {"ok": 0, "skipped": 0, "failed": [], "note": "no_candidates"}
    dart, news = _dart(), _news()
    try:
        done = repository.evaluated_tickers(session, day)
    except Exception as exc:  # noqa: BLE001 — PG 장애면 이번 회차 전체를 건너뛴다
        log.warning("기존 평가 조회 실패(%s)", type(exc).__name__)
        session.rollback()
        return {"skipped": "pg_error"}
    ok, skipped, failed = 0, 0, []
    for c in cands:
        if c["ticker"] in done:
            skipped += 1
            continue
        try:
            got = evaluate(day, c["ticker"], c["name"], c["summary"], session=session,
                           dart=dart, news=news, gemini=gemini)
        except Exception as exc:  # noqa: BLE001 — 한 종목 실패가 나머지를 막지 않게
            log.warning("정성 평가 실패(%s): %s", c["ticker"], type(exc).__name__)
            session.rollback()  # PG 는 실패한 트랜잭션을 되돌려야 다음 종목이 진행된다
            failed.append(c["ticker"])
            continue
        if got is None:
            failed.append(c["ticker"])
        else:
            ok += 1
    return {"ok": ok, "skipped": skipped, "failed": failed}


def get_latest(ticker: str, *, session: Session) -> dict | None:
    """API 용 — 종목의 가장 최근 정성 평가. PG 장애면 None(API 는 200 + 빈 값)."""
    try:
        return repository.get_latest_evaluation(session, ticker)
    except Exception as exc:  # noqa: BLE001
        log.warning("정성 평가 조회 실패(%s): %s", ticker, type(exc).__name__)
        session.rollback()
        return None

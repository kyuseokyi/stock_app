"""AI 시황 공개 REST(인증 없음) — stock_api 에 마운트. 라우터는 서비스 호출만 한다.

외부 키 없음·Redis/PG/ClickHouse 장애에도 200 + 빈 값(500 금지). 입력 형식 오류만 422 `{code, message}`.
동기 서비스는 스레드풀에서 돌고, PG 세션은 호출마다 열고 닫는다.
"""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Response
from fastapi.concurrency import run_in_threadpool

from apps.ai_analyst.services import investor_flow_ai, market_movers, morning_brief, stock_qualitative
from apps.ai_analyst.schemas import InvestorFlowResponse
from apps.collector.intraday_indices import KST
from apps.stock_api.services import market_query, verify_ticker
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)

market_router = APIRouter(prefix="/api/v1/market", tags=["market-ai"])
ai_router = APIRouter(prefix="/api/v1/ai", tags=["market-ai"])

CACHE_CONTROL = "public, max-age=30"  # 캐시는 서버(Redis) 주기가 10분 이상이라 30초면 충분
_EMPTY_MOVERS = {"updated_at": None, "gainers": [], "losers": [], "keywords": []}
_EMPTY_TREEMAP = {"date": None, "groups": []}  # market_query.treemap 이 데이터 없을 때 쓰는 모양과 같다


async def _safe(fn, default, *args):
    """동기 서비스를 스레드풀에서 — 어떤 예외든 기본값으로(공개 화면이 500 으로 깨지지 않게)."""
    try:
        return await run_in_threadpool(fn, *args)
    except Exception as exc:  # noqa: BLE001
        log.warning("AI 시황 조회 실패(%s): %s", getattr(fn, "__name__", fn), type(exc).__name__)
        return default


def _morning_brief() -> dict | None:
    with SyncSessionLocal() as db:
        return morning_brief.get_latest(datetime.now(KST).date(), session=db)


def _screener_analysis(ticker: str) -> dict | None:
    with SyncSessionLocal() as db:
        return stock_qualitative.get_latest(ticker, session=db)


def _invalid(code: str, message: str) -> HTTPException:
    return HTTPException(422, detail={"code": code, "message": message})


# ---------------------------------------------------------------- /api/v1/market
@market_router.get("/morning-brief")
async def get_morning_brief(response: Response):
    """오늘 모닝 브리핑, 없으면 최근 1건."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return {"brief": await _safe(_morning_brief, None)}


@market_router.get("/movers")
async def get_movers(response: Response):
    """급등·급락 Top 10 + AI 원인 + 핫 키워드(Redis). 장 마감 뒤엔 마지막 결과."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await _safe(market_movers.get_cached, dict(_EMPTY_MOVERS))


@market_router.get("/investor-flow")
async def get_investor_flow(response: Response):
    """외국인·기관·연기금 순매수 Top 10, 쌍끌이, AI 수급 해설(Redis)."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await _safe(investor_flow_ai.get_cached, InvestorFlowResponse().model_dump())


@market_router.get("/heatmap")
async def get_heatmap(response: Response, kind: str = "sector", size: str = "mcap", period: str = "1d"):
    """섹터·테마 트리맵 — GraphQL marketTreemap 과 같은 서비스(market_query.treemap) 결과."""
    if kind not in market_query.KINDS:
        raise _invalid("INVALID_KIND", f"kind 는 {', '.join(market_query.KINDS)} 중 하나예요.")
    if size not in market_query.SIZES:
        raise _invalid("INVALID_SIZE", f"size 는 {', '.join(market_query.SIZES)} 중 하나예요.")
    if period not in market_query.PERIODS:
        raise _invalid("INVALID_PERIOD", f"period 는 {', '.join(market_query.PERIODS)} 중 하나예요.")
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await _safe(market_query.treemap, dict(_EMPTY_TREEMAP), kind, size, period)


# ---------------------------------------------------------------- /api/v1/ai
@ai_router.get("/screener-analysis/{ticker}")
async def get_screener_analysis(ticker: str, response: Response):
    """종목의 최근 AI 정성 분석(실적 품질·지뢰). 없으면 analysis=null."""
    try:
        t = verify_ticker.normalize_ticker(ticker)
    except verify_ticker.InvalidTicker:
        raise _invalid("INVALID_TICKER", "종목 코드는 영문·숫자 6자리예요.")
    response.headers["Cache-Control"] = CACHE_CONTROL
    return {"analysis": await _safe(_screener_analysis, None, t)}

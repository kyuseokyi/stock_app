"""종목 단위 공개 REST(인증 없음) — 라우터는 입력 검증과 서비스 호출만 한다.

- GET /api/v1/stocks/{ticker}/lending?days=120 → 대차잔고 추이 [{date, balance_qty, net_qty, balance_amt}] 오래된 순.
  데이터 없음·ClickHouse 장애·테이블 없음은 200 + [](화면은 섹션을 숨김). 종목 코드 형식 오류만 422 `{code, message}`.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.concurrency import run_in_threadpool

from apps.stock_api.services import lending_query, verify_ticker

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/stocks", tags=["stocks"])

CACHE_CONTROL = "public, max-age=300"  # 대차는 하루 한 번(20:30) 갱신


@router.get("/{ticker}/lending")
async def get_lending(ticker: str, response: Response,
                      days: int = Query(lending_query.DEFAULT_DAYS, ge=1, le=lending_query.MAX_DAYS)):
    """종목 대차잔고 추이(최근 days 거래일, 오래된 순). 없으면 []."""
    try:
        t = verify_ticker.normalize_ticker(ticker)
    except verify_ticker.InvalidTicker:
        raise HTTPException(422, detail={"code": "INVALID_TICKER", "message": "종목 코드는 영문·숫자 6자리예요."})
    response.headers["Cache-Control"] = CACHE_CONTROL
    try:
        return await run_in_threadpool(lending_query.lending_trend, t, days)
    except Exception as exc:  # noqa: BLE001 — 공개 화면이 500 으로 깨지지 않게(개발 서버는 데이터 없음)
        log.warning("대차잔고 조회 실패(%s): %s", t, type(exc).__name__)
        return []

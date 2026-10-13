"""게임 실시간 체결 TR 선택 — UN(통합) 우선, NXT 미상장 종목은 KRX(H0STCNT0).

CLAUDE.md "KIS 데이터 수집 규칙" 의 UN→J 폴백을 실시간(WebSocket)에 적용한다.
- 마스터(.mst)에는 NXT 상장 여부 플래그가 없다 → REST 일봉을 UN 으로 조회해 판정한다
  (수집기 fetcher 와 동일 근거: NXT 미상장 종목은 UN 조회 시 빈 응답).
- 프로브 실패(None)면 UN 을 시도하고, 구독 거부가 연속되면 ws_client 가 KRX 로 런타임 폴백한다.
- GAME_WS_TR_ID 로 강제 지정 가능(auto|H0UNCNT0|H0STCNT0|H0NXCNT0, 기본 auto).
"""
from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable
from datetime import date, timedelta

log = logging.getLogger(__name__)

TR_UNIFIED = "H0UNCNT0"  # 국내주식 실시간체결가(통합 KRX+NXT)
TR_KRX = "H0STCNT0"      # 국내주식 실시간체결가(KRX)
TR_NXT = "H0NXCNT0"      # 국내주식 실시간체결가(NXT)
_VALID = {TR_UNIFIED, TR_KRX, TR_NXT}
_PROBE_LOOKBACK_DAYS = 14


def choose_tr_id(override: str | None, nxt_listed: bool | None) -> str:
    """override(유효 TR)가 우선. auto 면 NXT 미상장(False)만 KRX, 그 외(True/None)는 UN."""
    o = (override or "").strip().upper()
    if o in _VALID:
        return o
    if o and o != "AUTO":
        log.warning("GAME_WS_TR_ID 알 수 없음(%s) → auto", override)
    return TR_KRX if nxt_listed is False else TR_UNIFIED


def probe_nxt_listed(ticker: str, client=None, today: date | None = None) -> bool | None:
    """최근 일봉을 UN 으로 조회 — 행 있으면 True, 비면 False(NXT 미상장), 오류면 None."""
    today = today or date.today()
    start = (today - timedelta(days=_PROBE_LOOKBACK_DAYS)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")
    try:
        if client is None:
            from apps.collector.kis.client import KISClient

            client = KISClient()
        rows = client.get_daily_ohlcv(ticker, start, end, "UN")
    except Exception as e:  # noqa: BLE001 — 판정 불가는 None(상위에서 UN 시도)
        log.warning("NXT 상장 프로브 실패(%s): %s", ticker, e)
        return None
    return any(r.get("stck_bsop_date") and r.get("stck_clpr") for r in rows)


async def select_tr_id(
    ticker: str, probe: Callable[[str], bool | None] = probe_nxt_listed
) -> str:
    """환경변수 + (auto 일 때만) 프로브로 구독 TR 결정. 프로브는 스레드에서 실행."""
    override = os.getenv("GAME_WS_TR_ID", "auto")
    if (override or "").strip().upper() in _VALID:
        tr = choose_tr_id(override, None)
    else:
        listed = await asyncio.to_thread(probe, ticker)
        tr = choose_tr_id(override, listed)
        log.info("NXT 상장 프로브: ticker=%s listed=%s", ticker, listed)
    log.info("실시간 체결 TR 선택: ticker=%s tr_id=%s", ticker, tr)
    return tr

"""게임 분봉 캔들 — 활성 시즌 종목의 n분봉(CH 조회는 전용 스레드풀)."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy.ext.asyncio import AsyncSession

from apps.trading_game.services import account_service, minute_candles_query

log = logging.getLogger(__name__)

# 동기 CH 조회가 이벤트 루프·기본 executor 를 막지 않게(rsi_service 와 같은 방식)
_CH_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="candles-ch")
QUERY_TIMEOUT_SEC = 5.0  # CH 무응답 시 대기 대신 503

Fetch = Callable[[str, str], list[dict]]


class CandlesUnavailable(RuntimeError):
    """ClickHouse 조회 실패 — 라우터는 503."""


def _is_missing_table(e: Exception) -> bool:
    """ClickHouse UNKNOWN_TABLE(Code: 60)."""
    msg = str(e)
    return "UNKNOWN_TABLE" in msg or "Code: 60." in msg


async def get_candles(db: AsyncSession, interval: str, fetch: Fetch | None = None) -> dict:
    """{"interval","ticker","candles"} — 활성 시즌 없으면 ticker=None·candles=[]."""
    season = await account_service.get_active_season(db)
    if season is None:
        return {"interval": interval, "ticker": None, "candles": []}
    fetch = fetch or minute_candles_query.fetch_candles
    loop = asyncio.get_running_loop()
    try:
        candles = await asyncio.wait_for(
            loop.run_in_executor(_CH_EXECUTOR, fetch, season.ticker, interval), timeout=QUERY_TIMEOUT_SEC,
        )
    except Exception as e:  # noqa: BLE001
        if _is_missing_table(e):  # game_ws 가 아직 테이블을 만들기 전 = 분봉 없음
            return {"interval": interval, "ticker": season.ticker, "candles": []}
        log.warning("분봉 조회 실패: ticker=%s interval=%s err=%s", season.ticker, interval, e)
        raise CandlesUnavailable(str(e)) from e
    return {"interval": interval, "ticker": season.ticker, "candles": candles}

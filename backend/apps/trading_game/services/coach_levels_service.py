"""데일리 코치 지지·저항 추천값 — 시즌 종목 일봉(CH)을 읽어 sr_levels 로 계산.

MORNING 은 target_date 전날까지, EVENING 은 당일까지의 일봉을 쓴다(당일 봉이 아직 없으면 전날까지).
CH 조회는 rsi_service 와 같은 방식(전용 스레드풀 + 타임아웃 + stock_api 지연 import).
"""
from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameSeason
from apps.trading_game.schemas.game_dtos import CoachLevelSuggestion, CoachLevelsResponse
from apps.trading_game.services.sr_levels import LOOKBACK, Bar, Level, suggest_levels

log = logging.getLogger("trading_game.coach_levels")

CALENDAR_SPAN_DAYS = 120  # 거래일 60개 이상 확보용 달력 구간
QUERY_TIMEOUT_SEC = 5.0
_CH_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="coach-levels-ch")


class SeasonNotFound(LookupError):
    pass


class BarsUnavailable(RuntimeError):
    """일봉 없음 또는 CH 장애 — get_candles 가 둘을 구분하지 않으므로 하나로 다룬다."""


def fetch_bars(ticker: str, start: date, end: date) -> list[Bar] | None:
    from apps.stock_api.services import clickhouse_source  # 의도적 cross-app 지연 import(rsi_service 선례)

    candles = clickhouse_source.get_candles(ticker, start.isoformat(), end.isoformat())
    if candles is None:
        return None
    return [Bar(high=float(c.high), low=float(c.low), close=float(c.close)) for c in candles]


def basis_end(target_date: date, coach_type: str) -> date:
    return target_date if coach_type == "EVENING" else target_date - timedelta(days=1)


def _dto(level: Level | None) -> CoachLevelSuggestion | None:
    if level is None:
        return None
    return CoachLevelSuggestion(price=level.price, touches=level.touches, basis=level.basis)


async def suggest(db: AsyncSession, season_id: int, target_date: date, coach_type: str) -> CoachLevelsResponse:
    season = await db.get(GameSeason, season_id)
    if season is None:
        raise SeasonNotFound(season_id)
    end = basis_end(target_date, coach_type)
    start = end - timedelta(days=CALENDAR_SPAN_DAYS)
    loop = asyncio.get_running_loop()
    try:
        bars = await asyncio.wait_for(
            loop.run_in_executor(_CH_EXECUTOR, fetch_bars, season.ticker, start, end),
            timeout=QUERY_TIMEOUT_SEC,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("지지·저항 추천 일봉 조회 실패 ticker=%s err=%s", season.ticker, e)
        raise BarsUnavailable(str(e)) from e
    if not bars:
        raise BarsUnavailable("no bars")
    bars = bars[-LOOKBACK:]
    support, resistance = suggest_levels(bars)
    return CoachLevelsResponse(
        ticker=season.ticker, basis_end=end, bars=len(bars), last_close=round(bars[-1].close),
        support=_dto(support), resistance=_dto(resistance),
    )

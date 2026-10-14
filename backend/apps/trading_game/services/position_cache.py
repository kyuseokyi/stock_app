"""활성 시즌 OPEN 포지션 메모리 캐시 — 틱 경로(청산 후보 판정·개인손익·랭킹)의 DB 조회 제거.

갱신:
  (a) mark_dirty() — 같은 프로세스의 주문 체결·청산·보상 지급 후 호출 → 다음 사용 시 재적재.
  (b) TTL(GAME_POSITION_CACHE_TTL_SEC, 기본 5초) — Celery 정산 등 다른 프로세스 변경 반영.
단일 워커 전제(인메모리). 재적재는 asyncio.Lock 으로 중복 방지.

정확성: 청산은 이 캐시로 '후보만' 고르고 DB(order_engine.close_position)가 OPEN 을 확인해 확정한다.
mark_dirty 는 세대(generation) 카운터 — 적재 쿼리 도중 들어온 dirty 는 그 적재로 지워지지 않는다.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Callable

from sqlalchemy import select

from shared.game_models import GameAccount, GamePosition, GameSeason
from apps.trading_game.services import reward_service

log = logging.getLogger("trading_game.position_cache")

DEFAULT_TTL_SEC = 5.0
_RETRY_AFTER_FAIL_SEC = 1.0  # 적재 실패 시 틱마다 DB 를 두드리지 않도록 최소 간격


def ttl_from_env() -> float:
    try:
        v = float(os.getenv("GAME_POSITION_CACHE_TTL_SEC", DEFAULT_TTL_SEC))
        return v if v > 0 else DEFAULT_TTL_SEC
    except ValueError:
        return DEFAULT_TTL_SEC


@dataclass(frozen=True)
class CachedPosition:
    position_id: uuid.UUID
    account_id: uuid.UUID
    user_id: int
    season_id: int
    ticker: str
    side: str
    entry_price: Decimal
    leverage: int
    size_amount: Decimal
    stop_loss_price: Decimal | None
    take_profit_price: Decimal | None


@dataclass(frozen=True)
class CachedAccount:
    account_id: uuid.UUID
    user_id: int
    season_id: int
    cash_balance: Decimal
    principal: Decimal  # = reward_service.principal(acc)


@dataclass(frozen=True)
class Snapshot:
    positions: tuple[CachedPosition, ...] = ()
    accounts: dict = field(default_factory=dict)        # account_id -> CachedAccount
    season_windows: dict = field(default_factory=dict)  # season_id -> (start_at, end_at)

    def for_ticker(self, ticker: str) -> list[CachedPosition]:
        return [p for p in self.positions if p.ticker == ticker]


EMPTY = Snapshot()


async def _load(session_factory) -> Snapshot:
    async with session_factory() as db:
        rows = await db.execute(
            select(GamePosition, GameAccount, GameSeason)
            .join(GameAccount, GamePosition.account_id == GameAccount.id)
            .join(GameSeason, GameAccount.season_id == GameSeason.id)
            .where(GamePosition.status == "OPEN", GameSeason.status == "ACTIVE")
        )
        positions: list[CachedPosition] = []
        accounts: dict = {}
        windows: dict = {}
        for pos, acc, season in rows.all():
            positions.append(CachedPosition(
                position_id=pos.id, account_id=acc.id, user_id=acc.user_id, season_id=acc.season_id,
                ticker=season.ticker, side=pos.side, entry_price=pos.entry_price, leverage=pos.leverage,
                size_amount=pos.size_amount, stop_loss_price=pos.stop_loss_price,
                take_profit_price=pos.take_profit_price,
            ))
            accounts[acc.id] = CachedAccount(
                account_id=acc.id, user_id=acc.user_id, season_id=acc.season_id,
                cash_balance=acc.cash_balance, principal=reward_service.principal(acc),
            )
            windows[season.id] = (season.start_at, season.end_at)
    return Snapshot(positions=tuple(positions), accounts=accounts, season_windows=windows)


class PositionCache:
    def __init__(self, ttl: float | None = None, clock: Callable[[], float] = time.monotonic) -> None:
        self._ttl = ttl if ttl is not None else ttl_from_env()
        self._clock = clock
        self._snapshot: Snapshot | None = None
        self._gen = 0          # mark_dirty 마다 +1
        self._loaded_gen = -1  # 마지막 적재가 시작될 때의 세대
        self._loaded_at = 0.0
        self._retry_at = 0.0
        self._lock = asyncio.Lock()

    def mark_dirty(self) -> None:
        self._gen += 1

    def _stale(self) -> bool:
        if self._snapshot is None or self._loaded_gen != self._gen:
            return True
        return self._clock() - self._loaded_at >= self._ttl

    async def get(self, session_factory) -> Snapshot:
        """최신 스냅샷(필요 시 재적재). 적재 실패해도 예외 없이 이전 스냅샷(없으면 빈 스냅샷)."""
        if not self._stale():
            return self._snapshot  # type: ignore[return-value]
        async with self._lock:
            if self._stale() and self._clock() >= self._retry_at:
                gen = self._gen
                started = self._clock()
                try:
                    snap = await _load(session_factory)
                except Exception:
                    log.exception("포지션 캐시 적재 실패 — 이전 스냅샷 유지")
                    self._retry_at = self._clock() + _RETRY_AFTER_FAIL_SEC
                else:
                    self._snapshot = snap
                    self._loaded_gen = gen  # 적재 중 mark_dirty 가 오면 gen 불일치 → 다음에 재적재
                    self._loaded_at = started
        return self._snapshot if self._snapshot is not None else EMPTY


cache = PositionCache()


def mark_dirty() -> None:
    """같은 프로세스의 포지션·계좌 변경(주문/청산/보상) 후 호출."""
    cache.mark_dirty()


def reset_cache() -> None:
    """테스트용 — 새 캐시 인스턴스(새 Lock)."""
    global cache
    cache = PositionCache()

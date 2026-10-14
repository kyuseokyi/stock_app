"""활성 시즌 OPEN 포지션 메모리 캐시 — 틱 경로(청산 후보 판정·개인손익·랭킹)의 DB 조회 제거.

갱신:
  (a) mark_dirty() — 주문 체결·청산·보상 지급 후 호출 → 로컬 캐시 dirty + Redis `game:cache:dirty` 발행.
      주문은 비리더 인스턴스가 받을 수 있으므로, 각 인스턴스 ws_bus 구독자가 이 채널을 받아 자기 캐시를
      dirty 처리한다(캐시를 실제로 쓰는 건 리더).
  (b) TTL(GAME_POSITION_CACHE_TTL_SEC, 기본 5초) — 안전망. Celery 정산 등 다른 프로세스 변경·알림 유실 반영.
재적재는 asyncio.Lock 으로 중복 방지.

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
from apps.trading_game import deps
from apps.trading_game.services import reward_service

log = logging.getLogger("trading_game.position_cache")

DIRTY_CHANNEL = "game:cache:dirty"
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
    season_periods: dict = field(default_factory=dict)  # season_id -> 'month'|'quarter'(월간 랭킹 여부)

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
        periods: dict = {}
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
            periods[season.id] = season.period
    return Snapshot(positions=tuple(positions), accounts=accounts, season_windows=windows,
                    season_periods=periods)


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


_pending_notifies: set[asyncio.Task] = set()


async def publish_dirty(redis=None) -> None:
    """다른 인스턴스(리더)에 캐시 무효화 알림 — best-effort(실패해도 TTL 재적재가 안전망)."""
    try:
        r = redis if redis is not None else deps.get_redis()
        await r.publish(DIRTY_CHANNEL, "1")
    except Exception:
        log.warning("캐시 dirty 알림 발행 실패 — TTL 재적재로 반영", exc_info=True)


def mark_dirty() -> None:
    """포지션·계좌 변경(주문/청산/보상) 후 호출 — 동기 함수 유지(호출부 변경 없음).

    로컬 캐시 즉시 dirty + 실행 중 이벤트 루프가 있으면 알림 발행을 백그라운드로(호출부를 막지 않음).
    """
    cache.mark_dirty()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(publish_dirty())
    _pending_notifies.add(task)
    task.add_done_callback(_pending_notifies.discard)


def mark_dirty_local() -> None:
    """구독자가 받은 dirty 알림 처리 — 로컬만(재발행 금지)."""
    cache.mark_dirty()


def reset_cache() -> None:
    """테스트용 — 새 캐시 인스턴스(새 Lock)."""
    global cache
    cache = PositionCache()

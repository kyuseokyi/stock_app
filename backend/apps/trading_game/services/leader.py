"""싱글톤 작업 리더 선출 — 인스턴스 N개 중 1개만 틱 리스너·묶기 전송·개인손익·시장심리 루프를 돌린다.

락: Redis `game:leader:{name}` = `SET key <instance_id> NX PX <ttl>`.
  - 리더는 ttl/3 주기로 갱신 — 값이 자기 것일 때만(Lua compare-and-pexpire).
  - 갱신 실패/Redis 오류 → 즉시 리더 포기(작업 취소). 오류 중에 버티면 TTL 만료 후 리더 2개가 될 수 있음.
  - 정상 종료(stop) → 작업 취소 후 compare-and-del 로 반납(남의 락은 지우지 않음).
  - 비정상 종료(프로세스 kill·태스크 cancel) → 반납 없이 TTL 만료 후 다른 인스턴스가 승계(≤ ttl + ttl/3).
비리더는 ttl/3 주기로 획득 재시도. 기본 ttl 10초(GAME_LEADER_TTL_MS).
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import socket
import uuid
from typing import Awaitable, Callable, Sequence

log = logging.getLogger("trading_game.leader")

DEFAULT_TTL_MS = 10_000
KEY_PREFIX = "game:leader:"

# KEYS[1]=락 키, ARGV[1]=instance_id, ARGV[2]=ttl ms — 자기 값일 때만 연장
_RENEW_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
"""
# 자기 값일 때만 삭제
_RELEASE_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""

TaskFactory = Callable[[asyncio.Event], Awaitable[None]]


def ttl_ms_from_env() -> int:
    try:
        v = int(os.getenv("GAME_LEADER_TTL_MS", DEFAULT_TTL_MS))
        return v if v >= 300 else DEFAULT_TTL_MS
    except ValueError:
        return DEFAULT_TTL_MS


def new_instance_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex}"


class LeaderElector:
    def __init__(
        self,
        redis,
        name: str,
        *,
        instance_id: str | None = None,
        ttl_ms: int | None = None,
        interval: float | None = None,
    ) -> None:
        self._redis = redis
        self.name = name
        self.key = f"{KEY_PREFIX}{name}"
        self.instance_id = instance_id or new_instance_id()
        self.ttl_ms = ttl_ms if ttl_ms is not None else ttl_ms_from_env()
        self.interval = interval if interval is not None else self.ttl_ms / 3000.0  # 갱신·재시도 주기(초)
        self.is_leader = False

    async def try_acquire(self) -> bool:
        """SET NX PX. 실패해도 락 값이 자기 것이면(예: Redis 일시 오류로 포기했던 자기 락) 연장해 재획득."""
        if await self._redis.set(self.key, self.instance_id, nx=True, px=self.ttl_ms):
            return True
        return await self.renew()

    async def renew(self) -> bool:
        return int(await self._redis.eval(_RENEW_LUA, 1, self.key, self.instance_id, self.ttl_ms)) == 1

    async def release(self) -> bool:
        return int(await self._redis.eval(_RELEASE_LUA, 1, self.key, self.instance_id)) == 1

    async def run(
        self,
        stop: asyncio.Event,
        factories: Sequence[TaskFactory],
        *,
        on_gain: Callable[[], None] | None = None,
    ) -> None:
        """감독 루프: 리더가 되면 factories 를 (term 전용 stop 이벤트로) 시작, 잃으면 즉시 취소."""
        term_stop: asyncio.Event | None = None
        tasks: list[asyncio.Task] = []

        async def step_down(reason: str) -> None:
            nonlocal term_stop, tasks
            if not self.is_leader:
                return
            self.is_leader = False
            log.warning("리더 상실(%s) name=%s id=%s — 싱글톤 작업 중지", reason, self.name, self.instance_id)
            if term_stop is not None:
                term_stop.set()
            for t in tasks:
                t.cancel()
            for t in tasks:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await t
            tasks, term_stop = [], None

        try:
            while not stop.is_set():
                if self.is_leader:
                    try:
                        still = await self.renew()
                    except Exception:
                        log.warning("리더 락 갱신 오류 — 안전을 위해 리더 포기", exc_info=True)
                        still = False
                    if not still:
                        await step_down("갱신 실패")
                        continue  # 즉시 재획득 시도(빈 락이면 곧바로 다시 리더)
                else:
                    try:
                        got = await self.try_acquire()
                    except Exception:
                        log.warning("리더 락 획득 오류 — 재시도", exc_info=True)
                        got = False
                    if got:
                        self.is_leader = True
                        log.warning("리더 획득 name=%s id=%s — 싱글톤 작업 시작", self.name, self.instance_id)
                        if on_gain is not None:
                            with contextlib.suppress(Exception):
                                on_gain()
                        term_stop = asyncio.Event()
                        tasks = [asyncio.create_task(f(term_stop)) for f in factories]
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=self.interval)
        except asyncio.CancelledError:
            # 비정상 종료 — 작업만 정리하고 락은 TTL 만료에 맡김
            for t in tasks:
                t.cancel()
            raise
        # 정상 종료 — 작업 중지 후 락 반납(자기 것일 때만)
        was_leader = self.is_leader
        await step_down("종료")
        if was_leader:
            with contextlib.suppress(Exception):
                await self.release()
        log.info("리더 감독 종료 name=%s", self.name)

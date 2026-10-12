"""기능 on/off 플래그 (Phase 5b) — DB 원장 + Redis 30초 캐시.

행이 없으면 ON(마이그레이션 시드와 동일). Redis 장애 시 DB 를 직접 읽어 판정을 계속한다.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameFeatureFlag

log = logging.getLogger("trading_game.flags")

KNOWN_FLAGS = ("QUIZ", "STREAK")
CACHE_TTL_SECONDS = 30


class UnknownFlag(Exception):
    pass


def _cache_key(flag: str) -> str:
    return f"game:flag:{flag}"


async def _read_db(db: AsyncSession, flag: str) -> bool:
    row = await db.get(GameFeatureFlag, flag)
    return True if row is None else bool(row.enabled)


async def is_enabled(db: AsyncSession, redis, flag: str) -> bool:
    try:
        cached = await redis.get(_cache_key(flag))
    except Exception:
        log.warning("플래그 캐시 조회 실패 — DB 직접 조회 flag=%s", flag, exc_info=True)
        return await _read_db(db, flag)
    if cached is not None:
        return cached == "1"
    value = await _read_db(db, flag)
    try:
        await redis.set(_cache_key(flag), "1" if value else "0", ex=CACHE_TTL_SECONDS)
    except Exception:
        log.warning("플래그 캐시 저장 실패 flag=%s", flag, exc_info=True)
    return value


async def list_flags(db: AsyncSession) -> list[GameFeatureFlag]:
    rows = (
        await db.execute(select(GameFeatureFlag).where(GameFeatureFlag.key.in_(KNOWN_FLAGS)))
    ).scalars().all()
    by_key = {r.key: r for r in rows}
    # 행이 없는 플래그는 ON(미저장 객체)으로 채워 항상 KNOWN_FLAGS 순서로 반환
    return [by_key.get(k) or GameFeatureFlag(key=k, enabled=True, updated_at=None) for k in KNOWN_FLAGS]


async def set_flag(db: AsyncSession, redis, flag: str, enabled: bool) -> GameFeatureFlag:
    if flag not in KNOWN_FLAGS:
        raise UnknownFlag(flag)
    row = await db.get(GameFeatureFlag, flag)
    if row is None:
        row = GameFeatureFlag(key=flag)
        db.add(row)
    row.enabled = enabled
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    try:
        await redis.delete(_cache_key(flag))
    except Exception:
        log.warning("플래그 캐시 삭제 실패(최대 %ss 지연 반영) flag=%s", CACHE_TTL_SECONDS, flag, exc_info=True)
    return row

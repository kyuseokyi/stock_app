"""스크리너 탭 보이기 스위치 — 관리자가 사용자 화면의 종목 찾기 전체(STOCK_FINDER)와 조건검색(FINDER)·차트 패턴(PATTERNS) 탭을
켜고 끈다(웹·모바일이 GraphQL screenerFeatures 로 읽음). STOCK_FINDER 가 꺼지면 FINDER·PATTERNS 와 무관하게 종목 찾기
(주도주·조건검색·패턴)가 모두 숨겨진다 — 판정은 클라이언트가 한다(관리자 화면은 이 스위치와 무관).

DB(screener_features) 원장. 행이 없으면 OFF(숨김) — 다듬는 중인 탭을 기본으로 막아 둔다.
stock_api 는 Redis 를 쓰지 않으므로 공개 조회는 프로세스 안 30초 캐시. 관리자가 바꾸면 이 프로세스 캐시는 바로 비우고,
다른 복제본은 최대 30초 뒤 반영된다.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import SyncSessionLocal
from shared.market_models import ScreenerFeature

KNOWN = ("STOCK_FINDER", "FINDER", "PATTERNS")
CACHE_TTL_SECONDS = 30

_cache: tuple[float, dict[str, bool]] | None = None


class UnknownFeature(Exception):
    pass


def _fill(rows: list[ScreenerFeature]) -> dict[str, bool]:
    by_key = {r.key: bool(r.enabled) for r in rows}
    return {k: by_key.get(k, False) for k in KNOWN}


def enabled_map() -> dict[str, bool]:
    """공개 조회(동기) — {'STOCK_FINDER': bool, 'FINDER': bool, 'PATTERNS': bool}. DB 오류면 전부 OFF(숨김 쪽이 안전)."""
    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache[0] < CACHE_TTL_SECONDS:
        return _cache[1]
    try:
        with SyncSessionLocal() as db:
            rows = list(db.execute(select(ScreenerFeature).where(ScreenerFeature.key.in_(KNOWN))).scalars())
    except Exception:  # noqa: BLE001 — 스위치 조회 실패가 스크리너 전체를 막지 않게
        return {k: False for k in KNOWN}
    value = _fill(rows)
    _cache = (now, value)
    return value


def clear_cache() -> None:
    global _cache
    _cache = None


async def list_features(db: AsyncSession) -> list[ScreenerFeature]:
    rows = (await db.execute(select(ScreenerFeature).where(ScreenerFeature.key.in_(KNOWN)))).scalars().all()
    by_key = {r.key: r for r in rows}
    # 행이 없는 스위치는 OFF(미저장 객체)로 채워 항상 KNOWN 순서로
    return [by_key.get(k) or ScreenerFeature(key=k, enabled=False, updated_at=None) for k in KNOWN]


async def set_feature(db: AsyncSession, key: str, enabled: bool) -> ScreenerFeature:
    if key not in KNOWN:
        raise UnknownFeature(key)
    row = await db.get(ScreenerFeature, key)
    if row is None:
        row = ScreenerFeature(key=key)
        db.add(row)
    row.enabled = enabled
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    clear_cache()
    return row

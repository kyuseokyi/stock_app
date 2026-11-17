"""오늘 특징주 Redis 저장소 — collector 가 쓰고 stock_api(GET /api/v1/market/featured)가 읽는다.

- 신고저가 스냅숏: `market:featured:highs` = {date, eligible, computed_at, highs:{count, items}, lows:{count, items}}.
  20:30 파이프라인 단계 featured_highs 가 덮어쓴다. TTL 14일 — 긴 연휴에도 카드가 비지 않게(다음 계산이 덮어씀).
읽기 실패·깨진 JSON 은 None(호출한 쪽이 빈 모양으로). Redis 연결 오류는 호출한 쪽이 처리한다.
"""
from __future__ import annotations

import json

HIGHS_KEY = "market:featured:highs"
HIGHS_TTL = 14 * 24 * 3600


def _load(redis, key: str) -> dict | None:
    raw = redis.get(key)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def save_highs(redis, snapshot: dict) -> None:
    redis.set(HIGHS_KEY, json.dumps(snapshot, ensure_ascii=False, allow_nan=False), ex=HIGHS_TTL)


def load_highs(redis) -> dict | None:
    return _load(redis, HIGHS_KEY)

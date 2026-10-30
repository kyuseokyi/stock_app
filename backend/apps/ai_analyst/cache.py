"""AI 시황 Redis JSON 캐시 — 실패는 경고만 남기고 삼킨다(Redis 장애로 API 가 500 이 되면 안 된다)."""
from __future__ import annotations

import json
import logging

from shared.sync_redis import get_sync_redis

log = logging.getLogger(__name__)

MOVERS_KEY = "ai:market:movers:today"
MOVERS_TTL = 600
KEYWORDS_KEY = "ai:market:keywords:today"
KEYWORDS_TTL = 1800
INVESTOR_FLOW_KEY = "market:investor_flow:today"
INVESTOR_FLOW_TTL = 26 * 3600
# 장 마감 뒤·다음 날 개장 전에도 화면이 비지 않게 — 마지막 성공 결과를 따로 오래 보관(주말·연휴 포함 4일)
MOVERS_LAST_KEY = "ai:market:movers:last"
KEYWORDS_LAST_KEY = "ai:market:keywords:last"
LAST_TTL = 4 * 86400


def put_json(key: str, value, ttl: int, *, client=None) -> bool:
    try:
        (client or get_sync_redis()).set(key, json.dumps(value, ensure_ascii=False, default=str), ex=ttl)
        return True
    except Exception as exc:  # noqa: BLE001 — 연결·직렬화 오류 모두
        log.warning("AI 캐시 저장 실패(%s): %s", key, exc)
        return False


def get_json(key: str, *, client=None):
    try:
        raw = (client or get_sync_redis()).get(key)
    except Exception as exc:  # noqa: BLE001
        log.warning("AI 캐시 읽기 실패(%s): %s", key, exc)
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        log.warning("AI 캐시 JSON 깨짐(%s)", key)
        return None

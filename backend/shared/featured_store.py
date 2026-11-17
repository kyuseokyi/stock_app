"""오늘 특징주 Redis 저장소 — collector 가 쓰고 stock_api(GET /api/v1/market/featured)가 읽는다.

- 신고저가 스냅숏: `market:featured:highs` = {date, eligible, computed_at, highs:{count, items}, lows:{count, items}}.
  20:30 파이프라인 단계 featured_highs 가 덮어쓴다. TTL 14일 — 긴 연휴에도 카드가 비지 않게(다음 계산이 덮어씀).
- VI 발동(키움 ka10054, 장중 5분): `market:vi:{YYYYMMDD}` = {date, updated_at, count, items}(TTL 2일).
  연속 실패 수 `market:vi:fail:{YYYYMMDD}`, 그날 중단 표시 `market:vi:halt:{YYYYMMDD}`(둘 다 TTL 2일).
  키가 없으면(개발 서버 — 키움 키 없음, 아직 수집 전) API 는 vi=null 로 그 칸을 숨긴다.
읽기 실패·깨진 JSON 은 None(호출한 쪽이 빈 모양으로). Redis 연결 오류는 호출한 쪽이 처리한다.
"""
from __future__ import annotations

import json
from datetime import date

HIGHS_KEY = "market:featured:highs"
HIGHS_TTL = 14 * 24 * 3600
VI_TTL = 2 * 24 * 3600


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


# ------------------------------------------------------------------ VI
def _ymd(day: date) -> str:
    return day.strftime("%Y%m%d")


def vi_key(day: date) -> str:
    return f"market:vi:{_ymd(day)}"


def _fail_key(day: date) -> str:
    return f"market:vi:fail:{_ymd(day)}"


def _halt_key(day: date) -> str:
    return f"market:vi:halt:{_ymd(day)}"


def save_vi(redis, day: date, snapshot: dict) -> None:
    redis.set(vi_key(day), json.dumps(snapshot, ensure_ascii=False, allow_nan=False), ex=VI_TTL)


def load_vi(redis, day: date) -> dict | None:
    return _load(redis, vi_key(day))


def vi_record_failure(redis, day: date) -> int:
    """연속 실패 수 +1(그날 키) — 새 값."""
    n = int(redis.incr(_fail_key(day)))
    redis.expire(_fail_key(day), VI_TTL)
    return n


def vi_failures(redis, day: date) -> int:
    raw = redis.get(_fail_key(day))
    try:
        return int(raw) if raw else 0
    except ValueError:
        return 0


def vi_reset_failures(redis, day: date) -> None:
    redis.delete(_fail_key(day))


def vi_halt(redis, day: date, reason: str) -> None:
    redis.set(_halt_key(day), reason[:200], ex=VI_TTL)


def vi_halted(redis, day: date) -> bool:
    return bool(redis.exists(_halt_key(day)))

"""오늘 특징주 조회 — 신고저가 스냅숏 + 오늘 VI 발동(Redis, shared.featured_store).

공개 REST `GET /api/v1/market/featured`(apps/ai_analyst/router.py market_router)가 쓴다.
- 신고저가는 20:30 계산 결과 — 장중에는 직전 거래일 기준(date 로 표시).
- VI 는 오늘(KST) 키가 있을 때만 객체, 없으면 null(키움 키 없음·수집 전·휴장일) → 화면은 VI 칸을 숨긴다.
  키움 env 가 아니라 Redis 키 유무로 판단한다(stock_api 컨테이너에는 키움 env 가 없을 수 있음).
형식이 깨진 값은 빈 모양으로 돌려준다(500 금지).
"""
from __future__ import annotations

from datetime import date

from apps.collector.trading_day import now_kst
from shared import featured_store
from shared.sync_redis import get_sync_redis

TOP_N = 20
_HIGH_KEYS = ("ticker", "name", "market", "close", "change_rate", "high", "low", "prev_high_52w", "prev_low_52w")
_VI_KEYS = ("ticker", "name", "time", "released_at", "kind", "direction", "price", "rate", "open_rate", "count",
            "exchange")


def empty() -> dict:
    return {"date": None, "highs": {"count": 0, "items": []}, "lows": {"count": 0, "items": []}, "vi": None}


def _items(raw, keys: tuple[str, ...]) -> list[dict]:
    if not isinstance(raw, list):
        return []
    return [{k: x.get(k) for k in keys} for x in raw if isinstance(x, dict) and x.get("ticker")][:TOP_N]


def _count(raw, items: list[dict]) -> int:
    try:
        return max(int(raw), len(items))
    except (TypeError, ValueError):
        return len(items)


def _section(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    items = _items(raw.get("items"), _HIGH_KEYS)
    return {"count": _count(raw.get("count"), items), "items": items}


def _vi(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    items = _items(raw.get("items"), _VI_KEYS)
    return {"date": raw.get("date"), "updated_at": raw.get("updated_at"), "count": _count(raw.get("count"), items),
            "items": items}


def get_featured(redis=None, today: date | None = None) -> dict:
    """{date, highs:{count, items}, lows:{count, items}, vi:{date, updated_at, count, items}|null}. 목록은 상위 TOP_N."""
    r = redis if redis is not None else get_sync_redis()
    snap = featured_store.load_highs(r) or {}
    vi = featured_store.load_vi(r, today or now_kst().date())
    return {"date": snap.get("date"), "highs": _section(snap.get("highs")), "lows": _section(snap.get("lows")),
            "vi": _vi(vi)}

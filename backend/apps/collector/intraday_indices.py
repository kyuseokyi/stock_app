"""장중 주요 지수 30초 갱신(A안) — KIS REST 로 오늘 진행 중인 값을 받아 Redis 에 둔다.

- 대상: KOSPI·KOSDAQ·KOSPI200·원/달러(INTRADAY_CODES). 미국 지수는 한국 낮에 장이 닫혀 있어 제외.
- 조회: 기존 일별 TR(국내 FHKUP03500100 시장 코드 U, 환율 FHKST03030100 X)을 오늘 하루 범위로 불러 오늘 봉의 현재값.
  지수 TR 은 종목 시세가 아니라 UN→J 폴백 규칙 대상이 아니다(기존 일별 수집과 같은 U).
- 저장: Redis market:intraday = {code: {"value", "date", "ts"}} (TTL 10분). ClickHouse 에는 쓰지 않는다 —
  장중 값이 확정 종가 이력을 오염시키지 않게(15:40 확정 수집이 실패해도 장중 마지막 값이 종가로 남지 않음).
설계 docs/superpowers/specs/2026-10-20-intraday-index-design.md
"""
from __future__ import annotations

import json
import logging
import math
import os
import time as _time
from datetime import date, datetime, time, timedelta, timezone

from apps.collector.market_indices import IndexSpec, _fetch, index_specs
from shared import market_calendar

log = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
INTRADAY_KEY = "market:intraday"
INTRADAY_TTL = 600  # 10분 — 수집이 멈추면 값이 저절로 사라져 확정 종가로 돌아간다
INTRADAY_FUTURE_SKEW = 60  # 컨테이너 간 시계 차이로 막 쓴 값이 미래로 보여도 이만큼(초)은 남긴다
# 중복 실행 잠금 — KIS 장애로 한 실행이 길어져도 30초마다 새 실행이 쌓여 워커를 다 차지하지 않게.
# 만료는 태스크 time_limit(50초)보다 길어야 한다(강제 종료돼 해제를 못 해도 곧 풀림)
INTRADAY_LOCK_KEY = "market:intraday:lock"
INTRADAY_LOCK_TTL = 60
# 이 기능 전용 장 시간(09:00 ≤ t < 15:35). 게임 TRADING_WINDOWS(애프터마켓 포함)와 목적이 달라 공유하지 않는다
INTRADAY_WINDOW = (time(9, 0), time(15, 35))
INTRADAY_CODES = ("KR:0001", "KR:1001", "KR:2001", "FX:USDKRW")
# 이 태스크 전용 초당 상한 — 4건이 2초에 나뉜다(KIS 실전 20 TPS·우리 상한 15 TPS 의 1% 미만).
# 장중에 REST 를 대량으로 쓰는 작업이 새로 생기면 그 작업과 초당 상한을 나눠 써야 한다.
INTRADAY_RATE = 2.0
_OFF = ("false", "0", "no", "off")


def enabled() -> bool:
    """INTRADAY_INDICES_ENABLED — 기본 켜짐, false/0/no/off 면 꺼짐."""
    return (os.getenv("INTRADAY_INDICES_ENABLED") or "true").strip().lower() not in _OFF


def now_kst() -> datetime:
    return datetime.now(KST)


def _to_kst(now: datetime) -> datetime:
    """aware 시각을 KST 로 변환. naive 는 시간대를 알 수 없어 ValueError."""
    if now.tzinfo is None:
        raise ValueError("now 는 시간대가 있는 datetime 이어야 한다(naive 불가)")
    return now.astimezone(KST)


def in_intraday_window(now: datetime) -> bool:
    """KST 거래일(주말·공휴일·KRX 연말 휴장·수동 휴장 제외)이고 09:00 ≤ 시각 < 15:35. now 는 aware(UTC 등 가능)."""
    now = _to_kst(now)
    if not market_calendar.is_trading_day(now.date()):
        return False
    start, end = INTRADAY_WINDOW
    return start <= now.time() < end


def intraday_specs() -> list[IndexSpec]:
    """기존 지수 목록에서 장중 대상만(환율은 region=US 라 코드로 고른다). 순서는 INTRADAY_CODES."""
    by_code = {s.code: s for s in index_specs()}
    return [by_code[c] for c in INTRADAY_CODES if c in by_code]


def today_value(rows: list[dict], today: date) -> float | None:
    """파싱된 일봉 중 오늘 날짜 봉의 현재값(close). 없으면 None — 장중에 오늘 봉을 주지 않는 TR 이면 여기서 걸린다."""
    for r in rows:
        if r["date"] == today:
            return float(r["close"])
    return None


def fetch_today(spec: IndexSpec, client, today: date) -> float | None:
    """기존 일별 조회(_fetch)를 오늘 하루 범위로 불러 오늘 봉의 현재값."""
    return today_value(_fetch(spec, client, today, today), today)


def merge_intraday(prev: dict, fresh: dict, now_ts: float) -> dict:
    """이전 값 + 새 값. 이번에 실패한 코드는 이전 값을 유지하되, INTRADAY_TTL 보다 오래된 항목은 버린다
    (키 하나에 합쳐 저장하므로 다른 코드가 성공할 때마다 TTL 이 늘어나 낡은 값이 영원히 남지 않게)."""
    kept = {}
    for code, item in prev.items():
        try:
            if -INTRADAY_FUTURE_SKEW <= now_ts - float(item["ts"]) <= INTRADAY_TTL:  # 여유보다 더 미래인 ts(시계 역행)는 버린다
                kept[code] = item
        except (KeyError, TypeError, ValueError):
            continue  # 형식이 깨진 항목은 버린다
    return {**kept, **fresh}


def load_intraday(redis, now_ts: float | None = None) -> dict:
    """Redis 장중 값 — 없거나 JSON 이 깨졌으면 빈 dict. 읽을 때도 INTRADAY_TTL 보다 오래된 항목은 거른다
    (키 TTL 은 쓸 때마다 늘어나므로 일부 코드만 성공하면 낡은 값이 최대 약 2배 남을 수 있다).
    (Redis 연결 오류는 호출한 쪽이 처리)"""
    raw = redis.get(INTRADAY_KEY)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    return merge_intraday(data, {}, _time.time() if now_ts is None else now_ts)


def valid_value(value) -> float | None:
    """유한한 양수만 값으로 인정. None·변환 실패·NaN·inf·0 이하는 None(= 실패)."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and v > 0 else None


def poll(client, redis, now: datetime, fetch=None) -> dict:
    """대상마다 오늘 값 조회 → 성공한 것만 이전 값과 병합해 저장(TTL 10분). 전부 실패하면 Redis 를 건드리지 않는다.

    fetch(spec, client, today) -> float | None — 기본 fetch_today. 조회 TR 을 바꿀 때 이것만 바꿔 끼운다.
    """
    fetch = fetch or fetch_today
    now = _to_kst(now)
    today, ts = now.date(), now.timestamp()
    fresh: dict[str, dict] = {}
    failed: list[str] = []
    for spec in intraday_specs():
        try:
            value = valid_value(fetch(spec, client, today))
        except Exception as e:  # noqa: BLE001 — 코드 하나 실패가 나머지를 막지 않게
            log.warning("장중 지수 조회 실패 %s(%s): %s", spec.code, spec.name, str(e)[:160])
            value = None
        if value is None:
            failed.append(spec.code)
            continue
        fresh[spec.code] = {"value": value, "date": today.isoformat(), "ts": int(ts)}
    if not fresh:
        log.warning("장중 지수 전부 실패 — Redis 는 그대로(10분 뒤 확정 종가로 돌아감): %s", failed)
        return {"ok": [], "failed": failed}
    merged = merge_intraday(load_intraday(redis, ts), fresh, ts)
    redis.set(INTRADAY_KEY, json.dumps(merged, allow_nan=False), ex=INTRADAY_TTL)
    return {"ok": sorted(fresh), "failed": failed}

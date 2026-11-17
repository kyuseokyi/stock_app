"""키움 VI(변동성완화장치) 발동 종목 장중 수집 — ka10054 (키움 연동 ④-4, 오늘 특징주 카드).

- 거래일 09:00~15:30(KST) 5분마다(beat) 오늘 발동 목록을 받아 종목별로 묶어 Redis `market:vi:{YYYYMMDD}` 에 둔다.
  같은 종목 여러 행(발동마다·KRX/NXT)은 가장 최근 발동 시각의 행 + 발동 횟수 최댓값(없으면 행 수)으로 합친다.
  응답이 누적 목록이든 최근 것만이든 안전하게 — 이전 스냅숏과 병합한다(이번에 없던 종목도 남김).
- 실패: 그날 연속 실패 MAX_FAILS 회면 그날 남은 호출을 중단(헛호출 방지). 성공하면 연속 실패 수를 0 으로.
  8010(등록 IP 밖)은 다시 해도 안 되므로 바로 중단. 실패해도 지난 스냅숏은 그대로 둔다.
- 호출량: 하루 79회(09:00~15:30, 5분) + 연속조회 쪽수. 초당 상한은 KiwoomClient RateLimiter.
설계 docs/superpowers/specs/2026-11-17-featured-stocks-design.md
"""
from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone
from typing import Callable

from apps.collector.kiwoom.client import KiwoomIpError, KiwoomNotConfigured
from apps.collector.kiwoom.normalize import vi_row
from shared import featured_store, market_calendar

log = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
VI_WINDOW = (time(9, 0), time(15, 30))  # 양 끝 포함 — 15:30 실행까지
MAX_FAILS = 3
HALTED = "연속 실패로 오늘 VI 수집 중단"
NOT_CONFIGURED = "키움 키 없음"


def in_vi_window(now: datetime) -> bool:
    """KST 거래일(주말·공휴일·휴장 제외)이고 09:00 ≤ 시각 ≤ 15:30. now 는 시간대가 있어야 한다."""
    if now.tzinfo is None:
        raise ValueError("now 는 시간대가 있는 datetime 이어야 한다(naive 불가)")
    now = now.astimezone(KST)
    if not market_calendar.is_trading_day(now.date()):
        return False
    start, end = VI_WINDOW
    return start <= now.time().replace(second=0, microsecond=0) <= end


def _newer(a: dict, b: dict) -> dict:
    """발동 시각이 더 늦은 쪽(같으면 b — 새 값)."""
    return a if a.get("time", "") > b.get("time", "") else b


def aggregate(rows: list[dict | None]) -> dict[str, dict]:
    """정규화된 행 → {ticker: 최근 발동 행 + count}. count = 발동 횟수 최댓값, 0 이면 행 수."""
    out: dict[str, dict] = {}
    n_rows: dict[str, int] = {}
    for r in rows:
        if r is None:
            continue
        t = r["ticker"]
        n_rows[t] = n_rows.get(t, 0) + 1
        prev = out.get(t)
        best = r if prev is None else _newer(prev, r)
        out[t] = {**best, "count": max(r.get("count", 0), prev.get("count", 0) if prev else 0)}
    for t, item in out.items():
        if not item["count"]:
            item["count"] = n_rows[t]
    return out


def merge(prev: dict[str, dict], fresh: dict[str, dict]) -> dict[str, dict]:
    """이전 스냅숏 + 이번 집계. 종목마다 최근 발동 행, 횟수는 큰 쪽."""
    out = dict(prev)
    for t, item in fresh.items():
        old = out.get(t)
        if old is None:
            out[t] = item
            continue
        out[t] = {**_newer(old, item), "count": max(int(old.get("count") or 0), int(item.get("count") or 0))}
    return out


def _fail(redis, day, msg: str, *, halt_now: bool = False) -> dict:
    n = featured_store.vi_record_failure(redis, day)
    if halt_now or n >= MAX_FAILS:
        featured_store.vi_halt(redis, day, msg)
        log.warning("[VI] %s — 오늘 남은 호출 중단(연속 실패 %d)", msg, n)
    else:
        log.warning("[VI] %s (연속 실패 %d/%d)", msg, n, MAX_FAILS)
    return {"error": msg[:300], "fails": n}


def poll(*, client_factory: Callable[[], object], redis, now: datetime) -> dict:
    """한 번 수집 → 병합 저장. 결과 dict(로그용). 중단된 날이면 클라이언트를 만들지 않는다."""
    now = now.astimezone(KST)
    day = now.date()
    if featured_store.vi_halted(redis, day):
        return {"skipped": HALTED}
    try:
        client = client_factory()
    except KiwoomNotConfigured:
        return {"skipped": NOT_CONFIGURED}
    try:
        raw = client.vi_stocks()
    except KiwoomIpError as e:
        return _fail(redis, day, f"키움 호출 불가: {e}", halt_now=True)
    except Exception as e:  # noqa: BLE001 — 한 번 실패는 다음 5분에 다시
        return _fail(redis, day, f"ka10054 실패: {e!r}")
    finally:
        close = getattr(client, "close", None)
        if close is not None:
            close()

    prev = featured_store.load_vi(redis, day) or {}
    prev_items = {x["ticker"]: x for x in prev.get("items") or [] if isinstance(x, dict) and x.get("ticker")}
    merged = merge(prev_items, aggregate([vi_row(r) for r in raw]))
    items = sorted(merged.values(), key=lambda x: (x.get("time", ""), x["ticker"]), reverse=True)
    featured_store.save_vi(redis, day, {"date": day.isoformat(), "updated_at": now.isoformat(),
                                        "count": len(items), "items": items})
    featured_store.vi_reset_failures(redis, day)
    return {"rows": len(raw), "stocks": len(items)}

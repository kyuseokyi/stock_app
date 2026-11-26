"""급등락·테마 분석 — 한 거래일 집계 실행(입출력은 Deps 로 주입 → 가짜로 시험 가능).

순서: 기준일·직전 거래일 결정 → 일봉 확정 확인(종목 수 < min_rows 면 건너뜀) → 종목 행·분류
→ 테마 묶음·대표 테마(테마 조회 실패면 묶음 없이) → 대상 종목 공시(종목별 실패 격리) → 저장(날짜 단위 교체).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Callable

from apps.collector.daily_surge import compute as C

log = logging.getLogger(__name__)

MIN_ROWS = 1000  # 기준일·직전 거래일 일봉이 이보다 적으면 수집이 덜 끝난 것으로 본다
MIN_RATIO = 0.9  # 기준일 종목 수가 직전 거래일의 이 비율 미만이면 부분 적재로 본다
DART_MAX_CONSECUTIVE_FAIL = 5  # 공시 조회가 연속으로 이만큼 실패하면 남은 종목은 부르지 않는다(이전 공시 유지)


@dataclass
class Deps:
    latest_date: Callable[[], date | None]
    prev_date: Callable[[date], date | None]
    load_day: Callable[[date], dict[str, tuple[float, float]]]
    load_prev: Callable[[date], dict[str, tuple[float, float, date]]]  # 종목별 기준일 전 마지막 일봉
    profiles: Callable[[], dict[str, tuple[str, bool]]]
    sectors: Callable[[], dict[str, str]]  # {ticker: 업종 이름}(KIS 마스터)
    names: Callable[[list[str]], dict[str, str]]
    themes: Callable[[], tuple[dict[int, tuple[str, list[str]]], str]]
    dart: Callable[[str, date, date], list[tuple[str, str, str]]] | None  # None = DART 키 없음
    store: Callable[[date, list[dict], list[dict], str], int]
    # 주 출처가 키움일 때 소속 테마가 없는 종목에 채울 KIS 테마(주 출처가 KIS 면 빈 dict)
    fallback_themes: Callable[[], dict[int, tuple[str, list[str]]]] = lambda: {}  # noqa: E731


def _as_date(value: date | str | None) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def run_day(trade_date: date | str | None, deps: Deps, *, min_rows: int = MIN_ROWS,
            top_n: int = C.TOP_VALUE_N) -> dict:
    t = _as_date(trade_date) or deps.latest_date()
    if t is None:
        return {"skipped": "일봉 없음"}
    p = deps.prev_date(t)
    if p is None:
        return {"skipped": f"직전 거래일 없음({t.isoformat()})"}
    today = deps.load_day(t)
    last = deps.load_prev(t)
    n_prev = sum(1 for v in last.values() if v[2] == p)
    if n_prev < min_rows:
        return {"skipped": f"직전 거래일 일봉 부족({p.isoformat()} {n_prev}종목)"}
    if len(today) < min_rows or len(today) < MIN_RATIO * n_prev:
        return {"skipped": f"일봉 미확정({t.isoformat()} {len(today)}종목 / 직전 {n_prev}종목)"}
    prev = {tk: (c, v) for tk, (c, v, _d) in last.items()}

    profiles = deps.profiles()
    if len(profiles) < min_rows:
        # 종목 프로필(PG stock_profile)이 비면 보통주 판정이 모두 실패해 '0개 저장'으로 조용히 끝난다 — 이유를 남긴다
        return {"skipped": f"종목 프로필 없음({len(profiles)}종목) — 종목 마스터 동기화 필요"}
    names = deps.names(sorted(today))
    rows = C.classify(C.build_rows(today, prev, profiles, names), top_n=top_n)

    out: dict = {"date": t.isoformat(), "prev_date": p.isoformat()}
    themes: dict = {}
    try:
        themes, source = deps.themes()
        groups = C.theme_groups(rows, themes)
    except Exception as e:  # noqa: BLE001 — 테마가 없어도 종목 결과는 저장한다
        log.exception("급등락 분석: 테마 조회 실패")
        themes, groups, source = {}, [], "none"
        out["theme_error"] = repr(e)[:200]
    C.assign_primary(rows, groups)

    picked = C.targets(rows)
    C.stock_theme_lists(picked, themes, groups, source=source)
    try:
        out["theme_fallback"] = C.fill_fallback_themes(rows, picked, deps.fallback_themes())
    except Exception:  # noqa: BLE001 — 보충은 보조 정보
        log.exception("급등락 분석: 보충 테마(KIS) 조회 실패")
    try:
        sectors = deps.sectors()
    except Exception:  # noqa: BLE001 — 업종 이름은 보조 정보
        log.exception("급등락 분석: 업종 조회 실패")
        sectors = {}
    for r in picked:
        r["sector_name"] = sectors.get(r["ticker"]) or None
    dart_failed = streak = 0
    for r in picked:
        r["dart_items"], r["dart_keywords"] = [], []
        if deps.dart is None:
            continue
        if streak >= DART_MAX_CONSECUTIVE_FAIL:
            r["dart_items"] = r["dart_keywords"] = None  # 저장 때 이전 공시 유지
            dart_failed += 1
            continue
        try:
            disclosures = deps.dart(r["ticker"], p, t)
        except Exception:  # noqa: BLE001 — 한 종목 실패가 전체를 막지 않게(공시 없음과 구분해 이전 값 유지)
            r["dart_items"] = r["dart_keywords"] = None
            dart_failed += 1
            streak += 1
            continue
        streak = 0
        r["dart_items"] = C.dart_items(disclosures, t)
        r["dart_keywords"] = C.dart_keywords([d[2] for d in disclosures])
    if deps.dart is None:
        out["dart"] = "키 없음"

    saved = deps.store(t, picked, groups, source)
    out.update({
        "theme_source": source,
        "saved": saved,
        "surge": sum(1 for r in picked if r["is_surge"]),
        "plunge": sum(1 for r in picked if r["is_plunge"]),
        "top_value": sum(1 for r in picked if r["is_top_value"]),
        "groups": len(groups),
        "dart_failed": dart_failed,
    })
    return out

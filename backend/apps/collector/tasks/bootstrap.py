"""초기 데이터 준비(부트스트랩) — 새 서버에서 수집(1~7) → 계산(8~11)을 정해진 순서대로 한 번에.

설계: docs/superpowers/specs/2026-10-22-data-bootstrap-design.md
- 단계는 기존 태스크 함수를 직접(동기) 부른다. 각 단계는 이미 멱등이라 다시 실행해도 안전하다.
- 판정은 일일 파이프라인과 같다(예외 또는 결과 dict 의 error 키 → 실패). 일봉 백필만 추가로 성공 0종목도 실패로 본다
  (KIS 키 오류 등으로 전 종목이 실패하면 예외 없이 끝나는데, 그 위에서 계산하면 빈 결과만 '성공'으로 남는다).
- 일봉 백필이 실패하면 뒤 단계는 모두 skipped(일봉 없이는 계산 무의미). 나머지 단계 실패는 다음 단계로 진행.
- 시간대: 시작 시 KST [18:00, 21:30) 이면 아무것도 하지 않는다. KIS 단계(1~7) 직전 [20:00, 21:30) 이면
  그 단계부터 끝까지 skipped(20:30 정기 수집과 KIS 호출 한도를 나눠 쓰지 않게 — 다시 누르면 이어서 채워진다).
- 진행 상황은 Redis admin:bootstrap:progress 에 단계 시작·끝마다 덮어쓴다(관리자 화면). 기록 실패는 무시.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, time as dtime, timezone
from typing import Callable

from apps.collector import trading_day
from apps.collector.celery_app import celery_app
from apps.collector.tasks.canslim import backfill_canslim
from apps.collector.tasks.market_data import (
    collect_fundamentals,
    collect_investor_daily,
    collect_ipo_events,
    collect_macro_series,
    collect_market_indices,
)
from apps.collector.tasks.market_groups import backfill_market_groups
from apps.collector.tasks.patterns import compute_patterns
from apps.collector.tasks.screener import backfill_screener
from apps.collector.tasks.universe import backfill_all_daily
from shared import pipeline_record
from shared.sync_redis import get_sync_redis

log = logging.getLogger(__name__)

PROGRESS_KEY = "admin:bootstrap:progress"
PROGRESS_TTL = 30 * 24 * 3600  # 끝난 뒤에도 마지막 결과를 화면에 남긴다
BACKFILL_DAYS = 60
START_BLOCK = (dtime(18, 0), dtime(21, 30))  # 시작 차단(반열린 구간)
KIS_BLOCK = (dtime(20, 0), dtime(21, 30))  # 진행 중 KIS 단계 차단
START_BLOCKED_MSG = "18:00~21:30 에는 정기 수집과 겹쳐 실행할 수 없어요"
KIS_BLOCKED_MSG = "20:00~21:30 정기 수집 시간이라 KIS 단계를 멈췄어요 — 다시 실행하면 이어서 채워져요"
DAILY_FAILED_MSG = "일봉 백필 실패 — 일봉 없이는 계산할 수 없어요"

# (키, 라벨, KIS 단계 여부) — 순서 고정
STEPS: tuple[tuple[str, str, bool], ...] = (
    ("daily_backfill", "전종목 일봉 백필", True),
    ("indices_kr", "국내 지수", True),
    ("indices_us", "미국 지수·환율", True),
    ("investor", "투자자별 순매수", True),
    ("fundamentals", "재무(연간·분기)", True),
    ("ipo", "공모주 일정", True),
    ("macro", "거시 지표(FRED)", True),
    ("canslim", "CANSLIM 60일 백필", False),
    ("market_groups", "시장 그룹 60일 백필", False),
    ("screener", "조건검색 60일 백필", False),
    ("patterns", "차트 패턴", False),
)


def _in_window(now: datetime, window: tuple[dtime, dtime]) -> bool:
    t = trading_day.to_kst(now).time()
    return window[0] <= t < window[1]


def _runners(months: int, end: str) -> dict[str, Callable[[], object]]:
    # 호출 시점에 이름을 찾는 lambda — 테스트의 monkeypatch 가 먹히게
    return {
        "daily_backfill": lambda: backfill_all_daily(months=months, end=end),
        "indices_kr": lambda: collect_market_indices("KR"),
        "indices_us": lambda: collect_market_indices("US"),
        "investor": lambda: collect_investor_daily(),
        "fundamentals": lambda: collect_fundamentals(),
        "ipo": lambda: collect_ipo_events(),
        "macro": lambda: collect_macro_series(),
        "canslim": lambda: backfill_canslim(days=BACKFILL_DAYS),
        "market_groups": lambda: backfill_market_groups(days=BACKFILL_DAYS),
        "screener": lambda: backfill_screener(days=BACKFILL_DAYS),
        "patterns": lambda: compute_patterns(),
    }


def _failed(key: str, result) -> bool:
    if isinstance(result, dict) and "error" in result:
        return True
    # 일봉 백필은 성공 0종목이면 실패(예외 없이 전 종목 실패한 경우)
    return key == "daily_backfill" and isinstance(result, dict) and not result.get("ok")


def _save(progress: dict) -> None:
    try:
        get_sync_redis().set(PROGRESS_KEY, json.dumps(progress, ensure_ascii=False, default=str), ex=PROGRESS_TTL)
    except Exception as exc:  # noqa: BLE001 — 진행 기록 실패가 작업을 막지 않게
        log.warning("부트스트랩 진행 기록 실패: %s", exc)


def _iso(now: datetime) -> str:
    return trading_day.to_kst(now).astimezone(timezone.utc).isoformat(timespec="seconds")


def run_bootstrap(months: int = 37, task_id: str | None = None,
                  now_fn: Callable[[], datetime] = trading_day.now_kst) -> dict:
    started = now_fn()
    steps = [{"key": k, "label": label, "state": "pending", "seconds": None, "summary": None, "reason": None}
             for k, label, _ in STEPS]
    progress = {"task_id": task_id, "started_at": _iso(started), "finished_at": None, "months": int(months),
                "end_date": None, "skipped": None, "steps": steps}

    if _in_window(started, START_BLOCK):
        for s in steps:
            s.update(state="skipped", reason=START_BLOCKED_MSG)
        progress.update(finished_at=_iso(started), skipped=START_BLOCKED_MSG)
        _save(progress)
        log.info("부트스트랩 시작 차단: %s", START_BLOCKED_MSG)
        return {"skipped": START_BLOCKED_MSG}

    end = trading_day.last_confirmed_trading_day(started)
    progress["end_date"] = end.isoformat()
    _save(progress)
    runners = _runners(int(months), end.strftime("%Y%m%d"))
    results: dict = {}
    stop_reason: str | None = None
    for s, (key, _label, uses_kis) in zip(steps, STEPS):
        if stop_reason is None and uses_kis and _in_window(now_fn(), KIS_BLOCK):
            stop_reason = KIS_BLOCKED_MSG
        if stop_reason is not None:
            s.update(state="skipped", reason=stop_reason)
            results[key] = {"skipped": stop_reason}
            continue
        s["state"] = "running"
        _save(progress)
        t0 = time.monotonic()
        try:
            result = runners[key]()
        except Exception as e:  # noqa: BLE001 — 단계 실패 격리
            log.exception("부트스트랩 단계 실패: %s", key)
            result = {"error": repr(e)[:300]}
        results[key] = result
        failed = _failed(key, result)
        s.update(state="failed" if failed else "ok", seconds=round(time.monotonic() - t0, 1),
                 summary=pipeline_record.summarize(result))
        if failed and key == "daily_backfill":
            stop_reason = DAILY_FAILED_MSG
        _save(progress)
    progress["finished_at"] = _iso(now_fn())
    _save(progress)
    states = {s["key"]: s["state"] for s in steps}
    log.info("부트스트랩 종료: %s", states)
    return {"states": states, "months": int(months), "end_date": end.isoformat(),
            "results": {k: pipeline_record.summarize(v) for k, v in results.items()}}


@celery_app.task(name="collector.bootstrap_data", bind=True)
def bootstrap_data(self, months: int = 37) -> dict:
    """초기 데이터 준비 — 관리자 '초기 데이터 준비' 버튼(admin_jobs 'bootstrap'). 1~2시간."""
    return run_bootstrap(months, task_id=getattr(self.request, "id", None))

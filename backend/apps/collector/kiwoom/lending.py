"""종목별 대차잔고 추이 수집 — 키움 ka20068 대차거래추이요청(종목별) (키움 연동 ④-1).

- 조회: `KiwoomClient.get_lending_trend(ticker, start, end)` — 종목코드는 접미사 없이 6자리(명세 stk_cd length 6).
  응답 행을 `normalize.lending_row` 로 바꾸고 [start, end] 로 잘라 날짜 오름차순·날짜당 1행으로 돌려준다.
- 실행 루프(`run_lending`): 키움 클라이언트 1개로 순차 호출(초당 상한은 클라이언트 RateLimiter `KIWOOM_RATE_PER_SEC`).
  KIS `_run_universe`(스레드마다 KISClient·쿨다운 2차 패스)를 쓰지 않는다.
  · 8010(등록 IP 밖)·키 미설정 → 경고 1회, 나머지를 부르지 않고 `skipped`.
  · 첫 종목에서 키움 논리 오류(rt — 시간 제한 등) → 나머지를 부르지 않고 `error`(연기금 15:40 사례처럼 헛호출 방지).
  · 그 뒤 종목의 오류는 그 종목만 실패로 세고 계속. 0행은 오류가 아니다(대차 거래가 없는 종목).
설계: docs/superpowers/specs/2026-11-16-kiwoom-lending-design.md
"""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Callable, Iterable

from apps.collector.kiwoom.client import KiwoomApiError, KiwoomCircuitOpen, KiwoomIpError, KiwoomNotConfigured
from apps.collector.kiwoom.normalize import lending_row

logger = logging.getLogger(__name__)

# 연속조회 상한 — 60거래일 백필도 보통 1~2쪽이면 끝난다(쪽당 행 수는 명세에 없음 — probe 로 확인).
MAX_PAGES = 10
_FAILED_SAMPLE = 20  # 결과에 남기는 실패 종목 예시 수(기록 크기 제한)


def _ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


def calendar_start(end: date, trading_days: int) -> date:
    """거래일 수 → 조회 시작일(달력일 근사). 주말·연휴를 감안해 거래일 × 7/5 + 4일 앞으로.

    예: 5거래일 → 11일 전(설 연휴가 끼어도 5거래일 이상), 60거래일 → 88일 전. 겹쳐 받아도 멱등이라 넉넉히 잡는다.
    """
    n = max(1, int(trading_days))
    return end - timedelta(days=n * 7 // 5 + 4)


def fetch_lending(client, ticker: str, start: date, end: date, *, max_pages: int = MAX_PAGES) -> list[dict]:
    """키움 대차 추이를 [start, end] 로 잘라 날짜 오름차순 행으로. client: KiwoomClient(또는 같은 get_lending_trend)."""
    raw_rows = client.get_lending_trend(ticker, _ymd(start), _ymd(end), max_pages=max_pages)
    by_date: dict[date, dict] = {}
    for raw in raw_rows:
        row = lending_row(raw)
        if row is None or not (start <= row["date"] <= end):
            continue
        by_date.setdefault(row["date"], row)  # 같은 날짜는 먼저(최신 쪽) 받은 행
    return [by_date[d] for d in sorted(by_date)]


def run_lending(tickers: Iterable[str], start: date, end: date, *, client_factory: Callable[[], object],
                store: Callable[[str, list[dict]], int], max_pages: int = MAX_PAGES) -> dict:
    """tickers 의 대차 추이를 차례로 받아 store(ticker, rows) 로 적재. 결과 dict(파이프라인 기록용)."""
    targets = list(dict.fromkeys(tickers))
    if not targets:
        return {"total": 0, "ok": 0, "inserted": 0, "failed_count": 0, "start": start.isoformat(),
                "end": end.isoformat()}
    try:
        client = client_factory()
    except KiwoomNotConfigured as e:
        logger.warning("[키움 대차] %s — 건너뜀", e)
        return {"skipped": "키움 키 없음"}

    started = time.monotonic()
    ok = inserted = 0
    failed: list[dict] = []
    stop: dict | None = None
    try:
        for i, ticker in enumerate(targets):
            try:
                rows = fetch_lending(client, ticker, start, end, max_pages=max_pages)
                inserted += store(ticker, rows)
                ok += 1
            except (KiwoomCircuitOpen, KiwoomIpError, KiwoomNotConfigured) as e:
                logger.warning("[키움 대차] %s — 이번 실행의 대차 수집을 멈춥니다", e)
                stop = {"skipped": f"키움 호출 불가: {e}"}
                break
            except KiwoomApiError as e:
                if i == 0:
                    logger.warning("[키움 대차] 첫 종목 %s 키움 오류 — 나머지 호출 중단: %s", ticker, e)
                    stop = {"error": f"첫 종목 키움 오류 code={e.code} msg={e.msg} — 나머지 호출 중단"}
                    break
                failed.append({"ticker": ticker, "error": f"code={e.code} {e.msg}"[:160]})
            except Exception as e:  # noqa: BLE001 — 그 종목만 실패, 나머지 계속
                failed.append({"ticker": ticker, "error": repr(e)[:160]})
    finally:
        close = getattr(client, "close", None)
        if close is not None:
            close()

    elapsed = round(time.monotonic() - started, 1)
    logger.info("[키움 대차] 성공 %d/%d, 실패 %d, 적재 %d행, %.0f초", ok, len(targets), len(failed), inserted, elapsed)
    out = {"total": len(targets), "ok": ok, "inserted": inserted, "failed_count": len(failed),
           "failed": failed[:_FAILED_SAMPLE], "elapsed_sec": elapsed, "start": start.isoformat(),
           "end": end.isoformat()}
    if stop is not None:
        out = {**stop, **{k: out[k] for k in ("total", "ok", "inserted", "start", "end")}}
    return out

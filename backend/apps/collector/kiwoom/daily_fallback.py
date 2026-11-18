"""전종목 일봉 수집의 키움 폴백 패스 (키움 연동 ③단계).

KIS 1·2차 패스(쿨다운·재시도 포함)가 다 끝난 뒤, 최종 실패 종목과 UN·J 모두 빈 응답이었던 종목만
키움 ka10081(`{ticker}_AL`)로 같은 기간을 받아 `source='kiwoom'` 으로 적재한다.
KIS 정상 경로의 동작·호출 횟수는 그대로다(폴백은 KIS 가 끝난 뒤에만 돈다).

- 켜짐: `get_kiwoom_config().is_configured` 이고 env `KIWOOM_FALLBACK_ENABLED` 가 false 가 아님(기본 켜짐).
  개발 서버는 키가 없어 자동으로 꺼진다 — 기존 동작 그대로.
- 대상이 없으면 키움 클라이언트를 만들지 않는다(토큰·Redis 무접촉). 있으면 실행당 1개만 만들어 순차로 쓴다
  (토큰은 Redis 캐시, 자체 RateLimiter `KIWOOM_RATE_PER_SEC`).
- 8010(등록 IP 밖)·미설정은 경고 1회 후 폴백을 끈다. 그 밖의 키움 오류는 그 종목만 실패로 세고 계속한다.
설계: docs/superpowers/specs/2026-11-16-kiwoom-daily-fallback-design.md
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Callable

from apps.collector.kiwoom.client import KiwoomCircuitOpen, KiwoomClient, KiwoomIpError, KiwoomNotConfigured
from shared.kiwoom_config import KiwoomConfig, get_kiwoom_config

logger = logging.getLogger(__name__)

_FALSY = frozenset({"false", "0", "no", "off"})


def fallback_enabled(cfg: KiwoomConfig | None = None) -> bool:
    """키움 키가 있고 KIWOOM_FALLBACK_ENABLED 가 끔(false/0/no/off)이 아니면 True. 실행 시점에 읽는다."""
    cfg = cfg or get_kiwoom_config()
    if not cfg.is_configured:
        return False
    return (os.getenv("KIWOOM_FALLBACK_ENABLED") or "").strip().lower() not in _FALSY


def _empty_stats() -> dict:
    return {"recovered": set(), "filled": 0, "failed": 0, "inserted": 0}


class DailyFallback:
    """한 번의 전종목 수집 실행에 붙는 키움 폴백.

    store(client, ticker) -> 적재 행수: 키움 조회 + MA 계산 + `source='kiwoom'` 적재(호출자가 기간을 정한다).
    """

    def __init__(self, store: Callable[[object, str], int], *, client_factory: Callable[[], object] = KiwoomClient,
                 ensure_column: Callable[[], None] | None = None):
        self._store = store
        self._client_factory = client_factory
        self._ensure_column = ensure_column
        self._lock = threading.Lock()
        self._empties: set[str] = set()
        self._disabled = False

    def note_empty(self, ticker: str) -> None:
        """KIS UN·J 모두 빈 응답(수집 결과 0행)인 종목 — KIS 스레드에서 부르므로 잠근다."""
        with self._lock:
            self._empties.add(ticker)

    def _disable(self, reason: Exception) -> None:
        self._disabled = True
        logger.warning("[키움 폴백] %s — 이번 실행의 키움 폴백을 끕니다", reason)

    def run(self, failed: list[dict]) -> dict:
        """최종 실패(failed dict 리스트) + 빈 응답 종목을 키움으로 채운다.

        반환: recovered(실패→회복 종목 set), filled(키움으로 채운 종목 수), failed(키움도 못 채운 종목 수),
        inserted(키움 적재 행수).
        """
        stats = _empty_stats()
        if self._disabled:
            return stats
        failed_tickers = list(dict.fromkeys(f["ticker"] for f in failed))
        failed_set = set(failed_tickers)
        with self._lock:
            empties = sorted(t for t in self._empties if t not in failed_set)
        targets = failed_tickers + empties
        if not targets:
            return stats

        try:
            client = self._client_factory()
        except KiwoomNotConfigured as e:
            self._disable(e)
            return stats
        logger.info("[키움 폴백] 대상 %d종목 (KIS 실패 %d, 빈 응답 %d)", len(targets), len(failed_tickers), len(empties))
        try:
            if self._ensure_column is not None:
                try:
                    self._ensure_column()  # 운영 CH 에 source 컬럼이 없으면 첫 키움 적재가 실패하므로 먼저 보장
                except Exception as e:  # noqa: BLE001 — 폴백 실패가 KIS 수집 결과를 막지 않게
                    self._disable(e)
                    return stats
            for ticker in targets:
                try:
                    inserted = self._store(client, ticker)
                except (KiwoomCircuitOpen, KiwoomIpError, KiwoomNotConfigured) as e:
                    stats["failed"] += 1
                    self._disable(e)
                    break
                except Exception as e:  # noqa: BLE001 — 그 종목만 실패, 나머지 계속
                    stats["failed"] += 1
                    logger.warning("[키움 폴백] %s 실패: %s", ticker, str(e)[:160])
                    continue
                if inserted > 0:
                    stats["filled"] += 1
                    stats["inserted"] += inserted
                    if ticker in failed_set:
                        stats["recovered"].add(ticker)
                elif ticker in failed_set:
                    stats["failed"] += 1  # 키움도 0행 — KIS 실패 그대로
        finally:
            close = getattr(client, "close", None)
            if close is not None:
                close()
        logger.info("[키움 폴백] 채움 %d종목(실패 회복 %d), 실패 %d", stats["filled"], len(stats["recovered"]),
                    stats["failed"])
        return stats

"""동기 레이트리미터 (KIS 초당 호출 제한 대응).

전종목 루프는 단일 Celery 워커 스레드에서 순차 실행되므로, 호출 간 최소 간격을
보장하는 단순 방식으로 충분하다. KIS 실전은 초당 ~20건 제한 → 보수적으로 기본 8건/초.
"""

from __future__ import annotations

import time


class RateLimiter:
    def __init__(self, per_sec: float):
        self._min_interval = 1.0 / per_sec if per_sec > 0 else 0.0
        self._last = 0.0

    def acquire(self) -> None:
        """직전 호출로부터 최소 간격이 지나도록 대기."""
        if self._min_interval <= 0:
            return
        wait = self._min_interval - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

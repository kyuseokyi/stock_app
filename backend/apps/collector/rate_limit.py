"""동기 레이트리미터 (KIS 초당 호출 제한 대응), 스레드 안전.

전종목 수집은 여러 스레드가 KIS 를 동시에 호출한다(universe._collect_pass). 리미터 하나를
모든 스레드의 KISClient 가 공유하고, HTTP 요청(재시도 포함)마다 acquire 해 전체 호출 간격을
보장한다. 슬롯 예약은 잠금 안에서, 대기는 잠금 밖에서 — 대기 중인 스레드가 서로를 막지 않는다.
KIS 실전 국내 시세 상한은 초당 ~20건.
"""

from __future__ import annotations

import threading
import time


class RateLimiter:
    def __init__(self, per_sec: float):
        self._min_interval = 1.0 / per_sec if per_sec > 0 else 0.0
        self._next = 0.0  # 다음 호출이 허용되는 시각(monotonic)
        self._lock = threading.Lock()

    def acquire(self) -> None:
        """다음 빈 슬롯을 예약하고 그 시각까지 대기."""
        if self._min_interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next)
            self._next = slot + self._min_interval
        wait = slot - now
        if wait > 0:
            time.sleep(wait)

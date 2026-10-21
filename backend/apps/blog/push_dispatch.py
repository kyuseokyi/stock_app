"""blog → collector 발송 위임(새 글 알림과 같은 방식). 위임 실패는 삼키고 로그만 — 이력에 sending 으로 남는다."""
from __future__ import annotations

import logging

from apps.collector.celery_app import celery_app

logger = logging.getLogger("blog.push_dispatch")


def dispatch_fund_notice(send_id: int) -> None:
    try:
        celery_app.send_task("collector.send_fund_notice", args=[send_id])
    except Exception as exc:  # noqa: BLE001
        logger.warning("펀드 알림 발송 위임 실패 (send_id=%s): %s", send_id, exc)

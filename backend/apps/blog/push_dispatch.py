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


def dispatch_test_push(user_id: int, title: str, body: str) -> bool:
    """관리자 테스트 알림 위임. 실패하면 False — 호출부가 관리자에게 바로 알린다(이력이 없어 삼키면 알 길이 없음)."""
    try:
        celery_app.send_task("collector.send_test_push", args=[user_id, title, body])
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("테스트 알림 발송 위임 실패 (user_id=%s): %s", user_id, exc)
        return False

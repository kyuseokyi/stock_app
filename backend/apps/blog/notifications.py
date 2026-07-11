"""블로그 → 워커 알림 위임 헬퍼.

새 글 작성 시 Celery 태스크를 태스크 이름으로 enqueue 한다. 블로그 서비스는
워커 태스크 구현에 의존하지 않으며(느슨한 결합), 브로커 장애가 나더라도
글 작성 자체는 실패하지 않도록 예외를 삼킨다.
"""

from __future__ import annotations

import logging

from apps.collector.celery_app import celery_app

logger = logging.getLogger("blog.notifications")


def notify_new_post(post_id: int) -> None:
    try:
        celery_app.send_task(
            "collector.send_new_post_notification", args=[post_id]
        )
    except Exception as exc:  # noqa: BLE001 - 알림 위임 실패가 글 작성을 막지 않도록
        logger.warning("새 글 알림 위임 실패 (post_id=%s): %s", post_id, exc)

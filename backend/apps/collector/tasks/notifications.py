"""푸시 알림 Celery 태스크.

새 글 등록 시 블로그 서비스가 위임하는 알림 발송 태스크.
대상: fcm_token 을 가진 활성 유저 중, 해당 게시판의 min_role_required 를 충족하는 유저.
"""

from __future__ import annotations

import logging

from sqlalchemy import select

from shared.database import SyncSessionLocal
from shared.models import Board, BlogPost, User, UserRole

from ..celery_app import celery_app
from ..push import PushMessage, get_push_sender

logger = logging.getLogger("tasks.notifications")

# 권한 서열 (값이 클수록 상위 권한)
_ROLE_LEVEL = {UserRole.FREE: 0, UserRole.PREMIUM: 1, UserRole.ADMIN: 2}


@celery_app.task(name="collector.send_new_post_notification")
def send_new_post_notification(post_id: int) -> dict:
    """새 글 알림을 대상 유저에게 발송한다. 결과 요약을 반환."""
    with SyncSessionLocal() as db:
        post = db.get(BlogPost, post_id)
        if post is None:
            logger.warning("send_new_post_notification: post %s 없음", post_id)
            return {"post_id": post_id, "status": "post_not_found", "sent": 0}

        board = db.get(Board, post.board_id)
        required_level = _ROLE_LEVEL.get(
            board.min_role_required if board else UserRole.FREE, 0
        )

        # fcm_token 보유 + 활성 유저 조회 후 권한 레벨로 필터
        users = (
            db.execute(
                select(User).where(
                    User.fcm_token.is_not(None), User.is_active.is_(True)
                )
            )
            .scalars()
            .all()
        )
        tokens = [
            u.fcm_token
            for u in users
            if _ROLE_LEVEL.get(u.role, 0) >= required_level
        ]

    board_name = board.name if board else ""
    message = PushMessage(
        title=f"[{board_name}] 새 글이 등록되었습니다",
        body=post.title,
        data={"type": "new_post", "post_id": post_id, "board_id": post.board_id},
    )

    sender = get_push_sender()
    sent = sender.send_multicast(tokens, message)
    logger.info(
        "send_new_post_notification: post=%s recipients=%s sent=%s",
        post_id,
        len(tokens),
        sent,
    )
    return {
        "post_id": post_id,
        "status": "ok",
        "recipients": len(tokens),
        "sent": sent,
    }

"""새 글 푸시 알림 Celery 태스크(blog 가 글 작성 시 notify=true 일 때만 위임).

대상: push_devices ⨝ users — 활성 사용자이고, 역할 등급이 게시판 min_role_required 이상이며,
기기의 post_notice 가 켜진 토큰. users.fcm_token 은 더 이상 읽지 않는다(컬럼은 유지).
발송 이력(push_sends)은 남기지 않고 로그와 반환 dict 로만 결과를 남긴다.
"""

from __future__ import annotations

import logging

from sqlalchemy import delete, select

from shared.database import SyncSessionLocal
from shared.models import Board, BlogPost, PushDevice, User, UserRole

from ..celery_app import celery_app
from ..push import PushMessage, get_push_sender
from ..push.base import BatchResult

logger = logging.getLogger("tasks.notifications")

NEW_POST_CHANNEL_ID = "blog-post"  # 앱 handlers-core.POST_CHANNEL_ID 와 같은 값

# 권한 서열 (값이 클수록 상위 권한)
_ROLE_LEVEL = {UserRole.FREE: 0, UserRole.PREMIUM: 1, UserRole.ADMIN: 2}


@celery_app.task(name="collector.send_new_post_notification")
def send_new_post_notification(post_id: int) -> dict:
    """새 글 알림을 대상 기기에 발송한다. 예외는 로그 후 삼킨다(재시도로 인한 중복 발송 방지)."""
    try:
        return _run(post_id)
    except Exception:  # noqa: BLE001
        logger.exception("send_new_post_notification: 처리 중 예외(post_id=%s)", post_id)
        return {"post_id": post_id, "status": "failed"}


def _run(post_id: int) -> dict:
    with SyncSessionLocal() as db:
        post = db.get(BlogPost, post_id)
        if post is None:
            logger.warning("send_new_post_notification: post %s 없음", post_id)
            return {"post_id": post_id, "status": "post_not_found", "recipients": 0,
                    "success": 0, "failure": 0, "invalid": 0}
        board = db.get(Board, post.board_id)
        required = _ROLE_LEVEL.get(board.min_role_required if board else UserRole.FREE, 0)
        title = f"[{board.name}] 새 글" if board else "새 글"
        body = post.title
        board_id = post.board_id

        rows = db.execute(
            select(PushDevice.token, User.role)
            .join(User, User.id == PushDevice.user_id)
            .where(PushDevice.post_notice.is_(True), User.is_active.is_(True))
        ).all()
        tokens = [token for token, role in rows if _ROLE_LEVEL.get(role, 0) >= required]

        result = BatchResult()
        if tokens:
            message = PushMessage(
                title=title,
                body=body,
                data={"type": "new_post", "post_id": post_id, "board_id": board_id},
                channel_id=NEW_POST_CHANNEL_ID,
                sound="default",
            )
            try:
                result = get_push_sender().send_batch(tokens, message)
            except Exception as exc:  # noqa: BLE001 - 발송기 오류는 전부 실패로 집계
                logger.warning("send_new_post_notification: 발송기 오류(post_id=%s): %s", post_id, exc)
                result = BatchResult(failure=len(tokens))

        if result.invalid_tokens:
            db.execute(delete(PushDevice).where(PushDevice.token.in_(result.invalid_tokens)))
            db.commit()

    logger.info(
        "send_new_post_notification: post=%s recipients=%s ok=%s fail=%s invalid=%s",
        post_id, len(tokens), result.success, result.failure, len(result.invalid_tokens),
    )
    return {
        "post_id": post_id,
        "status": "ok",
        "recipients": len(tokens),
        "success": result.success,
        "failure": result.failure,
        "invalid": len(result.invalid_tokens),
    }

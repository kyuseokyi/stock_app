"""Mock 푸시 발송기 — 실제 전송 없이 로그만 남긴다.

FCM 키가 없어도 파이프라인 전체(위임→조회→발송)를 검증할 수 있게 한다.
"""

from __future__ import annotations

import logging

from .base import PushMessage, PushSender

logger = logging.getLogger("push.mock")


class MockPushSender(PushSender):
    def send(self, token: str, message: PushMessage) -> bool:
        logger.info(
            "[MOCK PUSH] → token=%s | title=%s | body=%s | data=%s",
            token[:12] + "…" if len(token) > 12 else token,
            message.title,
            message.body,
            message.data,
        )
        return True

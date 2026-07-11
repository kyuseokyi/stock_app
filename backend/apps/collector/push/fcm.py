"""FCM(Firebase Cloud Messaging) 푸시 발송기 — 스켈레톤.

실제 발송은 `firebase-admin` SDK 또는 FCM HTTP v1 API 로 구현한다.
현재는 자격증명(FCM_CREDENTIALS_PATH 등)이 준비되면 채워 넣을 자리만 둔다.
환경변수 PUSH_BACKEND=fcm 로 활성화한다.
"""

from __future__ import annotations

import logging
import os

from .base import PushMessage, PushSender

logger = logging.getLogger("push.fcm")


class FcmPushSender(PushSender):
    def __init__(self) -> None:
        # 예: 서비스 계정 JSON 경로 또는 서버 키
        self.credentials_path = os.getenv("FCM_CREDENTIALS_PATH")
        # TODO: firebase_admin.initialize_app(...) 초기화

    def send(self, token: str, message: PushMessage) -> bool:
        # TODO: firebase_admin.messaging.send(...) 로 실제 발송 구현
        logger.warning(
            "FcmPushSender 미구현: 자격증명/전송 로직이 필요합니다. token=%s", token[:12]
        )
        raise NotImplementedError("FCM 발송은 아직 구현되지 않았습니다. (자격증명 필요)")

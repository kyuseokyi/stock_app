"""푸시 발송기 팩토리.

환경변수 PUSH_BACKEND (mock | fcm) 로 구현체를 선택한다. 기본은 mock.
"""

from __future__ import annotations

import os

from .base import PushMessage, PushSender
from .mock import MockPushSender

__all__ = ["PushMessage", "PushSender", "get_push_sender"]


def get_push_sender() -> PushSender:
    backend = os.getenv("PUSH_BACKEND", "mock").lower()
    if backend == "fcm":
        from .fcm import FcmPushSender

        return FcmPushSender()
    return MockPushSender()

"""푸시 발송기 인터페이스.

실제 발송 백엔드(FCM/APNs)와 파이프라인 로직을 분리하기 위한 추상 계층.
태스크는 이 인터페이스에만 의존하고, 구현체는 환경에 따라 교체된다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class PushMessage:
    # 깨우기용(무음) 메시지는 title/body 없이 data 만 — 앱 백그라운드 태스크가 받는다
    title: str | None = None
    body: str | None = None
    data: dict = field(default_factory=dict)  # 딥링크 등 부가 데이터
    channel_id: str | None = None  # Android 알림 채널(Expo channelId)
    sound: str | None = None
    priority: str | None = None  # 'high' — 잠든 Android 기기도 깨움
    content_available: bool = False  # iOS 백그라운드 깨우기(Expo contentAvailable)


@dataclass
class BatchResult:
    success: int = 0
    failure: int = 0
    invalid_tokens: list[str] = field(default_factory=list)  # 앱 삭제 등으로 무효가 된 토큰(서버가 지운다)


class PushSender(ABC):
    """푸시 발송기 공통 인터페이스."""

    @abstractmethod
    def send(self, token: str, message: PushMessage) -> bool:
        """단건 발송. 성공 시 True."""
        raise NotImplementedError

    def send_multicast(self, tokens: list[str], message: PushMessage) -> int:
        """다건 발송. 성공 건수를 반환한다. (기본은 단건 반복)"""
        return sum(1 for t in tokens if self.send(t, message))

    def send_batch(self, tokens: list[str], message: PushMessage) -> BatchResult:
        """다건 발송 + 성공·실패·무효 토큰. 기본은 단건 반복(무효 토큰 판별 없음)."""
        result = BatchResult()
        for t in tokens:
            if self.send(t, message):
                result.success += 1
            else:
                result.failure += 1
        return result

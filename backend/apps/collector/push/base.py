"""푸시 발송기 인터페이스.

실제 발송 백엔드(FCM/APNs)와 파이프라인 로직을 분리하기 위한 추상 계층.
태스크는 이 인터페이스에만 의존하고, 구현체는 환경에 따라 교체된다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class PushMessage:
    title: str
    body: str
    data: dict = field(default_factory=dict)  # 딥링크 등 부가 데이터


class PushSender(ABC):
    """푸시 발송기 공통 인터페이스."""

    @abstractmethod
    def send(self, token: str, message: PushMessage) -> bool:
        """단건 발송. 성공 시 True."""
        raise NotImplementedError

    def send_multicast(self, tokens: list[str], message: PushMessage) -> int:
        """다건 발송. 성공 건수를 반환한다. (기본은 단건 반복)"""
        return sum(1 for t in tokens if self.send(t, message))

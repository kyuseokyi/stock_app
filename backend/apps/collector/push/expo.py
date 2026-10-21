"""Expo Push 발송기 — 서버는 Expo 에만 보내고 Expo 가 FCM(Android)·APNs(iOS)로 전달한다."""
from __future__ import annotations

import logging
import os

import httpx

from .base import BatchResult, PushMessage, PushSender

logger = logging.getLogger("push.expo")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
CHUNK_SIZE = 100  # Expo 한 요청 최대 메시지 수


class ExpoPushSender(PushSender):
    def __init__(
        self,
        access_token: str | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 10.0,
    ) -> None:
        # Expo 계정에서 "Enhanced push security" 를 켠 경우에만 필요
        self.access_token = os.getenv("EXPO_ACCESS_TOKEN", "") if access_token is None else access_token
        self._transport = transport
        self._timeout = timeout

    def send(self, token: str, message: PushMessage) -> bool:
        return self.send_batch([token], message).success == 1

    def send_multicast(self, tokens: list[str], message: PushMessage) -> int:
        # 토큰마다 요청하지 않고 100개 묶음으로 보낸다
        return self.send_batch(tokens, message).success

    def send_batch(self, tokens: list[str], message: PushMessage) -> BatchResult:
        result = BatchResult()
        if not tokens:
            return result
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        with httpx.Client(transport=self._transport, timeout=self._timeout) as client:
            for i in range(0, len(tokens), CHUNK_SIZE):
                chunk = tokens[i : i + CHUNK_SIZE]
                try:
                    resp = client.post(EXPO_PUSH_URL, json=[_payload(t, message) for t in chunk], headers=headers)
                    resp.raise_for_status()
                    body = resp.json()
                    tickets = body.get("data") if isinstance(body, dict) else None
                    if not isinstance(tickets, list):
                        raise ValueError("응답 형식이 올바르지 않음")
                except (httpx.HTTPError, ValueError) as exc:
                    # 재시도 없음 — 관리자가 이력의 실패 수를 보고 다시 보낸다
                    logger.warning("expo push 묶음 실패(%s건): %s", len(chunk), exc)
                    result.failure += len(chunk)
                    continue
                if len(tickets) != len(chunk):
                    logger.warning("expo push 티켓 수 불일치: 요청 %s건 / 응답 %s건", len(chunk), len(tickets))
                for token, ticket in zip(chunk, tickets):
                    if isinstance(ticket, dict) and ticket.get("status") == "ok":
                        result.success += 1
                        continue
                    result.failure += 1
                    details = ticket.get("details") if isinstance(ticket, dict) else None
                    if isinstance(details, dict) and details.get("error") == "DeviceNotRegistered":
                        result.invalid_tokens.append(token)
                result.failure += max(0, len(chunk) - len(tickets))
        return result


def _payload(token: str, message: PushMessage) -> dict:
    """비어 있는 필드는 보내지 않는다 — 제목·본문이 없으면 Android 데이터 전용(앱 태스크가 받음)."""
    m: dict = {"to": token}
    if message.title:
        m["title"] = message.title
    if message.body:
        m["body"] = message.body
    if message.data:
        m["data"] = message.data
    if message.channel_id:
        m["channelId"] = message.channel_id
    if message.sound:
        m["sound"] = message.sound
    if message.priority:
        m["priority"] = message.priority
    if message.content_available:
        m["contentAvailable"] = True  # 옛 이름 _contentAvailable 은 하위 호환일 뿐(Expo 문서 2026-10-21)
    return m

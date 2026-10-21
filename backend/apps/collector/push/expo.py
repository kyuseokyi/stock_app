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
                    tickets = resp.json().get("data") or []
                except (httpx.HTTPError, ValueError) as exc:
                    # 재시도 없음 — 관리자가 이력의 실패 수를 보고 다시 보낸다
                    logger.warning("expo push 묶음 실패(%s건): %s", len(chunk), exc)
                    result.failure += len(chunk)
                    continue
                for token, ticket in zip(chunk, tickets):
                    if ticket.get("status") == "ok":
                        result.success += 1
                        continue
                    result.failure += 1
                    if (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                        result.invalid_tokens.append(token)
                result.failure += max(0, len(chunk) - len(tickets))
        return result


def _payload(token: str, message: PushMessage) -> dict:
    m: dict = {"to": token, "title": message.title, "body": message.body, "data": message.data}
    if message.channel_id:
        m["channelId"] = message.channel_id
    if message.sound:
        m["sound"] = message.sound
    return m

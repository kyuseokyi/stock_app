"""KIS WS 클라이언트: TR 설정 + UN 구독 거부 시 KRX 런타임 폴백(가짜 WS, 네트워크 없음)."""
from __future__ import annotations

import json

import pytest

from apps.collector.kis import ws_client
from apps.collector.kis.ws_client import KISWebSocketClient, _subscribe_frame


class _Cfg:
    mode = "prod"
    app_key = "k" * 12
    ws_url = "ws://fake"


def _ack(rt_cd: str) -> str:
    return json.dumps({"header": {"tr_id": "X"}, "body": {"rt_cd": rt_cd, "msg1": "m"}})


class _FakeWS:
    def __init__(self, frames):
        self.frames, self.sent = list(frames), []

    async def send(self, m):
        self.sent.append(m)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.frames:
            raise ConnectionError("closed")
        return self.frames.pop(0)


class _Conn:
    def __init__(self, ws):
        self.ws = ws

    async def __aenter__(self):
        return self.ws

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def harness(monkeypatch):
    state = {"sessions": [], "invalidated": 0}

    async def fake_issue(cfg, url):
        return "APPROVAL"

    async def fake_invalidate(cfg, url):
        state["invalidated"] += 1

    async def fake_sleep(_s):
        return None

    def fake_connect(url, **kw):
        ws = state["script"].pop(0)
        state["sessions"].append(ws)
        return _Conn(ws)

    monkeypatch.setattr(ws_client, "issue_approval_key", fake_issue)
    monkeypatch.setattr(ws_client, "invalidate_approval_key", fake_invalidate)
    monkeypatch.setattr(ws_client.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(ws_client.websockets, "connect", fake_connect)
    return state


def _sub_tr(ws: _FakeWS) -> str:
    return json.loads(ws.sent[0])["body"]["input"]["tr_id"]


def test_subscribe_frame_uses_given_tr():
    body = json.loads(_subscribe_frame("A", "005930", "H0UNCNT0"))["body"]["input"]
    assert body == {"tr_id": "H0UNCNT0", "tr_key": "005930"}


def test_default_tr_is_unified():
    assert KISWebSocketClient(_Cfg(), "005930", "redis://x").tr_id == "H0UNCNT0"


async def test_subscribes_with_configured_tr_and_yields_data(harness):
    harness["script"] = [_FakeWS([_ack("0"), "0|H0UNCNT0|001|a^b"])]
    c = KISWebSocketClient(_Cfg(), "005930", "redis://x", tr_id="H0UNCNT0")
    agen = c.stream()
    assert await agen.__anext__() == "0|H0UNCNT0|001|a^b"
    assert _sub_tr(harness["sessions"][0]) == "H0UNCNT0"
    await agen.aclose()


async def test_unified_rejected_twice_falls_back_to_krx(harness):
    # 1회 거부: approval_key 문제일 수 있으니 키 재발급 후 UN 재시도.
    # 새 키로도 거부(2회 연속) → NXT 미상장 등으로 보고 H0STCNT0 로 전환.
    harness["script"] = [
        _FakeWS([_ack("1")]),
        _FakeWS([_ack("1")]),
        _FakeWS([_ack("0"), "0|H0STCNT0|001|a^b"]),
    ]
    c = KISWebSocketClient(_Cfg(), "293490", "redis://x", tr_id="H0UNCNT0")
    agen = c.stream()
    assert await agen.__anext__() == "0|H0STCNT0|001|a^b"
    trs = [_sub_tr(ws) for ws in harness["sessions"]]
    assert trs == ["H0UNCNT0", "H0UNCNT0", "H0STCNT0"]
    assert c.tr_id == "H0STCNT0"
    assert harness["invalidated"] == 1  # 전환 시엔 (새) 키를 버리지 않는다
    await agen.aclose()


async def test_single_unified_reject_then_success_keeps_unified(harness):
    harness["script"] = [
        _FakeWS([_ack("1")]),
        _FakeWS([_ack("0"), "0|H0UNCNT0|001|a^b"]),
    ]
    c = KISWebSocketClient(_Cfg(), "005930", "redis://x", tr_id="H0UNCNT0")
    agen = c.stream()
    assert await agen.__anext__() == "0|H0UNCNT0|001|a^b"
    assert c.tr_id == "H0UNCNT0"
    assert harness["invalidated"] == 1
    await agen.aclose()


async def test_krx_reject_keeps_krx_and_invalidates(harness):
    harness["script"] = [
        _FakeWS([_ack("1")]),
        _FakeWS([_ack("1")]),
        _FakeWS([_ack("0"), "0|H0STCNT0|001|a^b"]),
    ]
    c = KISWebSocketClient(_Cfg(), "005930", "redis://x", tr_id="H0STCNT0")
    agen = c.stream()
    assert await agen.__anext__() == "0|H0STCNT0|001|a^b"
    assert [_sub_tr(ws) for ws in harness["sessions"]] == ["H0STCNT0"] * 3
    assert harness["invalidated"] == 2
    await agen.aclose()


async def test_krx_rejects_after_fallback_still_invalidate_key(harness):
    # UN→KRX 전환 이후의 KRX 거부는 다시 approval_key 무효화 경로를 탄다.
    harness["script"] = [
        _FakeWS([_ack("1")]),            # UN 1회: 무효화
        _FakeWS([_ack("1")]),            # UN 2회: KRX 전환(무효화 없음)
        _FakeWS([_ack("1")]),            # KRX 거부: 무효화
        _FakeWS([_ack("0"), "0|H0STCNT0|001|a^b"]),
    ]
    c = KISWebSocketClient(_Cfg(), "293490", "redis://x", tr_id="H0UNCNT0")
    agen = c.stream()
    assert await agen.__anext__() == "0|H0STCNT0|001|a^b"
    assert harness["invalidated"] == 2
    await agen.aclose()

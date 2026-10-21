"""ExpoPushSender — 100개 분할·Bearer·DeviceNotRegistered·네트워크 오류(httpx.MockTransport)."""
from __future__ import annotations

import json

import httpx

from apps.collector.push import get_push_sender
from apps.collector.push.base import BatchResult, PushMessage, PushSender
from apps.collector.push.expo import EXPO_PUSH_URL, ExpoPushSender

MSG = PushMessage(title="제목", body="본문", data={"type": "fund_report"}, channel_id="fund-report", sound="default")


def _ok_transport(calls: list[httpx.Request], error_for: set[str] = frozenset()) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        tickets = []
        for m in json.loads(request.content):
            if m["to"] in error_for:
                tickets.append({"status": "error", "message": "x", "details": {"error": "DeviceNotRegistered"}})
            else:
                tickets.append({"status": "ok", "id": "t"})
        return httpx.Response(200, json={"data": tickets})

    return httpx.MockTransport(handler)


def test_splits_into_chunks_of_100_and_counts_success():
    calls: list[httpx.Request] = []
    tokens = [f"ExponentPushToken[{i}]" for i in range(250)]
    r = ExpoPushSender(access_token="", transport=_ok_transport(calls)).send_batch(tokens, MSG)
    assert [len(json.loads(c.content)) for c in calls] == [100, 100, 50]
    assert (r.success, r.failure, r.invalid_tokens) == (250, 0, [])
    assert str(calls[0].url) == EXPO_PUSH_URL


def test_payload_has_channel_sound_data():
    calls: list[httpx.Request] = []
    ExpoPushSender(access_token="", transport=_ok_transport(calls)).send_batch(["ExponentPushToken[a]"], MSG)
    m = json.loads(calls[0].content)[0]
    assert m == {
        "to": "ExponentPushToken[a]", "title": "제목", "body": "본문",
        "data": {"type": "fund_report"}, "channelId": "fund-report", "sound": "default",
    }


def test_bearer_only_when_access_token_set():
    calls: list[httpx.Request] = []
    ExpoPushSender(access_token="secret", transport=_ok_transport(calls)).send_batch(["ExponentPushToken[a]"], MSG)
    ExpoPushSender(access_token="", transport=_ok_transport(calls)).send_batch(["ExponentPushToken[a]"], MSG)
    assert calls[0].headers["authorization"] == "Bearer secret"
    assert "authorization" not in calls[1].headers


def test_device_not_registered_is_invalid_and_failure():
    calls: list[httpx.Request] = []
    bad = "ExponentPushToken[bad]"
    r = ExpoPushSender(access_token="", transport=_ok_transport(calls, {bad})).send_batch(
        ["ExponentPushToken[a]", bad], MSG
    )
    assert (r.success, r.failure, r.invalid_tokens) == (1, 1, [bad])


def test_network_error_counts_whole_chunk_as_failure():
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    r = ExpoPushSender(access_token="", transport=httpx.MockTransport(boom)).send_batch(
        ["ExponentPushToken[a]", "ExponentPushToken[b]"], MSG
    )
    assert (r.success, r.failure) == (0, 2)


def test_http_500_counts_as_failure():
    r = ExpoPushSender(
        access_token="", transport=httpx.MockTransport(lambda req: httpx.Response(500))
    ).send_batch(["ExponentPushToken[a]"], MSG)
    assert (r.success, r.failure) == (0, 1)


def test_empty_tokens_makes_no_request():
    calls: list[httpx.Request] = []
    assert ExpoPushSender(access_token="", transport=_ok_transport(calls)).send_batch([], MSG) == BatchResult()
    assert calls == []


def test_default_send_batch_uses_send():
    class Half(PushSender):
        def send(self, token, message):
            return token.endswith("ok]")

    r = Half().send_batch(["ExponentPushToken[ok]", "ExponentPushToken[no]"], MSG)
    assert (r.success, r.failure, r.invalid_tokens) == (1, 1, [])


def test_factory_returns_expo(monkeypatch):
    monkeypatch.setenv("PUSH_BACKEND", "expo")
    assert isinstance(get_push_sender(), ExpoPushSender)


def test_send_multicast_uses_chunks():
    calls: list[httpx.Request] = []
    tokens = [f"ExponentPushToken[{i}]" for i in range(250)]
    assert ExpoPushSender(access_token="", transport=_ok_transport(calls)).send_multicast(tokens, MSG) == 250
    assert len(calls) == 3


def test_other_error_is_failure_but_not_invalid():
    t = lambda req: httpx.Response(200, json={"data": [{"status": "error", "details": {"error": "MessageTooBig"}}]})
    r = ExpoPushSender(access_token="", transport=httpx.MockTransport(t)).send_batch(["ExponentPushToken[a]"], MSG)
    assert (r.success, r.failure, r.invalid_tokens) == (0, 1, [])


def test_fewer_tickets_than_chunk_counts_rest_as_failure():
    t = lambda req: httpx.Response(200, json={"data": [{"status": "ok", "id": "t"}]})
    r = ExpoPushSender(access_token="", transport=httpx.MockTransport(t)).send_batch(
        ["ExponentPushToken[a]", "ExponentPushToken[b]", "ExponentPushToken[c]"], MSG
    )
    assert (r.success, r.failure) == (1, 2)


def test_one_chunk_network_error_is_partial_failure():
    state = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["n"] += 1
        if state["n"] == 2:
            raise httpx.ConnectError("down", request=request)
        return httpx.Response(200, json={"data": [{"status": "ok"} for _ in json.loads(request.content)]})

    tokens = [f"ExponentPushToken[{i}]" for i in range(150)]
    r = ExpoPushSender(access_token="", transport=httpx.MockTransport(handler)).send_batch(tokens, MSG)
    assert (r.success, r.failure) == (100, 50)


def test_malformed_responses_fail_chunk_without_raising():
    for resp in (
        httpx.Response(200, json=[{"status": "ok"}]),
        httpx.Response(200, content=b"not json"),
        httpx.Response(200, json={"data": "x"}),
    ):
        r = ExpoPushSender(access_token="", transport=httpx.MockTransport(lambda req, resp=resp: resp)).send_batch(
            ["ExponentPushToken[a]", "ExponentPushToken[b]"], MSG
        )
        assert (r.success, r.failure) == (0, 2)


def test_non_dict_ticket_counts_as_failure():
    t = lambda req: httpx.Response(200, json={"data": ["oops"]})
    r = ExpoPushSender(access_token="", transport=httpx.MockTransport(t)).send_batch(["ExponentPushToken[a]"], MSG)
    assert (r.success, r.failure, r.invalid_tokens) == (0, 1, [])


def test_send_single_returns_true_on_success():
    calls: list[httpx.Request] = []
    assert ExpoPushSender(access_token="", transport=_ok_transport(calls)).send("ExponentPushToken[a]", MSG) is True

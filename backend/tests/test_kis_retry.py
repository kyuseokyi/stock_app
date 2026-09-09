"""apps.collector.kis.client._request_with_retry 회귀 테스트.

적응형 쿨다운 게이팅의 근간: 재시도(연결오류/타임아웃/5xx)를 모두 소진하면
KISConnectionError(RuntimeError 서브클래스)로, 4xx·rt_cd 논리오류는 requests.HTTPError 로
'즉시' 실패해야 한다(상위 _collect_pass 가 이 타입으로 쿨다운 대상을 가른다).
"""

from __future__ import annotations

import pytest
import requests

from apps.collector.kis.client import KISClient, KISConnectionError


class _Resp:
    def __init__(self, status_code=200, body=None, text=""):
        self.status_code = status_code
        self._body = body or {}
        self.text = text

    def json(self):
        return self._body


class _FakeSession:
    """호출마다 지정된 동작(예외 raise 또는 _Resp 반환)을 재생한다."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = 0

    def request(self, *a, **kw):
        self.calls += 1
        item = self.script[min(self.calls - 1, len(self.script) - 1)]
        if isinstance(item, Exception):
            raise item
        return item


def _make_client(script):
    c = KISClient.__new__(KISClient)  # __init__(redis/config) 우회
    c._session = _FakeSession(script)
    c._headers = lambda tr_id: {}  # 토큰/redis 우회
    return c


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    # 지수 백오프 실제 대기 제거
    monkeypatch.setattr("apps.collector.kis.client.time.sleep", lambda s: None)


def test_connection_exhaustion_raises_kisconnectionerror():
    c = _make_client([requests.ConnectionError("boom")])  # 매번 연결오류
    with pytest.raises(KISConnectionError):
        c._request_with_retry("get", "http://x", "TR", {})
    # RuntimeError 서브클래스여야 기존 except 와 호환
    assert issubclass(KISConnectionError, RuntimeError)


def test_4xx_raises_httperror_immediately():
    c = _make_client([_Resp(status_code=404, text="not found")])
    with pytest.raises(requests.HTTPError):
        c._request_with_retry("get", "http://x", "TR", {})
    assert c._session.calls == 1  # 4xx 는 재시도 없이 즉시


def test_rt_cd_nonzero_raises_httperror():
    c = _make_client([_Resp(status_code=200, body={"rt_cd": "1", "msg1": "논리오류"})])
    with pytest.raises(requests.HTTPError):
        c._request_with_retry("get", "http://x", "TR", {})


def test_success_returns_body():
    body = {"rt_cd": "0", "output2": [{"stck_bsop_date": "20260101"}]}
    c = _make_client([_Resp(status_code=200, body=body)])
    assert c._request_with_retry("get", "http://x", "TR", {}) == body


def test_5xx_then_success_retries():
    body = {"rt_cd": "0", "output2": []}
    c = _make_client([_Resp(status_code=503), _Resp(status_code=200, body=body)])
    assert c._request_with_retry("get", "http://x", "TR", {}) == body
    assert c._session.calls == 2  # 5xx 1회 재시도 후 성공

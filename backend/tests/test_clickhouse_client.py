"""shared.clickhouse_schema.get_client 회귀 테스트.

전종목 수집 EMFILE(Too many open files) 사건 재발 방지: get_client()가 프로세스별로
클라이언트를 1개만 만들어 재사용하고(FD 누수 방지), fork(PID 변경) 후에는 자식이
자기 클라이언트를 새로 갖는지 확인한다.
"""

from __future__ import annotations

import shared.clickhouse_schema as ch


class _Dummy:
    _n = 0

    def __init__(self):
        _Dummy._n += 1
        self.id = _Dummy._n


def _patch(monkeypatch):
    _Dummy._n = 0
    ch._client = None
    ch._client_pid = None
    monkeypatch.setattr(ch.clickhouse_connect, "get_client", lambda **kw: _Dummy())


def test_same_process_reuses_single_client(monkeypatch):
    _patch(monkeypatch)
    a = ch.get_client()
    b = ch.get_client()
    c = ch.get_client()
    assert a is b is c            # 같은 인스턴스 재사용
    assert _Dummy._n == 1         # 실제 생성은 1회뿐(FD 누수 없음)


def test_fork_gets_new_client(monkeypatch):
    _patch(monkeypatch)
    a = ch.get_client()
    # 포크 시뮬레이션: PID 가 바뀌면 새 클라이언트를 만들어야(부모 소켓 공유 금지)
    monkeypatch.setattr(ch.os, "getpid", lambda: (ch._client_pid or 0) + 999)
    d = ch.get_client()
    assert d is not a
    assert _Dummy._n == 2


def test_failed_connect_not_cached(monkeypatch):
    # 연결 실패 시 캐시를 오염시키지 않고, 다음 호출에서 재시도해야
    _patch(monkeypatch)
    boom = {"fail": True}

    def maybe_fail(**kw):
        if boom["fail"]:
            raise ConnectionError("CH down")
        return _Dummy()

    monkeypatch.setattr(ch.clickhouse_connect, "get_client", maybe_fail)
    try:
        ch.get_client()
    except ConnectionError:
        pass
    assert ch._client is None and ch._client_pid is None  # 캐시 미오염
    boom["fail"] = False
    assert ch.get_client() is not None  # 다음 호출은 성공

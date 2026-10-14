"""수평 확장 — WS 전달 Redis Pub/Sub 버스(인스턴스 2개 시뮬레이션: 매니저 2개 + 버스 1개)."""
from __future__ import annotations

import asyncio
import json

import fakeredis
import pytest
from fakeredis import aioredis as fake_aioredis

from apps.trading_game.services import ws_bus
from apps.trading_game.services.connection_manager import ConnectionManager


class FakeWS:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.closed: int | None = None

    async def accept(self):
        pass

    async def send_text(self, text):
        self.sent.append(json.loads(text))

    async def close(self, code=1000):
        self.closed = code


@pytest.fixture
async def cluster():
    """같은 FakeServer 를 공유하는 Redis — 인스턴스 A·B 각자 매니저 + 구독 태스크."""
    server = fakeredis.FakeServer()

    def factory():
        return fake_aioredis.FakeRedis(server=server, decode_responses=True)

    publisher = factory()
    stop = asyncio.Event()
    managers = {"A": ConnectionManager(), "B": ConnectionManager()}
    tasks = []
    for m in managers.values():
        ready = asyncio.Event()
        tasks.append(asyncio.create_task(ws_bus.run_subscriber(m, stop, factory, ready=ready)))
        await asyncio.wait_for(ready.wait(), 2)
    yield publisher, managers
    stop.set()
    await asyncio.wait_for(asyncio.gather(*tasks), 3)
    await publisher.aclose()


async def _until(cond, timeout=2.0):
    for _ in range(int(timeout / 0.01)):
        if cond():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("timeout")


async def test_publish_all_reaches_login_and_public_on_every_instance(cluster):
    pub, m = cluster
    a_user, a_pub, b_pub = FakeWS(), FakeWS(), FakeWS()
    await m["A"].connect(1, a_user)
    await m["A"].connect_public(a_pub, "1.1.1.1", per_ip=3, max_total=10)
    await m["B"].connect_public(b_pub, "2.2.2.2", per_ip=3, max_total=10)
    tick = {"type": "tick", "ticker": "005930", "price": 100, "timestamp": "t"}
    await ws_bus.publish_all(tick, redis=pub)
    await _until(lambda: a_user.sent and a_pub.sent and b_pub.sent)
    assert a_user.sent == a_pub.sent == b_pub.sent == [tick]  # 메시지 형식 불변


async def test_publish_users_excludes_public(cluster):
    pub, m = cluster
    a_user, a_pub, b_user, b_pub = FakeWS(), FakeWS(), FakeWS(), FakeWS()
    await m["A"].connect(1, a_user)
    await m["A"].connect_public(a_pub, "1.1.1.1", per_ip=3, max_total=10)
    await m["B"].connect(2, b_user)
    await m["B"].connect_public(b_pub, "2.2.2.2", per_ip=3, max_total=10)
    await ws_bus.publish_users({"type": "coach", "id": 1}, redis=pub)
    await _until(lambda: a_user.sent and b_user.sent)
    await asyncio.sleep(0.05)
    assert a_user.sent == b_user.sent == [{"type": "coach", "id": 1}]
    assert a_pub.sent == [] and b_pub.sent == []


async def test_publish_user_delivered_only_by_instance_holding_that_user(cluster):
    pub, m = cluster
    on_a, on_b, b_pub = FakeWS(), FakeWS(), FakeWS()
    await m["A"].connect(7, on_a)
    await m["B"].connect(8, on_b)
    await m["B"].connect_public(b_pub, "2.2.2.2", per_ip=3, max_total=10)
    await ws_bus.publish_user(8, {"type": "position_pnl", "position_id": "p"}, redis=pub)
    await ws_bus.publish_user(99, {"type": "nudge"}, redis=pub)  # 아무 데도 없는 유저 — 무시
    await _until(lambda: on_b.sent)
    await asyncio.sleep(0.05)
    assert on_b.sent == [{"type": "position_pnl", "position_id": "p"}]
    assert on_a.sent == [] and b_pub.sent == []  # 다른 유저·공개는 개인 메시지 미수신


async def test_same_user_on_two_instances_gets_message_on_both(cluster):
    pub, m = cluster
    a, b = FakeWS(), FakeWS()
    await m["A"].connect(5, a)
    await m["B"].connect(5, b)
    await ws_bus.publish_user(5, {"type": "nudge", "position_id": "x"}, redis=pub)
    await _until(lambda: a.sent and b.sent)
    assert a.sent == b.sent == [{"type": "nudge", "position_id": "x"}]


async def test_publish_failure_is_swallowed():
    class Broken:
        async def publish(self, *a):
            raise ConnectionError("redis down")

    await ws_bus.publish_all({"type": "tick"}, redis=Broken())  # 예외 없이 로그만
    await ws_bus.publish_user(1, {"type": "nudge"}, redis=Broken())


async def test_dispatch_ignores_malformed():
    m = ConnectionManager()
    ws = FakeWS()
    await m.connect(1, ws)
    await ws_bus.dispatch(m, {"type": "pmessage", "channel": "game:ws:user:abc", "data": "{}"})
    await ws_bus.dispatch(m, {"type": "message", "channel": ws_bus.BROADCAST_CHANNEL,
                              "data": json.dumps({"aud": "weird", "msg": {"type": "x"}})})
    assert ws.sent == []


async def test_subscriber_reconnects_after_redis_error():
    server = fakeredis.FakeServer()
    calls = {"n": 0}

    def factory():
        calls["n"] += 1
        if calls["n"] == 1:
            raise ConnectionError("first connect fails")
        return fake_aioredis.FakeRedis(server=server, decode_responses=True)

    m = ConnectionManager()
    ws = FakeWS()
    await m.connect(3, ws)
    stop, ready = asyncio.Event(), asyncio.Event()
    # 백오프 1초 대기 후 재연결
    task = asyncio.create_task(ws_bus.run_subscriber(m, stop, factory, ready=ready))
    await asyncio.wait_for(ready.wait(), 3)
    pub = fake_aioredis.FakeRedis(server=server, decode_responses=True)
    await ws_bus.publish_user(3, {"type": "nudge"}, redis=pub)
    await _until(lambda: ws.sent)
    stop.set()
    await asyncio.wait_for(task, 3)
    assert calls["n"] == 2


async def test_close_all_closes_local_sockets_1001():
    m = ConnectionManager()
    u, p = FakeWS(), FakeWS()
    await m.connect(1, u)
    await m.connect_public(p, "1.1.1.1", per_ip=3, max_total=10)
    await m.close_all()
    assert u.closed == 1001 and p.closed == 1001
    assert m.user_ids() == [] and m.public_count() == 0 and m.public_count_for("1.1.1.1") == 0

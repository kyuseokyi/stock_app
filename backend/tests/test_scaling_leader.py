"""수평 확장 — 싱글톤 작업 리더 선출 · 캐시 dirty 알림."""
from __future__ import annotations

import asyncio

import fakeredis
import pytest
from fakeredis import aioredis as fake_aioredis

from apps.trading_game.services import leader as leader_mod
from apps.trading_game.services import position_cache, ws_bus
from apps.trading_game.services.connection_manager import ConnectionManager
from apps.trading_game.services.leader import LeaderElector


@pytest.fixture
def server():
    return fakeredis.FakeServer()


def _redis(server):
    return fake_aioredis.FakeRedis(server=server, decode_responses=True)


async def _until(cond, timeout=3.0):
    for _ in range(int(timeout / 0.01)):
        if cond():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("timeout")


class _Job:
    """리더 작업 흉내 — 실행 중 여부 기록, term stop 이벤트로 종료."""

    def __init__(self) -> None:
        self.running = 0
        self.starts = 0

    async def __call__(self, stop: asyncio.Event) -> None:
        self.running += 1
        self.starts += 1
        try:
            await stop.wait()
        finally:
            self.running -= 1


# ---------------------------------------------------------------- 락 연산
async def test_acquire_is_exclusive_and_release_only_own(server):
    a = LeaderElector(_redis(server), "t", instance_id="A", ttl_ms=5000)
    b = LeaderElector(_redis(server), "t", instance_id="B", ttl_ms=5000)
    assert await a.try_acquire() is True
    assert await b.try_acquire() is False
    assert await b.renew() is False          # 남의 락 연장 금지
    assert await b.release() is False        # 남의 락 삭제 금지
    r = _redis(server)
    assert await r.get("game:leader:t") == "A"
    assert await a.renew() is True
    assert 0 < await r.pttl("game:leader:t") <= 5000
    assert await a.release() is True
    assert await r.get("game:leader:t") is None
    assert await b.try_acquire() is True


async def test_lock_expires_without_renew(server):
    a = LeaderElector(_redis(server), "t", instance_id="A", ttl_ms=300)
    b = LeaderElector(_redis(server), "t", instance_id="B", ttl_ms=300)
    assert await a.try_acquire()
    await asyncio.sleep(0.4)
    assert await a.renew() is False          # 만료된 락은 연장 불가
    assert await b.try_acquire() is True


def test_ttl_env_and_instance_id(monkeypatch):
    monkeypatch.delenv("GAME_LEADER_TTL_MS", raising=False)
    assert leader_mod.ttl_ms_from_env() == 10_000
    monkeypatch.setenv("GAME_LEADER_TTL_MS", "3000")
    assert leader_mod.ttl_ms_from_env() == 3000
    monkeypatch.setenv("GAME_LEADER_TTL_MS", "bad")
    assert leader_mod.ttl_ms_from_env() == 10_000
    e = LeaderElector(object(), "x", ttl_ms=9000)
    assert e.interval == pytest.approx(3.0)  # 갱신 주기 = ttl/3
    assert len(e.instance_id.split(":")) == 3 and e.instance_id != leader_mod.new_instance_id()


# ---------------------------------------------------------------- 감독 루프
async def test_only_one_instance_runs_singleton_tasks_and_graceful_handover(server):
    stop_a, stop_b = asyncio.Event(), asyncio.Event()
    job_a, job_b = _Job(), _Job()
    a = LeaderElector(_redis(server), "t", instance_id="A", ttl_ms=600, interval=0.05)
    b = LeaderElector(_redis(server), "t", instance_id="B", ttl_ms=600, interval=0.05)
    gains = []
    ta = asyncio.create_task(a.run(stop_a, [job_a], on_gain=lambda: gains.append("A")))
    await _until(lambda: a.is_leader and job_a.running == 1)
    tb = asyncio.create_task(b.run(stop_b, [job_b], on_gain=lambda: gains.append("B")))
    await asyncio.sleep(0.8)  # TTL 보다 길게 — A 가 갱신을 계속하므로 B 는 계속 대기
    assert a.is_leader and not b.is_leader and job_b.starts == 0
    # 정상 종료(SIGTERM) → A 작업 중지 + 락 반납 → B 가 다음 재시도 주기에 승계
    stop_a.set()
    await asyncio.wait_for(ta, 2)
    assert job_a.running == 0
    await _until(lambda: b.is_leader and job_b.running == 1, timeout=1.0)
    assert gains == ["A", "B"]
    assert await _redis(server).get("game:leader:t") == "B"
    stop_b.set()
    await asyncio.wait_for(tb, 2)
    assert await _redis(server).get("game:leader:t") is None  # 종료 시 반납


async def test_crashed_leader_is_taken_over_within_ttl(server):
    stop_a, stop_b = asyncio.Event(), asyncio.Event()
    job_a, job_b = _Job(), _Job()
    ttl_ms = 400
    a = LeaderElector(_redis(server), "t", instance_id="A", ttl_ms=ttl_ms)
    b = LeaderElector(_redis(server), "t", instance_id="B", ttl_ms=ttl_ms)
    ta = asyncio.create_task(a.run(stop_a, [job_a]))
    await _until(lambda: a.is_leader)
    tb = asyncio.create_task(b.run(stop_b, [job_b]))
    await asyncio.sleep(0.05)
    ta.cancel()  # 프로세스 kill 흉내 — 반납 없음
    with pytest.raises(asyncio.CancelledError):
        await ta
    t0 = asyncio.get_running_loop().time()
    await _until(lambda: b.is_leader and job_b.running == 1, timeout=2.0)
    elapsed = asyncio.get_running_loop().time() - t0
    assert elapsed <= ttl_ms / 1000 * (1 + 1 / 3) + 0.2  # ≤ ttl + 재시도 주기
    stop_b.set()
    await asyncio.wait_for(tb, 2)


async def test_lost_lock_stops_tasks_immediately_and_regains(server):
    stop = asyncio.Event()
    job = _Job()
    r = _redis(server)
    a = LeaderElector(_redis(server), "t", instance_id="A", ttl_ms=5000, interval=0.05)
    task = asyncio.create_task(a.run(stop, [job]))
    await _until(lambda: job.running == 1)
    await r.set("game:leader:t", "INTRUDER", px=300)  # 다른 인스턴스가 락을 가져감(예: 네트워크 분리 후)
    await _until(lambda: not a.is_leader and job.running == 0, timeout=1.0)
    assert await r.get("game:leader:t") == "INTRUDER"  # 남의 락은 건드리지 않음
    await _until(lambda: a.is_leader and job.running == 1, timeout=2.0)  # 만료 후 재획득 → 재시작
    assert job.starts == 2
    stop.set()
    await asyncio.wait_for(task, 2)


async def test_redis_error_on_renew_steps_down(server):
    class Flaky:
        def __init__(self, inner):
            self.inner = inner
            self.broken = False

        async def set(self, *a, **k):
            if self.broken:
                raise ConnectionError("down")
            return await self.inner.set(*a, **k)

        async def eval(self, *a):
            if self.broken:
                raise ConnectionError("down")
            return await self.inner.eval(*a)

    flaky = Flaky(_redis(server))
    stop = asyncio.Event()
    job = _Job()
    a = LeaderElector(flaky, "t", instance_id="A", ttl_ms=5000, interval=0.05)
    task = asyncio.create_task(a.run(stop, [job]))
    await _until(lambda: job.running == 1)
    flaky.broken = True
    await _until(lambda: not a.is_leader and job.running == 0, timeout=1.0)
    flaky.broken = False
    # 남아 있는 락이 자기 것이면 TTL 만료를 기다리지 않고 재획득 → 작업 재시작
    await _until(lambda: a.is_leader and job.running == 1, timeout=1.0)
    assert job.starts == 2
    stop.set()
    await asyncio.wait_for(task, 2)


# ---------------------------------------------------------------- 캐시 dirty 알림
async def test_mark_dirty_publishes_and_other_instance_marks_local(server, monkeypatch):
    """주문을 받은 인스턴스(비리더) mark_dirty → Redis 알림 → 리더 인스턴스 구독자가 로컬 캐시 dirty."""
    pub = _redis(server)
    monkeypatch.setattr(position_cache.deps, "get_redis", lambda: pub)
    leader_cache = position_cache.PositionCache(ttl=60.0)
    leader_marks = []

    def on_dirty():
        leader_marks.append(1)
        leader_cache.mark_dirty()

    stop, ready = asyncio.Event(), asyncio.Event()
    sub = asyncio.create_task(ws_bus.run_subscriber(
        ConnectionManager(), stop, lambda: _redis(server), ready=ready,
        extra_channels={position_cache.DIRTY_CHANNEL: on_dirty},
    ))
    await asyncio.wait_for(ready.wait(), 2)
    gen0 = leader_cache._gen
    local_gen0 = position_cache.cache._gen
    position_cache.mark_dirty()  # 동기 호출(기존 호출부 그대로)
    assert position_cache.cache._gen == local_gen0 + 1  # 로컬은 즉시
    await _until(lambda: leader_marks)
    assert leader_cache._gen == gen0 + 1
    stop.set()
    await asyncio.wait_for(sub, 3)


def test_mark_dirty_without_loop_is_local_only():
    gen = position_cache.cache._gen
    position_cache.mark_dirty()  # 이벤트 루프 없음 — 발행 생략, 예외 없음
    assert position_cache.cache._gen == gen + 1


async def test_publish_dirty_failure_is_swallowed():
    class Broken:
        async def publish(self, *a):
            raise ConnectionError("down")

    await position_cache.publish_dirty(Broken())


def test_mark_dirty_local_does_not_publish(monkeypatch):
    def boom():
        raise AssertionError("재발행 금지")

    monkeypatch.setattr(position_cache.deps, "get_redis", boom)
    gen = position_cache.cache._gen
    position_cache.mark_dirty_local()
    assert position_cache.cache._gen == gen + 1

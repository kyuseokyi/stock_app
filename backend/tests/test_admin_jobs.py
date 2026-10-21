"""관리자 계산 수동 실행 — 화이트리스트, 실행 중 409, 끝난 잠금 교체, 기록 30건, 큐 장애 시 잠금 해제(fakeredis)."""
from __future__ import annotations

import json
from types import SimpleNamespace

import fakeredis
import pytest

from apps.stock_api.services import admin_jobs as aj


@pytest.fixture
def env(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    states: dict = {}
    sent: list = []
    monkeypatch.setattr(aj, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(aj, "_task_state", lambda tid: states.get(tid, ("PENDING", None)))
    monkeypatch.setattr(aj.celery_app, "send_task",
                        lambda name, kwargs=None, task_id=None: sent.append((name, kwargs, task_id)))
    return SimpleNamespace(redis=fake, states=states, sent=sent)


def _job(overview, key):
    return next(j for j in overview["jobs"] if j["key"] == key)


def test_unknown_job_rejected(env):
    with pytest.raises(aj.UnknownJob):
        aj.run("settle_trading_season", "관리자")
    assert env.sent == []


def test_run_sends_whitelisted_task_and_records(env):
    out = aj.run("backfill_market_groups", "관리자")
    assert env.sent == [("collector.backfill_market_groups", {"days": 60}, out["task_id"])]
    assert 0 < env.redis.ttl("admin:job:backfill_market_groups") <= 3600
    ov = aj.overview()
    assert [j["key"] for j in ov["jobs"]] == ["canslim", "market_groups", "backfill_canslim", "backfill_market_groups",
                                         "screener", "backfill_screener"]
    job = _job(ov, "backfill_market_groups")
    assert job["status"] == "queued" and job["task_id"] == out["task_id"]
    assert _job(ov, "canslim")["status"] == "idle"
    h = ov["history"][0]
    assert h["actor"] == "관리자" and h["state"] == "PENDING" and h["label"] == "시장 그룹 60일 백필"


def test_second_run_while_active_conflicts(env):
    first = aj.run("canslim", "A")
    env.states[first["task_id"]] = ("STARTED", None)
    with pytest.raises(aj.JobRunning) as e:
        aj.run("canslim", "B")
    assert e.value.info["task_id"] == first["task_id"] and e.value.info["actor"] == "A"
    assert len(env.sent) == 1
    assert _job(aj.overview(), "canslim")["status"] == "running"


def test_finished_lock_is_replaced(env):
    first = aj.run("canslim", "A")
    env.states[first["task_id"]] = ("SUCCESS", {"rows": 2400})
    second = aj.run("canslim", "B")
    assert second["task_id"] != first["task_id"] and len(env.sent) == 2
    ov = aj.overview()
    assert _job(ov, "canslim")["status"] == "queued"
    assert ov["history"][0]["task_id"] == second["task_id"]
    assert ov["history"][1]["state"] == "SUCCESS" and '"rows": 2400' in ov["history"][1]["result_summary"]


def test_failure_summary_and_expired_history(env):
    first = aj.run("market_groups", "A")
    env.states[first["task_id"]] = ("FAILURE", RuntimeError("no bars"))
    env.redis.rpush(aj.HISTORY_KEY, json.dumps({"job": "canslim", "task_id": "old", "actor": "A",
                                                "requested_at": "2026-10-14T11:00:00+00:00"}))
    ov = aj.overview()
    assert ov["history"][0]["state"] == "FAILURE" and "no bars" in ov["history"][0]["result_summary"]
    assert ov["history"][1]["state"] == "UNKNOWN" and ov["history"][1]["result_summary"] is None


def test_history_trimmed(env):
    for _ in range(aj.HISTORY_MAX + 3):
        out = aj.run("market_groups", "A")
        env.states[out["task_id"]] = ("SUCCESS", {})
    assert env.redis.llen(aj.HISTORY_KEY) == aj.HISTORY_MAX


def test_queue_failure_releases_lock(env, monkeypatch):
    def down(*a, **k):
        raise ConnectionError("broker down")

    monkeypatch.setattr(aj.celery_app, "send_task", down)
    with pytest.raises(aj.QueueUnavailable):
        aj.run("canslim", "A")
    assert env.redis.get("admin:job:canslim") is None
    assert env.redis.llen(aj.HISTORY_KEY) == 0


def test_redis_down_on_lock_is_queue_unavailable(env, monkeypatch):
    import redis

    def boom(*a, **k):
        raise redis.ConnectionError("redis down")

    monkeypatch.setattr(env.redis, "set", boom)
    with pytest.raises(aj.QueueUnavailable):
        aj.run("canslim", "A")
    assert env.sent == []


def test_task_state_backend_error_is_unknown(monkeypatch):
    class Bad:
        @property
        def state(self):
            raise RuntimeError("backend down")

    monkeypatch.setattr(aj.celery_app, "AsyncResult", lambda tid: Bad())
    assert aj._task_state("x") == ("UNKNOWN", None)


def test_history_write_failure_does_not_fail_run(env, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("history down")

    monkeypatch.setattr(env.redis, "pipeline", boom)
    out = aj.run("canslim", "A")
    assert out["task_id"] and len(env.sent) == 1


def test_overview_redis_down_is_queue_unavailable(env, monkeypatch):
    import redis

    def boom(*a, **k):
        raise redis.ConnectionError("redis down")

    monkeypatch.setattr(env.redis, "get", boom)
    with pytest.raises(aj.QueueUnavailable):
        aj.overview()


def test_queue_failure_and_lock_release_failure_still_queue_unavailable(env, monkeypatch):
    import redis

    def down(*a, **k):
        raise ConnectionError("broker down")

    def del_fail(*a, **k):
        raise redis.ConnectionError("redis down")

    monkeypatch.setattr(aj.celery_app, "send_task", down)
    monkeypatch.setattr(env.redis, "delete", del_fail)
    with pytest.raises(aj.QueueUnavailable):
        aj.run("canslim", "A")

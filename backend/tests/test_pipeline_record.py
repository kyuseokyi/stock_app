"""일일 파이프라인 기록 — 저장·읽기·요약 자르기·Redis 장애 무시(fakeredis)."""
from __future__ import annotations

from datetime import datetime, timezone

import fakeredis

from shared import pipeline_record as pr

T0 = datetime(2026, 10, 16, 11, 30, tzinfo=timezone.utc)
T1 = datetime(2026, 10, 16, 12, 10, tzinfo=timezone.utc)


def test_save_and_load_roundtrip():
    fake = fakeredis.FakeRedis(decode_responses=True)
    steps = [{"name": "daily", "ok": True, "seconds": 12.5, "summary": "{}"}]
    pr.save(fake, T0, T1, steps)
    rec = pr.load(fake)
    assert rec == {"started_at": T0.isoformat(), "finished_at": T1.isoformat(), "steps": steps}
    assert 0 < fake.ttl(pr.KEY) <= pr.TTL_SECONDS


def test_load_missing_or_broken_returns_none():
    fake = fakeredis.FakeRedis(decode_responses=True)
    assert pr.load(fake) is None
    fake.set(pr.KEY, "{broken")
    assert pr.load(fake) is None


def test_redis_failure_is_swallowed():
    class Down:
        def set(self, *a, **k):
            raise ConnectionError("redis down")

        def get(self, *a, **k):
            raise ConnectionError("redis down")

    pr.save(Down(), T0, T1, [])  # 예외 없이 끝나야 한다
    assert pr.load(Down()) is None


def test_summarize_truncates_and_handles_non_json():
    assert len(pr.summarize({"x": "a" * 500})) == pr.SUMMARY_MAX
    assert pr.summarize({"d": T0}).startswith('{"d": "2026-10-16')


def test_summarize_circular_reference_does_not_raise():
    d: dict = {}
    d["self"] = d
    out = pr.summarize(d)
    assert isinstance(out, str) and len(out) <= pr.SUMMARY_MAX

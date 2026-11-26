"""급등락 분석 Celery 작업 — 잠금(중복 실행 방지)·해제, 날짜 없으면 최신 거래일, beat 일정(상용·개발 모두)."""
from __future__ import annotations

from datetime import date

from apps.collector import celery_app as ca
from apps.collector.tasks import daily_surge as task


class _Redis:
    def __init__(self):
        self.d: dict = {}

    def set(self, k, v, nx=False, ex=None):
        if nx and k in self.d:
            return False
        self.d[k] = v
        return True

    def get(self, k):
        return self.d.get(k)

    def delete(self, k):
        self.d.pop(k, None)


def _patch(monkeypatch, redis, calls):
    monkeypatch.setattr(task, "get_sync_redis", lambda: redis)
    monkeypatch.setattr(task, "build_deps", lambda: type("D", (), {"latest_date": staticmethod(lambda: date(2026, 11, 26))})())
    monkeypatch.setattr(task, "run_day", lambda day, deps: calls.append(day) or {"date": day})


def test_runs_latest_date_and_releases_lock(monkeypatch):
    redis, calls = _Redis(), []
    _patch(monkeypatch, redis, calls)
    assert task.analyze_daily_surge() == {"date": "2026-11-26"}
    assert calls == ["2026-11-26"]
    assert task.lock_key("2026-11-26") not in redis.d


def test_skips_when_locked(monkeypatch):
    redis, calls = _Redis(), []
    _patch(monkeypatch, redis, calls)
    redis.d[task.lock_key("2026-11-20")] = "other"
    assert task.analyze_daily_surge("2026-11-20")["skipped"].startswith("실행 중")
    assert calls == [] and redis.d[task.lock_key("2026-11-20")] == "other"


def test_beat_weekday_2210_kept_in_readonly():
    entry = ca.celery_app.conf.beat_schedule.get("analyze-daily-surge") or \
        ca.readonly_beat_schedule({"analyze-daily-surge": {"task": task.TASK_NAME}})["analyze-daily-surge"]
    assert entry["task"] == task.TASK_NAME
    assert "analyze-daily-surge" not in ca.READONLY_DISABLED_BEATS
    sched = ca.celery_app.conf.beat_schedule
    if "analyze-daily-surge" in sched:
        cron = sched["analyze-daily-surge"]["schedule"]
        assert cron.hour == {22} and cron.minute == {10} and cron.day_of_week == {1, 2, 3, 4, 5}

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


def _patch(monkeypatch, redis, calls, latest=date(2026, 11, 26)):
    monkeypatch.setattr(task, "get_sync_redis", lambda: redis)
    monkeypatch.setattr(task, "build_deps", lambda: type("D", (), {"latest_date": staticmethod(lambda: latest)})())
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


def test_scheduled_skips_holiday_and_stale_day(monkeypatch):
    redis, calls = _Redis(), []
    _patch(monkeypatch, redis, calls, latest=date(2026, 11, 25))
    monkeypatch.setattr(task, "_today_kst", lambda: date(2026, 11, 28))  # 토요일
    assert task.analyze_daily_surge(scheduled=True)["skipped"].startswith("휴장일")
    monkeypatch.setattr(task, "_today_kst", lambda: date(2026, 11, 26))  # 거래일인데 오늘 일봉 없음
    assert task.analyze_daily_surge(scheduled=True)["skipped"].startswith("오늘 일봉 없음")
    assert calls == []
    assert task.analyze_daily_surge() == {"date": "2026-11-25"}  # 수동 실행은 최신 거래일 그대로


def test_retry_only_if_missing(monkeypatch):
    redis, calls = _Redis(), []
    _patch(monkeypatch, redis, calls)
    monkeypatch.setattr(task, "_today_kst", lambda: date(2026, 11, 26))
    monkeypatch.setattr(task, "_stored_count", lambda day: 3)
    assert task.analyze_daily_surge(scheduled=True, only_if_missing=True)["skipped"].startswith("이미 집계됨")
    monkeypatch.setattr(task, "_stored_count", lambda day: 0)
    assert task.analyze_daily_surge(scheduled=True, only_if_missing=True) == {"date": "2026-11-26"}


def test_retry_beat_registered():
    entry = ca.celery_app.conf.beat_schedule["analyze-daily-surge-retry"]
    assert entry["kwargs"] == {"scheduled": True, "only_if_missing": True}
    assert ca.celery_app.conf.beat_schedule["analyze-daily-surge"]["kwargs"] == {"scheduled": True}

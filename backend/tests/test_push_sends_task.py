"""send_fund_notice — 대상·집계·무효 토큰 삭제·상태·템플릿 last_sent_at."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from apps.collector.celery_app import celery_app
from apps.collector.push.base import BatchResult, PushSender
from apps.collector.tasks import push_sends
from shared.models import Base, PushDevice, PushSend, PushTemplate, User, UserRole


class FakeSender(PushSender):
    def __init__(self, invalid: set[str] = frozenset(), fail_all: bool = False):
        self.calls: list[tuple[list[str], object]] = []
        self.invalid = invalid
        self.fail_all = fail_all

    def send(self, token, message):  # pragma: no cover - send_batch 만 쓴다
        return True

    def send_batch(self, tokens, message):
        self.calls.append((list(tokens), message))
        if self.fail_all:
            return BatchResult(failure=len(tokens))
        bad = [t for t in tokens if t in self.invalid]
        return BatchResult(success=len(tokens) - len(bad), failure=len(bad), invalid_tokens=bad)


@pytest.fixture
def maker(monkeypatch):
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    mk = sessionmaker(engine, class_=Session, expire_on_commit=False)
    monkeypatch.setattr(push_sends, "SyncSessionLocal", mk)
    yield mk
    engine.dispose()


def _seed(mk, *, mode="now", status="sending", with_template=False) -> int:
    with mk() as db:
        admin = User(nickname="관리자", role=UserRole.ADMIN, is_active=True)
        user = User(nickname="일반", role=UserRole.FREE, is_active=True)
        db.add_all([admin, user])
        db.flush()
        db.add_all([
            PushDevice(token="ExponentPushToken[admin]", user_id=admin.id, platform="android", fund_notice=False),
            PushDevice(token="ExponentPushToken[u1]", user_id=user.id, platform="android", fund_notice=True),
            PushDevice(token="ExponentPushToken[u2]", user_id=user.id, platform="android", fund_notice=True),
            PushDevice(token="ExponentPushToken[off]", user_id=user.id, platform="android", fund_notice=False),
        ])
        tpl_id = None
        if with_template:
            tpl = PushTemplate(title="t", body="b")
            db.add(tpl)
            db.flush()
            tpl_id = tpl.id
        send = PushSend(kind="fund_report", mode=mode, ref_date=date(2026, 3, 5), title="{date} 제목",
                        body="{date} 리포트", status=status, template_id=tpl_id, created_by=admin.id)
        db.add(send)
        db.commit()
        return send.id


def test_now_sends_to_fund_notice_devices_and_renders_date(maker, monkeypatch):
    sender = FakeSender()
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: sender)
    sid = _seed(maker)
    out = push_sends.send_fund_notice(sid)
    tokens, msg = sender.calls[0]
    assert sorted(tokens) == ["ExponentPushToken[u1]", "ExponentPushToken[u2]"]
    assert msg.title == "3월 5일 제목" and msg.body == "3월 5일 리포트"
    assert msg.data == {"type": "fund_report", "date": "2026-03-05"} and msg.channel_id == "fund-report"
    with maker() as db:
        s = db.get(PushSend, sid)
        assert (s.status, s.target_count, s.success_count, s.failure_count) == ("done", 2, 2, 0)
        assert s.finished_at is not None
    assert out["status"] == "done"


def test_test_mode_targets_only_admin_devices(maker, monkeypatch):
    sender = FakeSender()
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: sender)
    push_sends.send_fund_notice(_seed(maker, mode="test"))
    assert sender.calls[0][0] == ["ExponentPushToken[admin]"]


def test_invalid_tokens_deleted(maker, monkeypatch):
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: FakeSender(invalid={"ExponentPushToken[u2]"}))
    sid = _seed(maker)
    push_sends.send_fund_notice(sid)
    with maker() as db:
        tokens = set(db.execute(select(PushDevice.token)).scalars())
        assert "ExponentPushToken[u2]" not in tokens
        s = db.get(PushSend, sid)
        assert (s.success_count, s.failure_count, s.status) == (1, 1, "done")


def test_all_failed_marks_failed(maker, monkeypatch):
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: FakeSender(fail_all=True))
    sid = _seed(maker)
    push_sends.send_fund_notice(sid)
    with maker() as db:
        assert db.get(PushSend, sid).status == "failed"


def test_sender_exception_marks_failed(maker, monkeypatch):
    class Boom(FakeSender):
        def send_batch(self, tokens, message):
            raise RuntimeError("x")

    monkeypatch.setattr(push_sends, "get_push_sender", lambda: Boom())
    sid = _seed(maker)
    push_sends.send_fund_notice(sid)
    with maker() as db:
        s = db.get(PushSend, sid)
        assert (s.status, s.failure_count) == ("failed", 2)


def test_not_sending_is_skipped(maker, monkeypatch):
    sender = FakeSender()
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: sender)
    assert push_sends.send_fund_notice(_seed(maker, status="cancelled"))["status"] == "skipped"
    assert push_sends.send_fund_notice(9999)["status"] == "skipped"
    assert sender.calls == []


def test_template_last_sent_at_updated(maker, monkeypatch):
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: FakeSender())
    sid = _seed(maker, with_template=True)
    push_sends.send_fund_notice(sid)
    with maker() as db:
        tpl = db.get(PushTemplate, db.get(PushSend, sid).template_id)
        assert tpl.last_sent_at is not None


def test_unexpected_exception_marks_failed_not_stuck(maker, monkeypatch):
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: FakeSender())

    def boom(*a, **k):
        raise RuntimeError("render")

    monkeypatch.setattr(push_sends, "render_push_text", boom)
    sid = _seed(maker)
    out = push_sends.send_fund_notice(sid)
    assert out["status"] == "failed"
    with maker() as db:
        s = db.get(PushSend, sid)
        assert s.status == "failed" and s.finished_at is not None


def _scheduled(mk, minutes_from_now: int) -> int:
    with mk() as db:
        admin = User(nickname=f"관리자{minutes_from_now}", role=UserRole.ADMIN, is_active=True)
        db.add(admin)
        db.flush()
        s = PushSend(kind="fund_report", mode="scheduled", ref_date=date(2026, 10, 21), title="t", body="b",
                     status="scheduled", scheduled_at=datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now),
                     created_by=admin.id)
        db.add(s)
        db.commit()
        return s.id


def test_dispatch_claims_due_once_publishes_and_queues(maker, monkeypatch):
    queued, published = [], []
    monkeypatch.setattr(push_sends.send_fund_notice, "delay", lambda sid: queued.append(sid))
    monkeypatch.setattr(push_sends, "publish_fund_event", lambda d: published.append(d))
    due = _scheduled(maker, -1)
    later = _scheduled(maker, 30)
    assert push_sends.dispatch_scheduled_pushes()["claimed"] == 1
    assert queued == [due] and published == [date(2026, 10, 21)]
    # 두 번째 실행은 이미 sending 이라 다시 집지 않는다
    assert push_sends.dispatch_scheduled_pushes()["claimed"] == 0
    with maker() as db:
        assert db.get(PushSend, due).status == "sending" and db.get(PushSend, due).started_at is not None
        assert db.get(PushSend, later).status == "scheduled"


def test_dispatch_delegate_failure_isolated_per_send(maker, monkeypatch):
    queued = []

    def delay(sid):
        if not queued and not failed:
            failed.append(sid)
            raise RuntimeError("broker down")
        queued.append(sid)

    failed: list[int] = []
    monkeypatch.setattr(push_sends.send_fund_notice, "delay", delay)
    monkeypatch.setattr(push_sends, "publish_fund_event", lambda d: None)
    first = _scheduled(maker, -2)
    second = _scheduled(maker, -1)
    assert push_sends.dispatch_scheduled_pushes()["claimed"] == 2
    assert failed == [first] and queued == [second]
    with maker() as db:
        f = db.get(PushSend, first)
        assert f.status == "failed" and f.finished_at is not None
        assert db.get(PushSend, second).status == "sending"


def test_dispatch_skips_cancelled(maker, monkeypatch):
    queued = []
    monkeypatch.setattr(push_sends.send_fund_notice, "delay", lambda sid: queued.append(sid))
    monkeypatch.setattr(push_sends, "publish_fund_event", lambda d: None)
    sid = _scheduled(maker, -1)
    with maker() as db:
        db.get(PushSend, sid).status = "cancelled"
        db.commit()
    assert push_sends.dispatch_scheduled_pushes()["claimed"] == 0
    assert queued == []


def test_claim_is_conditional_on_status(maker):
    sid = _scheduled(maker, -1)
    with maker() as db:
        db.get(PushSend, sid).status = "cancelled"  # 취소가 먼저 이긴 상황
        db.commit()
    with maker() as db:
        assert push_sends._claim(db, sid, datetime.now(timezone.utc)) is False


def test_dispatch_fails_stale_sending_only(maker, monkeypatch):
    monkeypatch.setattr(push_sends.send_fund_notice, "delay", lambda sid: None)
    monkeypatch.setattr(push_sends, "publish_fund_event", lambda d: None)
    now = datetime.now(timezone.utc)
    old = _scheduled(maker, 30)
    fresh = _scheduled(maker, 31)
    sched = _scheduled(maker, 32)
    with maker() as db:
        db.get(PushSend, old).status = "sending"
        db.get(PushSend, old).started_at = now - timedelta(minutes=20)
        db.get(PushSend, fresh).status = "sending"
        db.get(PushSend, fresh).started_at = now - timedelta(minutes=5)
        db.commit()
    assert push_sends.dispatch_scheduled_pushes()["stale_failed"] == 1
    with maker() as db:
        o = db.get(PushSend, old)
        assert o.status == "failed" and o.finished_at is not None
        assert db.get(PushSend, fresh).status == "sending"
        assert db.get(PushSend, sched).status == "scheduled"
    assert push_sends.dispatch_scheduled_pushes()["stale_failed"] == 0


def test_beat_entry_registered():
    entry = celery_app.conf.beat_schedule["dispatch-scheduled-pushes"]
    assert entry["task"] == "collector.dispatch_scheduled_pushes"
    assert entry["schedule"] == 60.0
    assert "apps.collector.tasks.push_sends" in celery_app.conf.include
    assert "collector.dispatch_scheduled_pushes" in celery_app.tasks


def test_sends_wake_message_after_alert(maker, monkeypatch):
    sender = FakeSender()
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: sender)
    push_sends.send_fund_notice(_seed(maker))
    assert len(sender.calls) == 2
    (alert_tokens, alert), (wake_tokens, wake) = sender.calls
    assert sorted(wake_tokens) == sorted(alert_tokens)
    assert alert.data["type"] == "fund_report" and alert.title
    assert wake.title is None and wake.body is None
    assert wake.data == {"type": "fund_refresh", "date": "2026-03-05"}
    assert wake.priority == "high" and wake.content_available is True


def test_test_mode_wakes_admin_device_too(maker, monkeypatch):
    sender = FakeSender()
    monkeypatch.setattr(push_sends, "get_push_sender", lambda: sender)
    push_sends.send_fund_notice(_seed(maker, mode="test"))
    assert [c[0] for c in sender.calls] == [["ExponentPushToken[admin]"], ["ExponentPushToken[admin]"]]


def test_counts_follow_alert_and_wake_invalid_tokens_also_deleted(maker, monkeypatch):
    class WakeInvalid(FakeSender):
        def send_batch(self, tokens, message):
            self.calls.append((list(tokens), message))
            if message.data.get("type") == "fund_refresh":
                return BatchResult(success=1, failure=1, invalid_tokens=["ExponentPushToken[u1]"])
            return BatchResult(success=len(tokens))

    monkeypatch.setattr(push_sends, "get_push_sender", lambda: WakeInvalid())
    sid = _seed(maker)
    push_sends.send_fund_notice(sid)
    with maker() as db:
        s = db.get(PushSend, sid)
        assert (s.status, s.success_count, s.failure_count) == ("done", 2, 0)  # 이력은 알림용 기준
        assert "ExponentPushToken[u1]" not in set(db.execute(select(PushDevice.token)).scalars())


def test_wake_failure_does_not_change_status(maker, monkeypatch):
    class WakeBoom(FakeSender):
        def send_batch(self, tokens, message):
            if message.data.get("type") == "fund_refresh":
                raise RuntimeError("wake 실패")
            return super().send_batch(tokens, message)

    monkeypatch.setattr(push_sends, "get_push_sender", lambda: WakeBoom())
    sid = _seed(maker)
    push_sends.send_fund_notice(sid)
    with maker() as db:
        s = db.get(PushSend, sid)
        assert (s.status, s.success_count, s.failure_count) == ("done", 2, 0)

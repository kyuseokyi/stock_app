"""send_fund_notice — 대상·집계·무효 토큰 삭제·상태·템플릿 last_sent_at."""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

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

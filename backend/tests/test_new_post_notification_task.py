"""send_new_post_notification — 대상(역할 등급·post_notice·활성 사용자)·메시지·무효 토큰 삭제·예외 삼킴."""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from apps.collector.push.base import BatchResult, PushSender
from apps.collector.tasks import notifications
from shared.models import Base, BlogPost, Board, PushDevice, User, UserRole


class FakeSender(PushSender):
    def __init__(self, invalid: frozenset[str] = frozenset(), boom: bool = False):
        self.calls: list[tuple[list[str], object]] = []
        self.invalid = invalid
        self.boom = boom

    def send(self, token, message):  # pragma: no cover - send_batch 만 쓴다
        return True

    def send_batch(self, tokens, message):
        self.calls.append((list(tokens), message))
        if self.boom:
            raise RuntimeError("expo down")
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
    monkeypatch.setattr(notifications, "SyncSessionLocal", mk)
    yield mk
    engine.dispose()


def _seed(mk, *, board_role: UserRole = UserRole.FREE) -> int:
    """기기 5개: free(on), premium(on), free(off), inactive(on), admin(on). 반환은 글 id."""
    with mk() as db:
        free = User(nickname="무료", role=UserRole.FREE, is_active=True)
        premium = User(nickname="유료", role=UserRole.PREMIUM, is_active=True)
        off = User(nickname="끔", role=UserRole.FREE, is_active=True)
        gone = User(nickname="휴면", role=UserRole.FREE, is_active=False)
        admin = User(nickname="관리자", role=UserRole.ADMIN, is_active=True)
        db.add_all([free, premium, off, gone, admin])
        db.flush()
        db.add_all([
            PushDevice(token="ExponentPushToken[free]", user_id=free.id, platform="android", fund_notice=False, post_notice=True),
            PushDevice(token="ExponentPushToken[premium]", user_id=premium.id, platform="ios", fund_notice=True, post_notice=True),
            PushDevice(token="ExponentPushToken[off]", user_id=off.id, platform="android", fund_notice=True, post_notice=False),
            PushDevice(token="ExponentPushToken[gone]", user_id=gone.id, platform="android", fund_notice=True, post_notice=True),
            PushDevice(token="ExponentPushToken[admin]", user_id=admin.id, platform="android", fund_notice=False, post_notice=True),
        ])
        board = Board(name="공지", order_index=0, min_role_required=board_role)
        db.add(board)
        db.flush()
        post = BlogPost(board_id=board.id, title="오늘의 시장", content="<p>x</p>")
        db.add(post)
        db.commit()
        return post.id


def _use(monkeypatch, sender: FakeSender) -> None:
    monkeypatch.setattr(notifications, "get_push_sender", lambda: sender)


def test_free_board_targets_active_post_notice_devices(maker, monkeypatch):
    sender = FakeSender()
    _use(monkeypatch, sender)
    pid = _seed(maker)
    out = notifications.send_new_post_notification(pid)
    tokens, msg = sender.calls[0]
    assert sorted(tokens) == [
        "ExponentPushToken[admin]", "ExponentPushToken[free]", "ExponentPushToken[premium]",
    ]  # post_notice=false·비활성 사용자는 제외, 펀드 여부(fund_notice)는 무관
    assert msg.title == "[공지] 새 글" and msg.body == "오늘의 시장"
    assert msg.data["type"] == "new_post" and msg.data["post_id"] == pid
    assert msg.channel_id == "blog-post" and msg.sound == "default"
    assert out == {"post_id": pid, "status": "ok", "recipients": 3, "success": 3, "failure": 0, "invalid": 0}


def test_premium_board_excludes_lower_roles(maker, monkeypatch):
    sender = FakeSender()
    _use(monkeypatch, sender)
    pid = _seed(maker, board_role=UserRole.PREMIUM)
    notifications.send_new_post_notification(pid)
    assert sorted(sender.calls[0][0]) == ["ExponentPushToken[admin]", "ExponentPushToken[premium]"]


def test_invalid_tokens_are_deleted(maker, monkeypatch):
    sender = FakeSender(invalid=frozenset({"ExponentPushToken[free]"}))
    _use(monkeypatch, sender)
    pid = _seed(maker)
    out = notifications.send_new_post_notification(pid)
    assert out["invalid"] == 1 and out["failure"] == 1 and out["success"] == 2
    with maker() as db:
        left = set(db.execute(select(PushDevice.token)).scalars())
    assert "ExponentPushToken[free]" not in left and "ExponentPushToken[off]" in left


def test_sender_exception_is_swallowed(maker, monkeypatch):
    sender = FakeSender(boom=True)
    _use(monkeypatch, sender)
    pid = _seed(maker)
    out = notifications.send_new_post_notification(pid)  # 예외가 밖으로 나오면 Celery 가 재시도 → 중복 발송
    assert out["status"] == "ok" and out["success"] == 0 and out["failure"] == 3
    with maker() as db:
        assert len(list(db.execute(select(PushDevice.token)).scalars())) == 5  # 아무것도 지우지 않음


def test_missing_post(maker, monkeypatch):
    sender = FakeSender()
    _use(monkeypatch, sender)
    out = notifications.send_new_post_notification(999)
    assert out["status"] == "post_not_found" and out["recipients"] == 0
    assert sender.calls == []


def test_unexpected_error_is_swallowed(maker, monkeypatch):
    def broken():
        raise RuntimeError("db down")

    monkeypatch.setattr(notifications, "SyncSessionLocal", broken)
    out = notifications.send_new_post_notification(1)
    assert out == {"post_id": 1, "status": "failed"}


def test_no_targets_skips_sender(maker, monkeypatch):
    sender = FakeSender()
    _use(monkeypatch, sender)
    with maker() as db:
        board = Board(name="빈", order_index=0)
        db.add(board)
        db.flush()
        post = BlogPost(board_id=board.id, title="t", content="c")
        db.add(post)
        db.commit()
        pid = post.id
    out = notifications.send_new_post_notification(pid)
    assert sender.calls == [] and out["recipients"] == 0 and out["status"] == "ok"

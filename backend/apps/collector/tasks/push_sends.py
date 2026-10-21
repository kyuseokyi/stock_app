"""펀드 리포트 알림 발송(blog 가 위임) + 예약 발송 beat(작업 4)."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from shared.database import SyncSessionLocal
from shared.models import PushDevice, PushSend, PushTemplate
from shared.push_text import render_push_text
from shared.sync_redis import get_sync_redis

from ..celery_app import celery_app
from ..push import PushMessage, get_push_sender
from ..push.base import BatchResult

logger = logging.getLogger("tasks.push_sends")

FUND_CHANNEL_ID = "fund-report"
NOTIFICATION_CHANNEL = "notifications"  # apps/blog/events.py 와 같은 채널
STALE_SENDING = timedelta(minutes=15)  # 이보다 오래 sending 이면 위임 실패·워커 사망으로 보고 failed 처리


def _now() -> datetime:
    return datetime.now(timezone.utc)


def publish_fund_event(ref_date: date) -> None:
    """SSE 갱신 신호(동기 Redis). 실패해도 푸시는 계속."""
    try:
        get_sync_redis().publish(
            NOTIFICATION_CHANNEL,
            json.dumps({"type": "fund_report_updated", "date": ref_date.isoformat()}, ensure_ascii=False),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("펀드 알림 SSE 발행 실패(%s): %s", ref_date, exc)


@celery_app.task(name="collector.send_fund_notice")
def send_fund_notice(send_id: int) -> dict:
    with SyncSessionLocal() as db:
        send = db.get(PushSend, send_id)
        if send is None or send.status != "sending":
            return {"send_id": send_id, "status": "skipped"}
        try:
            return _run_send(db, send, send_id)
        except Exception:  # noqa: BLE001
            # 재 raise 하지 않는다 — Celery 재시도로 중복 발송되지 않게. sending 고착(재발송 409)만 막는다.
            logger.exception("send_fund_notice: 처리 중 예외(send_id=%s)", send_id)
            try:
                db.rollback()
                failed = db.get(PushSend, send_id)
                if failed is not None:
                    failed.status = "failed"
                    failed.finished_at = _now()
                    db.commit()
            except Exception:  # noqa: BLE001
                logger.exception("send_fund_notice: failed 표시 실패(send_id=%s)", send_id)
            return {"send_id": send_id, "status": "failed"}


def _run_send(db, send: PushSend, send_id: int) -> dict:
    q = select(PushDevice.token)
    if send.mode == "test":
        q = q.where(PushDevice.user_id == send.created_by)
    else:
        q = q.where(PushDevice.fund_notice.is_(True))
    tokens = list(db.execute(q).scalars())
    send.target_count = len(tokens)
    db.commit()

    message = PushMessage(
        title=render_push_text(send.title, send.ref_date),
        body=render_push_text(send.body, send.ref_date),
        data={"type": "fund_report", "date": send.ref_date.isoformat()},
        channel_id=FUND_CHANNEL_ID,
        sound="default",
    )
    try:
        result = get_push_sender().send_batch(tokens, message)
    except Exception as exc:  # noqa: BLE001
        logger.warning("send_fund_notice: 발송기 오류(send_id=%s): %s", send_id, exc)
        result = BatchResult(failure=len(tokens))

    if result.invalid_tokens:
        db.execute(delete(PushDevice).where(PushDevice.token.in_(result.invalid_tokens)))
    send.success_count = result.success
    send.failure_count = result.failure
    send.status = "failed" if tokens and result.success == 0 else "done"
    send.finished_at = _now()
    if send.template_id is not None:
        tpl = db.get(PushTemplate, send.template_id)
        if tpl is not None:
            tpl.last_sent_at = send.finished_at
    db.commit()
    logger.info(
        "send_fund_notice: id=%s mode=%s target=%s ok=%s fail=%s invalid=%s",
        send_id, send.mode, len(tokens), result.success, result.failure, len(result.invalid_tokens),
    )
    return {"send_id": send_id, "status": send.status, "target": len(tokens), "success": result.success}


def _claim(db: Session, send_id: int, now: datetime) -> bool:
    """scheduled 일 때만 sending 으로 — 두 beat 가 겹치거나 취소와 경쟁해도 한쪽만 이긴다."""
    res = db.execute(
        update(PushSend)
        .where(PushSend.id == send_id, PushSend.status == "scheduled")
        .values(status="sending", started_at=now)
    )
    return res.rowcount == 1


@celery_app.task(name="collector.dispatch_scheduled_pushes")
def dispatch_scheduled_pushes() -> dict:
    """1분마다: 오래 멈춘 sending 정리 → 예약 시각이 지난 scheduled 를 sending 으로 집고 → SSE → 발송 위임.
    Celery eta 는 쓰지 않는다(Redis 브로커 visibility_timeout 중복 전달·취소 어려움)."""
    now = _now()
    claimed: list[tuple[int, date]] = []
    with SyncSessionLocal() as db:
        # 위임 실패·워커 사망으로 sending 이 남으면 같은 기준일 재발송이 409 로 막히므로 failed 로 확정
        stale = db.execute(
            update(PushSend)
            .where(PushSend.status == "sending", PushSend.started_at < now - STALE_SENDING)
            .values(status="failed", finished_at=now)
        ).rowcount
        if stale:
            logger.warning("dispatch_scheduled_pushes: 오래 멈춘 sending %s건 failed 처리", stale)
        due = db.execute(
            select(PushSend.id, PushSend.ref_date)
            .where(PushSend.status == "scheduled", PushSend.scheduled_at <= now)
            .order_by(PushSend.scheduled_at)
            .with_for_update(skip_locked=True)  # PostgreSQL 동시 실행 잠금(SQLite 는 무시)
        ).all()
        for send_id, ref_date in due:
            if _claim(db, send_id, now):
                claimed.append((send_id, ref_date))
        db.commit()
    for send_id, ref_date in claimed:
        publish_fund_event(ref_date)
        send_fund_notice.delay(send_id)
    if claimed:
        logger.info("dispatch_scheduled_pushes: %s건 발송 시작", len(claimed))
    return {"claimed": len(claimed), "stale_failed": stale or 0}

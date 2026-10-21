"""펀드 리포트 알림 발송(blog 가 위임) + 예약 발송 beat(작업 4)."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone

from sqlalchemy import delete, select

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

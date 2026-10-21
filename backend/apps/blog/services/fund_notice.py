"""펀드 리포트 알림 — 미리보기·발송 규칙(now/test/scheduled)·취소·템플릿."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import PushSend, PushTemplate, User

from .. import push_dispatch
from ..events import publish_event
from ..push_schemas import FundNoticeIn, PushSendOut, PushTemplateIn
from ..repositories import push_repo

MIN_SCHEDULE_LEAD = timedelta(minutes=1)


class NoticeError(Exception):
    """라우터가 HTTPException(status, {code, message}) 로 바꾼다."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=timezone.utc)


def fund_event(ref_date: date) -> dict:
    """SSE 갱신 신호 — 제목·본문·개인정보 없음."""
    return {"type": "fund_report_updated", "date": ref_date.isoformat()}


async def preview(db: AsyncSession, *, admin_id: int, ref_date: date) -> dict:
    last = await push_repo.last_active_send(db, ref_date)
    return {
        "target_count": await push_repo.count_fund_targets(db),
        "my_device_count": await push_repo.count_user_devices(db, admin_id),
        "already_sent": last is not None,
        "last_send": PushSendOut.model_validate(last) if last else None,
    }


async def create_notice(db: AsyncSession, *, admin: User, payload: FundNoticeIn) -> PushSend:
    if payload.template_id is not None and await push_repo.get_template(db, payload.template_id) is None:
        raise NoticeError(400, "template_not_found", "템플릿이 없습니다.")
    base = dict(
        mode=payload.mode, ref_date=payload.date, title=payload.title, body=payload.body,
        template_id=payload.template_id, created_by=admin.id,
    )
    now = _now()

    if payload.mode == "test":
        if await push_repo.count_user_devices(db, admin.id) == 0:
            raise NoticeError(400, "no_device", "내 기기에 등록된 알림이 없어요. 앱에서 로그인·알림 허용 후 다시 시도하세요.")
        send = await push_repo.create_send(db, status="sending", started_at=now, **base)
        push_dispatch.dispatch_fund_notice(send.id)
        return send

    scheduled_at = None
    if payload.mode == "scheduled":
        if payload.scheduled_at is None:
            raise NoticeError(400, "scheduled_at_required", "예약 시각을 입력하세요.")
        scheduled_at = _aware(payload.scheduled_at)
        if scheduled_at < now + MIN_SCHEDULE_LEAD:
            raise NoticeError(400, "scheduled_too_soon", "예약 시각은 지금부터 1분 이후여야 해요.")

    if not payload.force and await push_repo.last_active_send(db, payload.date) is not None:
        raise NoticeError(409, "already_sent", "이 기준일에 이미 보냈거나 예약된 알림이 있어요.")

    if payload.mode == "scheduled":
        return await push_repo.create_send(db, status="scheduled", scheduled_at=scheduled_at, **base)

    send = await push_repo.create_send(db, status="sending", started_at=now, **base)
    await publish_event(fund_event(payload.date))
    push_dispatch.dispatch_fund_notice(send.id)
    return send


async def cancel(db: AsyncSession, send_id: int) -> PushSend:
    if await push_repo.get_send(db, send_id) is None:
        raise NoticeError(404, "not_found", "발송 이력이 없습니다.")
    if not await push_repo.cancel_scheduled(db, send_id, _now()):
        raise NoticeError(409, "not_scheduled", "예약 상태일 때만 취소할 수 있어요.")
    send = await push_repo.get_send(db, send_id)
    await db.refresh(send)
    return send


async def history(db: AsyncSession, *, limit: int, offset: int) -> dict:
    rows, total = await push_repo.list_sends(db, limit=limit, offset=offset)
    items = [PushSendOut.model_validate(s).model_copy(update={"created_by_nickname": n}) for s, n in rows]
    return {"items": items, "total": total}


async def get_template_or_404(db: AsyncSession, template_id: int) -> PushTemplate:
    tpl = await push_repo.get_template(db, template_id)
    if tpl is None:
        raise NoticeError(404, "template_not_found", "템플릿이 없습니다.")
    return tpl


async def save_template(db: AsyncSession, payload: PushTemplateIn, template_id: int | None = None) -> PushTemplate:
    if template_id is None:
        return await push_repo.create_template(db, title=payload.title, body=payload.body)
    tpl = await get_template_or_404(db, template_id)
    return await push_repo.update_template(db, tpl, title=payload.title, body=payload.body)

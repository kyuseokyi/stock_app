"""관리자 단순 테스트 알림 — 입력한 문구를 관리자 본인 기기로. 실제 발송 경로(Celery worker)를 그대로 쓴다."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User

from .. import push_dispatch
from ..push_schemas import TestPushIn
from ..repositories import push_repo
from .fund_notice import NoticeError


async def send_test(db: AsyncSession, *, admin: User, payload: TestPushIn) -> dict:
    count = await push_repo.count_user_devices(db, admin.id)
    if count == 0:
        raise NoticeError(400, "no_device", "내 기기에 등록된 알림이 없어요. 앱에서 로그인·알림 허용 후 다시 시도하세요.")
    if not push_dispatch.dispatch_test_push(admin.id, payload.title, payload.body):
        raise NoticeError(503, "dispatch_failed", "발송 작업을 넘기지 못했어요. 잠시 후 다시 시도하세요.")
    return {"target_count": count}

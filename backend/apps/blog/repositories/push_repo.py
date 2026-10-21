"""push_devices·push_sends·push_templates DB 접근(async). 커밋까지 여기서 한다(crud.py 관례)."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import PushDevice, PushSend, PushTemplate, User

FUND_KIND = "fund_report"
# 같은 기준일 중복으로 치는 발송: 테스트가 아닌 것 중 살아 있는(취소·실패 아님) 것
DUP_MODES = ("now", "scheduled")
DUP_STATUSES = ("done", "sending", "scheduled")


async def _find_by_token(db: AsyncSession, token: str) -> PushDevice | None:
    return (await db.execute(select(PushDevice).where(PushDevice.token == token))).scalar_one_or_none()


def _apply(dev: PushDevice, *, user_id: int, platform: str, fund_notice: bool, post_notice: bool) -> None:
    dev.user_id = user_id
    dev.platform = platform
    dev.fund_notice = fund_notice
    dev.post_notice = post_notice
    dev.updated_at = func.now()  # 값이 같아도 마지막 등록 시각 갱신(오래된 토큰 정리용)


async def upsert_device(
    db: AsyncSession,
    *,
    token: str,
    user_id: int,
    platform: str,
    fund_notice: bool,
    post_notice: bool = True,
) -> None:
    """token 기준 upsert — 다른 사용자 토큰이면 소유자를 바꾼다(같은 기기에서 계정을 바꾼 경우).

    같은 token 의 PUT 이 겹쳐 insert 가 UNIQUE 위반이 나면 롤백 후 기존 행을 갱신한다(1회 재시도).
    """
    fields = {"user_id": user_id, "platform": platform, "fund_notice": fund_notice, "post_notice": post_notice}
    dev = await _find_by_token(db, token)
    if dev is None:
        db.add(PushDevice(token=token, **fields))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            dev = await _find_by_token(db, token)
            if dev is None:
                raise
            _apply(dev, **fields)
            await db.commit()
    else:
        _apply(dev, **fields)
        await db.commit()


async def delete_device(db: AsyncSession, *, token: str, user_id: int) -> None:
    """본인 토큰만 지운다. 없으면 아무 일 없음."""
    await db.execute(delete(PushDevice).where(PushDevice.token == token, PushDevice.user_id == user_id))
    await db.commit()


async def count_fund_targets(db: AsyncSession) -> int:
    q = select(func.count()).select_from(PushDevice).where(PushDevice.fund_notice.is_(True))
    return (await db.execute(q)).scalar_one()


async def count_user_devices(db: AsyncSession, user_id: int) -> int:
    q = select(func.count()).select_from(PushDevice).where(PushDevice.user_id == user_id)
    return (await db.execute(q)).scalar_one()


def _dup_filter(ref_date: date):
    return (
        PushSend.kind == FUND_KIND,
        PushSend.ref_date == ref_date,
        PushSend.mode.in_(DUP_MODES),
        PushSend.status.in_(DUP_STATUSES),
    )


async def last_active_send(db: AsyncSession, ref_date: date) -> PushSend | None:
    q = select(PushSend).where(*_dup_filter(ref_date)).order_by(PushSend.id.desc()).limit(1)
    return (await db.execute(q)).scalar_one_or_none()


async def create_send(db: AsyncSession, **fields) -> PushSend:
    send = PushSend(kind=FUND_KIND, **fields)
    db.add(send)
    await db.commit()
    await db.refresh(send)
    return send


async def get_send(db: AsyncSession, send_id: int) -> PushSend | None:
    return await db.get(PushSend, send_id)


async def cancel_scheduled(db: AsyncSession, send_id: int, now: datetime) -> bool:
    """scheduled 일 때만 cancelled — 예약 발송 beat 와 경쟁하면 먼저 바꾼 쪽만 이긴다."""
    res = await db.execute(
        update(PushSend)
        .where(PushSend.id == send_id, PushSend.status == "scheduled")
        .values(status="cancelled", finished_at=now)
    )
    await db.commit()
    return res.rowcount == 1


async def list_sends(
    db: AsyncSession, *, limit: int, offset: int
) -> tuple[list[tuple[PushSend, str | None]], int]:
    total = (await db.execute(select(func.count()).select_from(PushSend))).scalar_one()
    q = (
        select(PushSend, User.nickname)
        .outerjoin(User, User.id == PushSend.created_by)
        .order_by(PushSend.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return [(s, n) for s, n in (await db.execute(q)).all()], total


async def list_templates(db: AsyncSession) -> list[PushTemplate]:
    return list((await db.execute(select(PushTemplate).order_by(PushTemplate.id))).scalars())


async def get_template(db: AsyncSession, template_id: int) -> PushTemplate | None:
    return await db.get(PushTemplate, template_id)


async def create_template(db: AsyncSession, *, title: str, body: str) -> PushTemplate:
    tpl = PushTemplate(title=title, body=body)
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return tpl


async def update_template(db: AsyncSession, tpl: PushTemplate, *, title: str, body: str) -> PushTemplate:
    tpl.title = title
    tpl.body = body
    await db.commit()
    await db.refresh(tpl)
    return tpl


async def delete_template(db: AsyncSession, tpl: PushTemplate) -> None:
    await db.delete(tpl)
    await db.commit()

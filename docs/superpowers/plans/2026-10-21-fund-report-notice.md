# 펀드 리포트 알림(관리자 발송 · Expo 푸시 · SSE) 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬 — superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans 로 작업 단위 실행. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 관리자가 admin_web 에서 "오늘 수익률 리포트 업데이트"를 알리면, 앱이 열려 있는 기기는 SSE 로 즉시 자동 갱신하고 닫혀 있는 모바일 기기는 Expo 푸시로 알림을 받는다.

**구조:** blog 서비스(8000)에 기기 토큰·발송·템플릿 API(Router → Service → Repository)를 두고, 실제 발송은 collector Celery(`send_fund_notice`, 예약은 1분 beat)가 `ExpoPushSender` 로 한다. 갱신 신호는 기존 Redis `notifications` 채널 → SSE `/api/v1/notifications/stream` 을 그대로 쓴다(새 type `fund_report_updated`). 서버는 펀드 URL 을 모른다 — 아는 것은 "이 기기가 펀드 알림을 원한다"뿐.

**기술:** FastAPI · SQLAlchemy 2(async/sync) · Alembic · Celery · httpx · Redis / React(Vite, TS) / Expo SDK 57(expo-notifications, react-native-sse) · jest

**설계:** [`docs/superpowers/specs/2026-10-19-fund-report-notice-design.md`](../specs/2026-10-19-fund-report-notice-design.md) · **설정 가이드:** [`docs/push_notification_setup.md`](../../push_notification_setup.md)

---

## 보충 계획과 합친 실행 순서

설계 문서가 10-21 에 "백그라운드 기록·빈 날 표시"(§7.1·§7.2, §5 깨우기용 메시지, §12-9~11)로 늘어났고, 그 부분은 보충 계획 [`2026-10-21-fund-background-record.md`](2026-10-21-fund-background-record.md)(S1~S6)이 맡는다. 두 계획을 아래 순서로 **한 흐름**으로 실행한다.

| 순서 | 작업 | 비고 |
|---|---|---|
| 1 | 이 계획 작업 1~7 | 서버·관리자·웹·앱 SSE |
| 2 | 보충 S2(빈 날 표시) | 선행 없음 — 작업 8 의 재빌드 전에 끝내 두면 좋다 |
| 3 | 이 계획 작업 8(모바일 푸시) | **시작 전** 설계 §12-8: 무음 push 수신 조건(Android 데이터 전용·iOS content-available·앱 종료 상태)을 Expo 문서로 확인 |
| 4 | 보충 S1(서버 깨우기용 메시지) | 작업 3 이후면 언제든 |
| 5 | 보충 S3·S4·S5(백그라운드 기록·백업 보류·태스크 등록) | `expo-background-task`·`expo-task-manager` 설치(사용자, S3-1) → **재빌드는 S5 에서 한 번** — 작업 8-10 재빌드와 합쳐도 된다 |
| 6 | 이 계획 작업 9 + 보충 S6(문서) | 한 커밋으로 묶어도 된다 |

- 테스트 파일 이름은 보충 계획과 맞춰 `backend/tests/test_expo_push.py` 로 한다(작업 2).
- `PushMessage` 는 작업 2 에서 `title: str, body: str` 로 만들고, S1 이 `str | None = None` 으로 바꾼다(기존 키워드 호출 그대로 동작).

## 설계와 다르게 정한 것 (코드 조사 결과 반영)

| 설계 | 실제 코드 | 이 계획 |
|---|---|---|
| blog 도 Router→Service→Repository | blog 는 `routers` → `crud.py` 2단계 | CLAUDE.md 규칙대로 이번 기능만 `apps/blog/services/`·`repositories/` 신설(stock_api 선례) |
| pytest 는 일회용 PG + Redis DB 5 | aiosqlite 인메모리 + fakeredis, `dependency_overrides` | 기존 방식 따름. `FOR UPDATE SKIP LOCKED` 는 SQLite 가 무시 → **"두 번 집지 않음"은 `WHERE status='scheduled'` 조건부 UPDATE 의 rowcount 로 보장**하고 그것을 테스트 |
| httpx 모킹 respx | `httpx.MockTransport` 생성자 주입 | `ExpoPushSender(transport=...)` |
| preview 응답 camelCase | blog API 는 snake_case | `target_count`, `my_device_count`, `already_sent`, `last_send` |
| `push_sends.created_by FK users` | 회원 탈퇴가 있음 | `ondelete="SET NULL"`, nullable (탈퇴가 막히지 않게) |
| 앱 토큰 등록은 기존 http 클라이언트 | 모든 요청이 상단 진행바(trackRequest)를 띄움, 로그아웃 시 토큰이 먼저 지워짐 | 푸시 API 만 `fetch` 직접 호출 + 인증 토큰을 인자로 받음(백그라운드 진행바 없음, 로그아웃 직전 해제 가능) |
| 오류 형식 | blog 는 `detail: "문자열"` | 이번 API 는 클라이언트가 분기해야 하므로 `detail: {code, message}`(stock_api 형식) |

## 상시 규칙 (모든 작업)

- 모든 커밋은 `dev` 브랜치. `git add -A`·`git add .` 금지 — 파일을 하나씩 지정.
- 커밋 메시지 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- 테스트가 실패하면 커밋하지 않는다.
- 백엔드 테스트: `cd backend && uv run pytest -p no:warnings`(conda 환경 없음).
- 모바일 `npm install`·`npx expo install` 은 **사용자가 직접** 실행한다(작업 7-1 에서 두 패키지 한 번에).
- 하위 에이전트 지시에 넣을 것: 보고·커밋 메시지는 한국어만 / Fact-Forcing Gate 훅이 파일 첫 수정마다 거부하면 요구 사실을 제시하고 같은 호출을 다시 할 것(훅 설정·env 변경 금지) / 패키지 설치 명령 직접 실행 금지 / dev 브랜치·파일 개별 add·끝 두 줄.
- 실제 env 파일(`.env.development` 등)은 수정하지 않는다. `.env.example` 만.
- Expo 실서버를 테스트에서 호출하지 않는다(모킹).

## 파일 구조

| 파일 | 책임 |
|---|---|
| `backend/shared/models.py` (수정) | `PushDevice`, `PushSend` 모델 |
| `backend/alembic/versions/b9c0d1e2f3a4_push_devices_sends.py` (신규) | 두 테이블 + 인덱스 + 기본 템플릿 시드 |
| `backend/shared/push_text.py` (신규) | `{date}` → `M월 D일` 치환(blog·collector 공용) |
| `backend/apps/blog/push_schemas.py` (신규) | 이번 기능 pydantic 스키마 |
| `backend/apps/blog/repositories/push_repo.py` (신규) | push_devices·push_sends·push_templates DB 접근 |
| `backend/apps/blog/services/push_devices.py` (신규) | 기기 등록·해제 |
| `backend/apps/blog/services/fund_notice.py` (신규) | 미리보기·발송 규칙·취소·템플릿 |
| `backend/apps/blog/push_dispatch.py` (신규) | Celery 위임(`send_task`, 실패 삼킴) |
| `backend/apps/blog/routers/push_devices.py` (신규) | `PUT/DELETE /api/v1/push-devices` |
| `backend/apps/blog/routers/push_admin.py` (신규) | 관리자 API(fund-notices·push-sends·push-templates) |
| `backend/apps/collector/push/base.py`·`__init__.py` (수정), `expo.py` (신규) | `BatchResult`·`send_batch`, `ExpoPushSender`, `PUSH_BACKEND=expo` |
| `backend/apps/collector/tasks/push_sends.py` (신규) | `send_fund_notice`, `dispatch_scheduled_pushes` |
| `admin_web/src/pages/FundNoticesPage.tsx` 외 | 관리자 화면 |
| `web_client/src/components/NotificationToaster.tsx` (수정) | `fund_report_updated` 처리 |
| `mobile/src/features/push/*` (신규) | 설정·API·등록·핸들러·권한 시트·배너 |
| `mobile/src/features/fund/fund-signal*.ts` (신규) | 앱 SSE |

---

### 작업 1: 마이그레이션 + 모델 + `push_devices` API

**파일:**
- 수정: `backend/shared/models.py`
- 생성: `backend/alembic/versions/b9c0d1e2f3a4_push_devices_sends.py`
- 생성: `backend/apps/blog/push_schemas.py`, `backend/apps/blog/repositories/__init__.py`, `backend/apps/blog/repositories/push_repo.py`, `backend/apps/blog/services/__init__.py`, `backend/apps/blog/services/push_devices.py`, `backend/apps/blog/routers/push_devices.py`
- 수정: `backend/apps/blog/main.py:18`, `:35`
- 테스트: `backend/tests/test_push_devices_api.py`

- [ ] **1-1. 실패하는 테스트 작성** — `backend/tests/test_push_devices_api.py`

```python
"""push_devices API — 토큰 upsert·소유자 교체·본인만 삭제·형식 검증."""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog.main import app
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, PushDevice, User, UserRole

TOKEN = "ExponentPushToken[abc123]"


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def api(maker):
    state: dict = {}

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return state["user"]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, state
    app.dependency_overrides.clear()


async def _users(maker) -> tuple[User, User]:
    async with maker() as s:
        a = User(nickname="가", role=UserRole.FREE, is_active=True)
        b = User(nickname="나", role=UserRole.FREE, is_active=True)
        s.add_all([a, b])
        await s.commit()
        return a, b


async def _devices(maker) -> list[PushDevice]:
    async with maker() as s:
        return list((await s.execute(select(PushDevice))).scalars())


async def test_put_creates_then_updates(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    r = await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android", "fund_notice": True})
    assert r.status_code == 204
    r = await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android", "fund_notice": False})
    assert r.status_code == 204
    devs = await _devices(maker)
    assert len(devs) == 1 and devs[0].user_id == a.id and devs[0].fund_notice is False


async def test_put_same_token_other_user_moves_owner(api, maker):
    client, state = api
    a, b = await _users(maker)
    state["user"] = a
    await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android"})
    state["user"] = b
    await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android"})
    devs = await _devices(maker)
    assert [d.user_id for d in devs] == [b.id]


async def test_put_rejects_non_expo_token(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    r = await client.put("/api/v1/push-devices", json={"token": "hello", "platform": "android"})
    assert r.status_code == 422


async def test_delete_only_own_token(api, maker):
    client, state = api
    a, b = await _users(maker)
    state["user"] = a
    await client.put("/api/v1/push-devices", json={"token": TOKEN, "platform": "android"})
    state["user"] = b
    r = await client.delete(f"/api/v1/push-devices/{TOKEN}")
    assert r.status_code == 204
    assert len(await _devices(maker)) == 1  # 남의 토큰은 그대로
    state["user"] = a
    r = await client.delete(f"/api/v1/push-devices/{TOKEN}")
    assert r.status_code == 204
    assert await _devices(maker) == []


async def test_delete_missing_is_204(api, maker):
    client, state = api
    a, _ = await _users(maker)
    state["user"] = a
    assert (await client.delete("/api/v1/push-devices/ExponentPushToken[none]")).status_code == 204
```

- [ ] **1-2. 실패 확인**

실행: `cd backend && uv run pytest -p no:warnings tests/test_push_devices_api.py`
예상: `ImportError: cannot import name 'PushDevice'`

- [ ] **1-3. 모델 추가** — `backend/shared/models.py`

`from datetime import datetime`(13행)을 다음으로 바꾼다:
```python
from datetime import date, datetime
```
`from sqlalchemy import (...)`(15~26행) 목록에 `Date,` 와 `Index,` 와 `true,` 를 알파벳 위치에 추가한다(결과: `Boolean, CheckConstraint, Date, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, true`).

파일 맨 끝에 추가:
```python
class PushDevice(Base, TimestampMixin):
    """기기 단위 Expo 푸시 토큰. 펀드 알림은 기기 조건(펀드 등록 기기)이라 users.fcm_token 과 별개."""

    __tablename__ = "push_devices"
    __table_args__ = (
        CheckConstraint("platform IN ('android', 'ios')", name="ck_push_devices_platform"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    fund_notice: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true(), nullable=False
    )


class PushSend(Base):
    """관리자 푸시 발송 1건(즉시·테스트·예약). 상태: scheduled → sending → done|failed, scheduled → cancelled."""

    __tablename__ = "push_sends"
    __table_args__ = (
        Index("ix_push_sends_status_scheduled_at", "status", "scheduled_at"),
        Index("ix_push_sends_kind_ref_date", "kind", "ref_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    ref_date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    body: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    target_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    success_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    failure_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("push_templates.id", ondelete="SET NULL")
    )
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

- [ ] **1-4. 마이그레이션** — `backend/alembic/versions/b9c0d1e2f3a4_push_devices_sends.py`

```python
"""펀드 리포트 알림 — push_devices(기기 토큰) · push_sends(발송 이력) + 기본 템플릿

Revision ID: b9c0d1e2f3a4
Revises: f3a4b5c6d7e8
Create Date: 2026-10-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b9c0d1e2f3a4"
down_revision = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None

SEED_TITLE = "수익률 리포트 업데이트"
SEED_BODY = "{date} 수익률 리포트가 올라왔어요"


def upgrade() -> None:
    op.create_table(
        "push_devices",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("token", sa.String(255), nullable=False, unique=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column("fund_notice", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("platform IN ('android', 'ios')", name="ck_push_devices_platform"),
    )
    op.create_index("ix_push_devices_user_id", "push_devices", ["user_id"])
    op.create_table(
        "push_sends",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("ref_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("body", sa.String(500), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("target_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("success_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("failure_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("template_id", sa.Integer(), sa.ForeignKey("push_templates.id", ondelete="SET NULL")),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_push_sends_status_scheduled_at", "push_sends", ["status", "scheduled_at"])
    op.create_index("ix_push_sends_kind_ref_date", "push_sends", ["kind", "ref_date"])
    op.execute(
        sa.text("INSERT INTO push_templates (title, body) VALUES (:t, :b)").bindparams(t=SEED_TITLE, b=SEED_BODY)
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM push_templates WHERE title = :t AND body = :b").bindparams(t=SEED_TITLE, b=SEED_BODY)
    )
    op.drop_index("ix_push_sends_kind_ref_date", table_name="push_sends")
    op.drop_index("ix_push_sends_status_scheduled_at", table_name="push_sends")
    op.drop_table("push_sends")
    op.drop_index("ix_push_devices_user_id", table_name="push_devices")
    op.drop_table("push_devices")
```

head 가 하나인지 확인: `cd backend && grep -rl 'down_revision = "f3a4b5c6d7e8"' alembic/versions` → 이 파일 하나만 나와야 한다.
(확인 완료: `push_templates` 의 `created_at`·`updated_at` 은 초기 마이그레이션 `3df33e164159` 에서 `server_default=now()` — 시드 INSERT 는 title·body 만 넣으면 된다.)

- [ ] **1-5. 스키마** — `backend/apps/blog/push_schemas.py`

```python
"""펀드 리포트 알림 — 기기 토큰·발송·템플릿 스키마(snake_case, blog 관례)."""
from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

EXPO_TOKEN_PATTERN = r"^Expo(nent)?PushToken\[.+\]$"


class PushDeviceIn(BaseModel):
    token: str = Field(min_length=1, max_length=255, pattern=EXPO_TOKEN_PATTERN)
    platform: Literal["android", "ios"]
    fund_notice: bool = True
```

- [ ] **1-6. 저장소** — `backend/apps/blog/repositories/__init__.py` 는 빈 파일. `backend/apps/blog/repositories/push_repo.py`:

```python
"""push_devices·push_sends·push_templates DB 접근(async). 커밋까지 여기서 한다(crud.py 관례)."""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import PushDevice


async def upsert_device(
    db: AsyncSession, *, token: str, user_id: int, platform: str, fund_notice: bool
) -> PushDevice:
    """token 기준 upsert — 다른 사용자 토큰이면 소유자를 바꾼다(같은 기기에서 계정을 바꾼 경우)."""
    dev = (await db.execute(select(PushDevice).where(PushDevice.token == token))).scalar_one_or_none()
    if dev is None:
        dev = PushDevice(token=token, user_id=user_id, platform=platform, fund_notice=fund_notice)
        db.add(dev)
    else:
        dev.user_id = user_id
        dev.platform = platform
        dev.fund_notice = fund_notice
    await db.commit()
    await db.refresh(dev)
    return dev


async def delete_device(db: AsyncSession, *, token: str, user_id: int) -> None:
    """본인 토큰만 지운다. 없으면 아무 일 없음."""
    await db.execute(delete(PushDevice).where(PushDevice.token == token, PushDevice.user_id == user_id))
    await db.commit()
```

- [ ] **1-7. 서비스** — `backend/apps/blog/services/__init__.py` 는 빈 파일. `backend/apps/blog/services/push_devices.py`:

```python
"""기기 푸시 토큰 등록·해제."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from ..push_schemas import PushDeviceIn
from ..repositories import push_repo


async def register(db: AsyncSession, *, user_id: int, payload: PushDeviceIn) -> None:
    await push_repo.upsert_device(
        db, token=payload.token, user_id=user_id, platform=payload.platform, fund_notice=payload.fund_notice
    )


async def unregister(db: AsyncSession, *, user_id: int, token: str) -> None:
    await push_repo.delete_device(db, token=token, user_id=user_id)
```

- [ ] **1-8. 라우터** — `backend/apps/blog/routers/push_devices.py`

```python
"""기기 푸시 토큰 — 로그인 사용자 본인 기기만."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User

from ..push_schemas import PushDeviceIn
from ..services import push_devices

router = APIRouter(prefix="/api/v1/push-devices", tags=["push"])


@router.put("", status_code=status.HTTP_204_NO_CONTENT)
async def put_device(
    payload: PushDeviceIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> Response:
    await push_devices.register(db, user_id=user.id, payload=payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    token: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> Response:
    await push_devices.unregister(db, user_id=user.id, token=token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

`backend/apps/blog/main.py` 18행을:
```python
from .routers import blogs, boards, comments, notifications, push_devices
```
35행 `app.include_router(notifications.router)` 아래에:
```python
app.include_router(push_devices.router)
```

- [ ] **1-9. 통과 확인**

실행: `cd backend && uv run pytest -p no:warnings tests/test_push_devices_api.py`
예상: `5 passed`
이어서 전체: `cd backend && uv run pytest -p no:warnings` → 실패 0.

- [ ] **1-9b. 마이그레이션 실제 PostgreSQL 확인(일회용 컨테이너)**

pytest 는 SQLite `create_all` 이라 마이그레이션 파일(`sa.true()`·시드 INSERT·인덱스)을 실행하지 않는다 — 배포 때 처음 돌다 깨지지 않게 여기서 확인한다(메모리 local-smoke-test-isolation 방식).

```bash
docker run -d --rm --name push-mig-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=mig -p 55432:5432 postgres:16
for i in $(seq 1 30); do docker exec push-mig-pg pg_isready -U postgres -q && break; perl -e 'select(undef,undef,undef,1)'; done
cd backend
export ALEMBIC_DATABASE_URL=postgresql+psycopg2://postgres:pw@localhost:55432/mig
uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head
docker exec push-mig-pg psql -U postgres -d mig -Atc "select count(*) from push_templates; select column_default from information_schema.columns where table_name='push_devices' and column_name='fund_notice';"
unset ALEMBIC_DATABASE_URL
docker stop push-mig-pg
```
예상: 세 alembic 명령 모두 오류 없음, `push_templates` 1행(시드), `fund_notice` 기본값 `true`. 컨테이너는 `--rm` 이라 stop 으로 사라진다. 실패하면 마이그레이션을 고치고 다시 — 커밋하지 않는다.

- [ ] **1-10. 커밋**

```bash
git add backend/shared/models.py backend/alembic/versions/b9c0d1e2f3a4_push_devices_sends.py \
  backend/apps/blog/push_schemas.py backend/apps/blog/repositories/__init__.py \
  backend/apps/blog/repositories/push_repo.py backend/apps/blog/services/__init__.py \
  backend/apps/blog/services/push_devices.py backend/apps/blog/routers/push_devices.py \
  backend/apps/blog/main.py backend/tests/test_push_devices_api.py
git commit -m "feat(blog): 푸시 기기 토큰 등록·해제 API + push_devices·push_sends 테이블

(끝 두 줄 규칙 적용)"
```

---

### 작업 2: `ExpoPushSender` + `send_batch` + `{date}` 치환

**파일:**
- 수정: `backend/apps/collector/push/base.py`, `backend/apps/collector/push/__init__.py`
- 생성: `backend/apps/collector/push/expo.py`, `backend/shared/push_text.py`
- 수정: `backend/.env.example`(69~71행)
- 테스트: `backend/tests/test_expo_push.py`, `backend/tests/test_push_text.py`

- [ ] **2-1. 실패하는 테스트** — `backend/tests/test_push_text.py`

```python
from datetime import date

from shared.push_text import render_push_text


def test_date_placeholder_becomes_month_day():
    assert render_push_text("{date} 수익률 리포트가 올라왔어요", date(2026, 3, 5)) == "3월 5일 수익률 리포트가 올라왔어요"


def test_text_without_placeholder_unchanged():
    assert render_push_text("공지", date(2026, 10, 21)) == "공지"
```

`backend/tests/test_expo_push.py`:

```python
"""ExpoPushSender — 100개 분할·Bearer·DeviceNotRegistered·네트워크 오류(httpx.MockTransport)."""
from __future__ import annotations

import json

import httpx

from apps.collector.push import get_push_sender
from apps.collector.push.base import BatchResult, PushMessage, PushSender
from apps.collector.push.expo import EXPO_PUSH_URL, ExpoPushSender

MSG = PushMessage(title="제목", body="본문", data={"type": "fund_report"}, channel_id="fund-report", sound="default")


def _ok_transport(calls: list[httpx.Request], error_for: set[str] = frozenset()) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        tickets = []
        for m in json.loads(request.content):
            if m["to"] in error_for:
                tickets.append({"status": "error", "message": "x", "details": {"error": "DeviceNotRegistered"}})
            else:
                tickets.append({"status": "ok", "id": "t"})
        return httpx.Response(200, json={"data": tickets})

    return httpx.MockTransport(handler)


def test_splits_into_chunks_of_100_and_counts_success():
    calls: list[httpx.Request] = []
    tokens = [f"ExponentPushToken[{i}]" for i in range(250)]
    r = ExpoPushSender(access_token="", transport=_ok_transport(calls)).send_batch(tokens, MSG)
    assert [len(json.loads(c.content)) for c in calls] == [100, 100, 50]
    assert (r.success, r.failure, r.invalid_tokens) == (250, 0, [])
    assert str(calls[0].url) == EXPO_PUSH_URL


def test_payload_has_channel_sound_data():
    calls: list[httpx.Request] = []
    ExpoPushSender(access_token="", transport=_ok_transport(calls)).send_batch(["ExponentPushToken[a]"], MSG)
    m = json.loads(calls[0].content)[0]
    assert m == {
        "to": "ExponentPushToken[a]", "title": "제목", "body": "본문",
        "data": {"type": "fund_report"}, "channelId": "fund-report", "sound": "default",
    }


def test_bearer_only_when_access_token_set():
    calls: list[httpx.Request] = []
    ExpoPushSender(access_token="secret", transport=_ok_transport(calls)).send_batch(["ExponentPushToken[a]"], MSG)
    ExpoPushSender(access_token="", transport=_ok_transport(calls)).send_batch(["ExponentPushToken[a]"], MSG)
    assert calls[0].headers["authorization"] == "Bearer secret"
    assert "authorization" not in calls[1].headers


def test_device_not_registered_is_invalid_and_failure():
    calls: list[httpx.Request] = []
    bad = "ExponentPushToken[bad]"
    r = ExpoPushSender(access_token="", transport=_ok_transport(calls, {bad})).send_batch(
        ["ExponentPushToken[a]", bad], MSG
    )
    assert (r.success, r.failure, r.invalid_tokens) == (1, 1, [bad])


def test_network_error_counts_whole_chunk_as_failure():
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    r = ExpoPushSender(access_token="", transport=httpx.MockTransport(boom)).send_batch(
        ["ExponentPushToken[a]", "ExponentPushToken[b]"], MSG
    )
    assert (r.success, r.failure) == (0, 2)


def test_http_500_counts_as_failure():
    r = ExpoPushSender(
        access_token="", transport=httpx.MockTransport(lambda req: httpx.Response(500))
    ).send_batch(["ExponentPushToken[a]"], MSG)
    assert (r.success, r.failure) == (0, 1)


def test_empty_tokens_makes_no_request():
    calls: list[httpx.Request] = []
    assert ExpoPushSender(access_token="", transport=_ok_transport(calls)).send_batch([], MSG) == BatchResult()
    assert calls == []


def test_default_send_batch_uses_send():
    class Half(PushSender):
        def send(self, token, message):
            return token.endswith("ok]")

    r = Half().send_batch(["ExponentPushToken[ok]", "ExponentPushToken[no]"], MSG)
    assert (r.success, r.failure, r.invalid_tokens) == (1, 1, [])


def test_factory_returns_expo(monkeypatch):
    monkeypatch.setenv("PUSH_BACKEND", "expo")
    assert isinstance(get_push_sender(), ExpoPushSender)
```

- [ ] **2-2. 실패 확인**

실행: `cd backend && uv run pytest -p no:warnings tests/test_push_text.py tests/test_expo_push.py`
예상: `ModuleNotFoundError: No module named 'shared.push_text'` 와 `apps.collector.push.expo`

- [ ] **2-3. 구현** — `backend/shared/push_text.py`

```python
"""푸시 문구 치환 — blog(미리보기)·collector(발송 직전) 공용."""
from __future__ import annotations

from datetime import date


def render_push_text(text: str, ref_date: date) -> str:
    """`{date}` 를 `M월 D일` 로 바꾼다(예: 3월 5일)."""
    return text.replace("{date}", f"{ref_date.month}월 {ref_date.day}일")
```

`backend/apps/collector/push/base.py` 전체를 다음으로 바꾼다(기존 `send`·`send_multicast` 동작 유지, 새 필드는 기본값이 있어 기존 호출부 영향 없음):

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class PushMessage:
    title: str
    body: str
    data: dict = field(default_factory=dict)  # 딥링크 등 부가 데이터
    channel_id: str | None = None  # Android 알림 채널(Expo channelId)
    sound: str | None = None


@dataclass
class BatchResult:
    success: int = 0
    failure: int = 0
    invalid_tokens: list[str] = field(default_factory=list)  # 앱 삭제 등으로 무효가 된 토큰(서버가 지운다)


class PushSender(ABC):
    @abstractmethod
    def send(self, token: str, message: PushMessage) -> bool:
        """단건 발송. 성공 시 True."""
        raise NotImplementedError

    def send_multicast(self, tokens: list[str], message: PushMessage) -> int:
        """다건 발송. 성공 건수를 반환한다. (기본은 단건 반복)"""
        return sum(1 for t in tokens if self.send(t, message))

    def send_batch(self, tokens: list[str], message: PushMessage) -> BatchResult:
        """다건 발송 + 성공·실패·무효 토큰. 기본은 단건 반복(무효 토큰 판별 없음)."""
        result = BatchResult()
        for t in tokens:
            if self.send(t, message):
                result.success += 1
            else:
                result.failure += 1
        return result
```

`backend/apps/collector/push/expo.py`:

```python
"""Expo Push 발송기 — 서버는 Expo 에만 보내고 Expo 가 FCM(Android)·APNs(iOS)로 전달한다."""
from __future__ import annotations

import logging
import os

import httpx

from .base import BatchResult, PushMessage, PushSender

logger = logging.getLogger("push.expo")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
CHUNK_SIZE = 100  # Expo 한 요청 최대 메시지 수


class ExpoPushSender(PushSender):
    def __init__(
        self,
        access_token: str | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 10.0,
    ) -> None:
        # Expo 계정에서 "Enhanced push security" 를 켠 경우에만 필요
        self.access_token = os.getenv("EXPO_ACCESS_TOKEN", "") if access_token is None else access_token
        self._transport = transport
        self._timeout = timeout

    def send(self, token: str, message: PushMessage) -> bool:
        return self.send_batch([token], message).success == 1

    def send_batch(self, tokens: list[str], message: PushMessage) -> BatchResult:
        result = BatchResult()
        if not tokens:
            return result
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        with httpx.Client(transport=self._transport, timeout=self._timeout) as client:
            for i in range(0, len(tokens), CHUNK_SIZE):
                chunk = tokens[i : i + CHUNK_SIZE]
                try:
                    resp = client.post(EXPO_PUSH_URL, json=[_payload(t, message) for t in chunk], headers=headers)
                    resp.raise_for_status()
                    tickets = resp.json().get("data") or []
                except (httpx.HTTPError, ValueError) as exc:
                    # 재시도 없음 — 관리자가 이력의 실패 수를 보고 다시 보낸다
                    logger.warning("expo push 묶음 실패(%s건): %s", len(chunk), exc)
                    result.failure += len(chunk)
                    continue
                for token, ticket in zip(chunk, tickets):
                    if ticket.get("status") == "ok":
                        result.success += 1
                        continue
                    result.failure += 1
                    if (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                        result.invalid_tokens.append(token)
                result.failure += max(0, len(chunk) - len(tickets))
        return result


def _payload(token: str, message: PushMessage) -> dict:
    m: dict = {"to": token, "title": message.title, "body": message.body, "data": message.data}
    if message.channel_id:
        m["channelId"] = message.channel_id
    if message.sound:
        m["sound"] = message.sound
    return m
```

`backend/apps/collector/push/__init__.py` 의 `get_push_sender` 를 다음으로 바꾼다:

```python
def get_push_sender() -> PushSender:
    backend = os.getenv("PUSH_BACKEND", "mock").lower()
    if backend == "expo":
        from .expo import ExpoPushSender

        return ExpoPushSender()
    if backend == "fcm":
        from .fcm import FcmPushSender

        return FcmPushSender()
    return MockPushSender()
```
같은 파일 `__all__` 에 `"BatchResult"` 를 추가하고 import 를 `from .base import BatchResult, PushMessage, PushSender` 로 바꾼다.

`backend/.env.example` 69~71행(`# --- 푸시(FCM) ---` 블록)을 다음으로 바꾼다(키 이름·주석만, 실제 값 없음):
```
# --- 푸시 ---
# mock(기본, 로그만) | expo(실발송: Expo Push → FCM/APNs) | fcm(미구현 스켈레톤)
PUSH_BACKEND=mock
# Expo 계정 "Enhanced push security" 를 켰을 때만 필요(docs/push_notification_setup.md 6장)
# EXPO_ACCESS_TOKEN=
# FCM_CREDENTIALS_PATH=
```

- [ ] **2-4. 통과 확인**

실행: `cd backend && uv run pytest -p no:warnings tests/test_push_text.py tests/test_expo_push.py`
예상: `11 passed`. 이어서 전체 `uv run pytest -p no:warnings` 실패 0(새 글 알림 테스트 포함 — `send_multicast` 그대로).

- [ ] **2-5. 커밋**

```bash
git add backend/shared/push_text.py backend/apps/collector/push/base.py backend/apps/collector/push/__init__.py \
  backend/apps/collector/push/expo.py backend/.env.example backend/tests/test_push_text.py backend/tests/test_expo_push.py
git commit -m "feat(collector): Expo Push 발송기(PUSH_BACKEND=expo) + send_batch·무효 토큰 판별

(끝 두 줄 규칙 적용)"
```

---

### 작업 3: 관리자 API + `send_fund_notice` + SSE 발행

**파일:**
- 수정: `backend/apps/blog/push_schemas.py`, `backend/apps/blog/repositories/push_repo.py`, `backend/apps/blog/main.py`
- 생성: `backend/apps/blog/push_dispatch.py`, `backend/apps/blog/services/fund_notice.py`, `backend/apps/blog/routers/push_admin.py`, `backend/apps/collector/tasks/push_sends.py`
- 수정: `backend/apps/collector/celery_app.py`(include)
- 테스트: `backend/tests/test_fund_notice_api.py`, `backend/tests/test_push_sends_task.py`

- [ ] **3-1. 실패하는 API 테스트** — `backend/tests/test_fund_notice_api.py`

```python
"""관리자 펀드 알림 API — 권한·검증·중복 409·force·test·예약·취소·이력·템플릿·SSE."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog import push_dispatch
from apps.blog.main import app
from apps.blog.services import fund_notice
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, PushDevice, PushSend, PushTemplate, User, UserRole

TODAY = date(2026, 10, 21)


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
def spies(monkeypatch):
    calls = {"dispatched": [], "published": []}
    monkeypatch.setattr(
        push_dispatch.celery_app, "send_task", lambda name, args=None, **kw: calls["dispatched"].append((name, args))
    )

    async def _publish(ev):
        calls["published"].append(ev)

    monkeypatch.setattr(fund_notice, "publish_event", _publish)
    return calls


@pytest.fixture
async def api(maker, spies):
    state: dict = {}

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return state["user"]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, state
    app.dependency_overrides.clear()


async def _seed(maker, *, admin_devices: int = 1, fans: int = 2) -> tuple[User, User]:
    async with maker() as s:
        admin = User(nickname="관리자", role=UserRole.ADMIN, is_active=True)
        user = User(nickname="일반", role=UserRole.FREE, is_active=True)
        s.add_all([admin, user])
        await s.flush()
        for i in range(admin_devices):
            s.add(PushDevice(token=f"ExponentPushToken[a{i}]", user_id=admin.id, platform="android", fund_notice=False))
        for i in range(fans):
            s.add(PushDevice(token=f"ExponentPushToken[u{i}]", user_id=user.id, platform="android", fund_notice=True))
        await s.commit()
        return admin, user


def _body(**kw) -> dict:
    return {"date": TODAY.isoformat(), "title": "수익률 리포트 업데이트", "body": "{date} 리포트", "mode": "now", **kw}


async def _sends(maker) -> list[PushSend]:
    async with maker() as s:
        return list((await s.execute(select(PushSend).order_by(PushSend.id))).scalars())


async def test_non_admin_forbidden(api, maker):
    client, state = api
    _, user = await _seed(maker)
    state["user"] = user
    assert (await client.post("/api/v1/admin/fund-notices", json=_body())).status_code == 403
    assert (await client.get("/api/v1/admin/push-sends")).status_code == 403


async def test_blank_title_rejected(api, maker):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    assert (await client.post("/api/v1/admin/fund-notices", json=_body(title="   "))).status_code == 422


async def test_now_creates_sending_publishes_and_dispatches(api, maker, spies):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    r = await client.post("/api/v1/admin/fund-notices", json=_body())
    assert r.status_code == 201
    assert r.json()["status"] == "sending" and r.json()["mode"] == "now"
    assert spies["published"] == [{"type": "fund_report_updated", "date": "2026-10-21"}]
    assert spies["dispatched"] == [("collector.send_fund_notice", [r.json()["id"]])]


async def test_now_twice_is_409_unless_force(api, maker, spies):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    await client.post("/api/v1/admin/fund-notices", json=_body())
    r = await client.post("/api/v1/admin/fund-notices", json=_body())
    assert r.status_code == 409 and r.json()["detail"]["code"] == "already_sent"
    assert (await client.post("/api/v1/admin/fund-notices", json=_body(force=True))).status_code == 201


async def test_test_mode_no_dup_check_no_sse(api, maker, spies):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    await client.post("/api/v1/admin/fund-notices", json=_body())
    spies["published"].clear()
    r = await client.post("/api/v1/admin/fund-notices", json=_body(mode="test"))
    assert r.status_code == 201 and r.json()["mode"] == "test"
    assert spies["published"] == []


async def test_test_mode_without_device_400(api, maker):
    client, state = api
    admin, _ = await _seed(maker, admin_devices=0)
    state["user"] = admin
    r = await client.post("/api/v1/admin/fund-notices", json=_body(mode="test"))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "no_device"


async def test_scheduled_past_rejected_future_saved(api, maker, spies):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    soon = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
    r = await client.post("/api/v1/admin/fund-notices", json=_body(mode="scheduled", scheduled_at=soon))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "scheduled_too_soon"
    future = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    r = await client.post("/api/v1/admin/fund-notices", json=_body(mode="scheduled", scheduled_at=future))
    assert r.status_code == 201 and r.json()["status"] == "scheduled"
    assert spies["published"] == [] and spies["dispatched"] == []
    # 예약도 같은 날 중복으로 센다
    assert (await client.post("/api/v1/admin/fund-notices", json=_body())).status_code == 409


async def test_cancel_only_scheduled(api, maker):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    future = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    sid = (await client.post("/api/v1/admin/fund-notices", json=_body(mode="scheduled", scheduled_at=future))).json()["id"]
    assert (await client.post(f"/api/v1/admin/push-sends/{sid}/cancel")).status_code == 200
    r = await client.post(f"/api/v1/admin/push-sends/{sid}/cancel")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_scheduled"
    assert (await client.post("/api/v1/admin/push-sends/999/cancel")).status_code == 404
    assert (await _sends(maker))[0].status == "cancelled"


async def test_preview_counts(api, maker):
    client, state = api
    admin, _ = await _seed(maker, admin_devices=1, fans=3)
    state["user"] = admin
    r = await client.get("/api/v1/admin/fund-notices/preview", params={"date": TODAY.isoformat()})
    assert r.json() == {"target_count": 3, "my_device_count": 1, "already_sent": False, "last_send": None}
    await client.post("/api/v1/admin/fund-notices", json=_body())
    r = await client.get("/api/v1/admin/fund-notices/preview", params={"date": TODAY.isoformat()})
    assert r.json()["already_sent"] is True and r.json()["last_send"]["status"] == "sending"


async def test_history_newest_first_with_sender(api, maker):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    await client.post("/api/v1/admin/fund-notices", json=_body(mode="test"))
    await client.post("/api/v1/admin/fund-notices", json=_body())
    r = (await client.get("/api/v1/admin/push-sends", params={"limit": 10})).json()
    assert r["total"] == 2
    assert [i["mode"] for i in r["items"]] == ["now", "test"]
    assert r["items"][0]["created_by_nickname"] == "관리자"


async def test_templates_crud_and_unknown_template_rejected(api, maker):
    client, state = api
    admin, _ = await _seed(maker)
    state["user"] = admin
    t = (await client.post("/api/v1/admin/push-templates", json={"title": "제목", "body": "{date} 본문"})).json()
    r = await client.put(f"/api/v1/admin/push-templates/{t['id']}", json={"title": "새 제목", "body": "본문"})
    assert r.json()["title"] == "새 제목"
    assert [x["id"] for x in (await client.get("/api/v1/admin/push-templates")).json()] == [t["id"]]
    r = await client.post("/api/v1/admin/fund-notices", json=_body(template_id=999))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "template_not_found"
    assert (await client.delete(f"/api/v1/admin/push-templates/{t['id']}")).status_code == 204
    async with maker() as s:
        assert (await s.execute(select(PushTemplate))).scalars().all() == []
```

- [ ] **3-2. 실패하는 태스크 테스트** — `backend/tests/test_push_sends_task.py`

```python
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
```

- [ ] **3-3. 실패 확인**

실행: `cd backend && uv run pytest -p no:warnings tests/test_fund_notice_api.py tests/test_push_sends_task.py`
예상: `ImportError`(`push_dispatch`, `fund_notice`, `push_sends` 없음)

- [ ] **3-4. 스키마 추가** — `backend/apps/blog/push_schemas.py` 끝에 추가

```python
class FundNoticeIn(BaseModel):
    date: dt.date
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=500)
    mode: Literal["now", "test", "scheduled"]
    scheduled_at: dt.datetime | None = None
    template_id: int | None = None
    force: bool = False

    @field_validator("title", "body")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("공백만 입력할 수 없습니다.")
        return v


class PushSendOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    mode: str
    ref_date: dt.date
    title: str
    body: str
    status: str
    scheduled_at: dt.datetime | None
    started_at: dt.datetime | None
    finished_at: dt.datetime | None
    target_count: int
    success_count: int
    failure_count: int
    template_id: int | None
    created_by: int | None
    created_by_nickname: str | None = None
    created_at: dt.datetime


class PushSendListOut(BaseModel):
    items: list[PushSendOut]
    total: int


class FundNoticePreviewOut(BaseModel):
    target_count: int
    my_device_count: int
    already_sent: bool
    last_send: PushSendOut | None


class PushTemplateIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=500)

    @field_validator("title", "body")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("공백만 입력할 수 없습니다.")
        return v


class PushTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: str
    last_sent_at: dt.datetime | None
    created_at: dt.datetime
    updated_at: dt.datetime
```

- [ ] **3-5. 저장소 함수 추가** — `backend/apps/blog/repositories/push_repo.py`

import 를 다음으로 바꾼다:
```python
from datetime import date, datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import PushDevice, PushSend, PushTemplate, User

FUND_KIND = "fund_report"
# 같은 기준일 중복으로 치는 발송: 테스트가 아닌 것 중 살아 있는(취소·실패 아님) 것
DUP_MODES = ("now", "scheduled")
DUP_STATUSES = ("done", "sending", "scheduled")
```
파일 끝에 추가:
```python
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
```

- [ ] **3-6. Celery 위임** — `backend/apps/blog/push_dispatch.py`

```python
"""blog → collector 발송 위임(새 글 알림과 같은 방식). 위임 실패는 삼키고 로그만 — 이력에 sending 으로 남는다."""
from __future__ import annotations

import logging

from apps.collector.celery_app import celery_app

logger = logging.getLogger("blog.push_dispatch")


def dispatch_fund_notice(send_id: int) -> None:
    try:
        celery_app.send_task("collector.send_fund_notice", args=[send_id])
    except Exception as exc:  # noqa: BLE001
        logger.warning("펀드 알림 발송 위임 실패 (send_id=%s): %s", send_id, exc)
```

- [ ] **3-7. 서비스** — `backend/apps/blog/services/fund_notice.py`

```python
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
```

- [ ] **3-8. 라우터** — `backend/apps/blog/routers/push_admin.py`

```python
"""관리자 — 펀드 리포트 알림 발송·이력·템플릿."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User

from ..push_schemas import (
    FundNoticeIn,
    FundNoticePreviewOut,
    PushSendListOut,
    PushSendOut,
    PushTemplateIn,
    PushTemplateOut,
)
from ..repositories import push_repo
from ..services import fund_notice
from ..services.fund_notice import NoticeError

router = APIRouter(prefix="/api/v1/admin", tags=["push-admin"])


def _http(e: NoticeError) -> HTTPException:
    return HTTPException(e.status, detail={"code": e.code, "message": e.message})


@router.get("/fund-notices/preview", response_model=FundNoticePreviewOut)
async def preview(
    date_: date = Query(alias="date"), db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)
):
    return await fund_notice.preview(db, admin_id=admin.id, ref_date=date_)


@router.post("/fund-notices", response_model=PushSendOut, status_code=status.HTTP_201_CREATED)
async def create_notice(
    payload: FundNoticeIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)
):
    try:
        return await fund_notice.create_notice(db, admin=admin, payload=payload)
    except NoticeError as e:
        raise _http(e) from e


@router.post("/push-sends/{send_id}/cancel", response_model=PushSendOut)
async def cancel_send(send_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    try:
        return await fund_notice.cancel(db, send_id)
    except NoticeError as e:
        raise _http(e) from e


@router.get("/push-sends", response_model=PushSendListOut)
async def list_sends(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return await fund_notice.history(db, limit=limit, offset=offset)


@router.get("/push-templates", response_model=list[PushTemplateOut])
async def list_templates(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    return await push_repo.list_templates(db)


@router.post("/push-templates", response_model=PushTemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(
    payload: PushTemplateIn, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)
):
    return await fund_notice.save_template(db, payload)


@router.put("/push-templates/{template_id}", response_model=PushTemplateOut)
async def update_template(
    template_id: int, payload: PushTemplateIn, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)
):
    try:
        return await fund_notice.save_template(db, payload, template_id)
    except NoticeError as e:
        raise _http(e) from e


@router.delete("/push-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    try:
        tpl = await fund_notice.get_template_or_404(db, template_id)
    except NoticeError as e:
        raise _http(e) from e
    await push_repo.delete_template(db, tpl)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

`backend/apps/blog/main.py` 18행을 `from .routers import blogs, boards, comments, notifications, push_admin, push_devices` 로, `app.include_router(push_devices.router)` 아래에 `app.include_router(push_admin.router)` 추가.

- [ ] **3-9. Celery 태스크** — `backend/apps/collector/tasks/push_sends.py`

```python
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
```

`backend/apps/collector/celery_app.py` 의 `include=[...]` 목록 끝(`"apps.collector.tasks.market_groups",` 다음)에 `"apps.collector.tasks.push_sends",` 추가.

- [ ] **3-10. 통과 확인**

실행: `cd backend && uv run pytest -p no:warnings tests/test_fund_notice_api.py tests/test_push_sends_task.py`
예상: `18 passed`. 이어서 전체 실패 0.

- [ ] **3-11. 커밋**

```bash
git add backend/apps/blog/push_schemas.py backend/apps/blog/repositories/push_repo.py backend/apps/blog/push_dispatch.py \
  backend/apps/blog/services/fund_notice.py backend/apps/blog/routers/push_admin.py backend/apps/blog/main.py \
  backend/apps/collector/tasks/push_sends.py backend/apps/collector/celery_app.py \
  backend/tests/test_fund_notice_api.py backend/tests/test_push_sends_task.py
git commit -m "feat(blog,collector): 펀드 리포트 알림 관리자 API(미리보기·즉시·테스트·예약·취소·이력·템플릿) + 발송 태스크

(끝 두 줄 규칙 적용)"
```

---

### 작업 4: 예약 발송 beat

**파일:**
- 수정: `backend/apps/collector/tasks/push_sends.py`, `backend/apps/collector/celery_app.py`(beat_schedule)
- 테스트: `backend/tests/test_push_sends_task.py`(추가)

- [ ] **4-1. 실패하는 테스트** — `backend/tests/test_push_sends_task.py`

파일 상단 import 를 다음으로 바꾼다:
```python
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from apps.collector.celery_app import celery_app
from apps.collector.push.base import BatchResult, PushSender
from apps.collector.tasks import push_sends
from shared.models import Base, PushDevice, PushSend, PushTemplate, User, UserRole
```
파일 끝에 추가:
```python
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
    assert push_sends.dispatch_scheduled_pushes() == {"claimed": 1}
    assert queued == [due] and published == [date(2026, 10, 21)]
    # 두 번째 실행은 이미 sending 이라 다시 집지 않는다
    assert push_sends.dispatch_scheduled_pushes() == {"claimed": 0}
    with maker() as db:
        assert db.get(PushSend, due).status == "sending" and db.get(PushSend, due).started_at is not None
        assert db.get(PushSend, later).status == "scheduled"


def test_dispatch_skips_cancelled(maker, monkeypatch):
    queued = []
    monkeypatch.setattr(push_sends.send_fund_notice, "delay", lambda sid: queued.append(sid))
    monkeypatch.setattr(push_sends, "publish_fund_event", lambda d: None)
    sid = _scheduled(maker, -1)
    with maker() as db:
        db.get(PushSend, sid).status = "cancelled"
        db.commit()
    assert push_sends.dispatch_scheduled_pushes() == {"claimed": 0}
    assert queued == []


def test_claim_is_conditional_on_status(maker):
    sid = _scheduled(maker, -1)
    with maker() as db:
        db.get(PushSend, sid).status = "cancelled"  # 취소가 먼저 이긴 상황
        db.commit()
    with maker() as db:
        assert push_sends._claim(db, sid, datetime.now(timezone.utc)) is False


def test_beat_entry_registered():
    entry = celery_app.conf.beat_schedule["dispatch-scheduled-pushes"]
    assert entry["task"] == "collector.dispatch_scheduled_pushes"
    assert entry["schedule"] == 60.0
    assert "apps.collector.tasks.push_sends" in celery_app.conf.include
    assert "collector.dispatch_scheduled_pushes" in celery_app.tasks
```

- [ ] **4-2. 실패 확인**

실행: `cd backend && uv run pytest -p no:warnings tests/test_push_sends_task.py -k "dispatch or claim or beat"`
예상: `AttributeError: ... has no attribute 'dispatch_scheduled_pushes'`

- [ ] **4-3. 구현** — `backend/apps/collector/tasks/push_sends.py`

import 줄 `from sqlalchemy import delete, select` 를 `from sqlalchemy import delete, select, update` 로 바꾸고, 그 아래에 `from sqlalchemy.orm import Session` 추가. 파일 끝에 추가:

```python
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
    """1분마다: 예약 시각이 지난 scheduled 를 sending 으로 집고 → SSE → 발송 위임.
    Celery eta 는 쓰지 않는다(Redis 브로커 visibility_timeout 중복 전달·취소 어려움)."""
    now = _now()
    claimed: list[tuple[int, date]] = []
    with SyncSessionLocal() as db:
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
    return {"claimed": len(claimed)}
```

`backend/apps/collector/celery_app.py` 의 `celery_app.conf.beat_schedule = {` 안 마지막 엔트리 뒤에 추가:
```python
    # 펀드 리포트 알림 예약 발송 — 1분마다 예약 시각이 지난 것을 집는다(워커 중단 중 지난 예약은 재기동 후 지연 발송)
    "dispatch-scheduled-pushes": {
        "task": "collector.dispatch_scheduled_pushes",
        "schedule": 60.0,
        "options": {"expires": 55},
    },
```

- [ ] **4-4. 통과 확인**

실행: `cd backend && uv run pytest -p no:warnings tests/test_push_sends_task.py` → `11 passed`. 전체 실패 0.

- [ ] **4-5. 커밋**

```bash
git add backend/apps/collector/tasks/push_sends.py backend/apps/collector/celery_app.py backend/tests/test_push_sends_task.py
git commit -m "feat(collector): 펀드 알림 예약 발송 beat(1분, 조건부 UPDATE 로 한 번만 집기)

(끝 두 줄 규칙 적용)"
```

---

### 작업 5: admin_web `/fund-notices` 화면

**파일:**
- 수정: `admin_web/src/types/api.ts`(끝에 추가), `admin_web/src/App.tsx`, `admin_web/src/components/Sidebar.tsx`, `admin_web/src/components/Layout.tsx:9`
- 생성: `admin_web/src/api/fundNotices.ts`, `admin_web/src/api/pushTemplates.ts`, `admin_web/src/lib/pushText.ts`, `admin_web/src/pages/FundNoticesPage.tsx`
- 검증: `cd admin_web && npm run build`(테스트 프레임워크·ESLint 없음)

- [ ] **5-1. 타입** — `admin_web/src/types/api.ts` 끝에 추가

```ts
// ── 펀드 리포트 알림(blog /api/v1/admin) ──
export type PushSendMode = 'now' | 'test' | 'scheduled'
export type PushSendStatus = 'scheduled' | 'sending' | 'done' | 'failed' | 'cancelled'

export interface PushSendOut {
  id: number
  kind: string
  mode: PushSendMode
  ref_date: string
  title: string
  body: string
  status: PushSendStatus
  scheduled_at: string | null
  started_at: string | null
  finished_at: string | null
  target_count: number
  success_count: number
  failure_count: number
  template_id: number | null
  created_by: number | null
  created_by_nickname: string | null
  created_at: string
}

export interface PushSendListOut {
  items: PushSendOut[]
  total: number
}

export interface FundNoticePreviewOut {
  target_count: number
  my_device_count: number
  already_sent: boolean
  last_send: PushSendOut | null
}

export interface FundNoticeCreate {
  date: string
  title: string
  body: string
  mode: PushSendMode
  scheduled_at?: string
  template_id?: number | null
  force?: boolean
}

export interface PushTemplateOut {
  id: number
  title: string
  body: string
  last_sent_at: string | null
  created_at: string
  updated_at: string
}

export interface PushTemplateIn {
  title: string
  body: string
}
```

- [ ] **5-2. API 모듈** — `admin_web/src/api/fundNotices.ts`

```ts
import client from './client'
import type { FundNoticeCreate, FundNoticePreviewOut, PushSendListOut, PushSendOut } from '../types/api'

// 펀드 리포트 알림 발송·이력 (blog /api/v1/admin)
export const previewFundNotice = async (date: string): Promise<FundNoticePreviewOut> => {
  const { data } = await client.get<FundNoticePreviewOut>('/admin/fund-notices/preview', { params: { date } })
  return data
}

export const createFundNotice = async (payload: FundNoticeCreate): Promise<PushSendOut> => {
  const { data } = await client.post<PushSendOut>('/admin/fund-notices', payload)
  return data
}

export const listPushSends = async (limit = 20, offset = 0): Promise<PushSendListOut> => {
  const { data } = await client.get<PushSendListOut>('/admin/push-sends', { params: { limit, offset } })
  return data
}

export const cancelPushSend = async (id: number): Promise<PushSendOut> => {
  const { data } = await client.post<PushSendOut>(`/admin/push-sends/${id}/cancel`)
  return data
}
```

`admin_web/src/api/pushTemplates.ts`:

```ts
import client from './client'
import type { PushTemplateIn, PushTemplateOut } from '../types/api'

// 푸시 문구 템플릿 (blog /api/v1/admin/push-templates)
export const listPushTemplates = async (): Promise<PushTemplateOut[]> => {
  const { data } = await client.get<PushTemplateOut[]>('/admin/push-templates')
  return data
}

export const createPushTemplate = async (payload: PushTemplateIn): Promise<PushTemplateOut> => {
  const { data } = await client.post<PushTemplateOut>('/admin/push-templates', payload)
  return data
}

export const updatePushTemplate = async (id: number, payload: PushTemplateIn): Promise<PushTemplateOut> => {
  const { data } = await client.put<PushTemplateOut>(`/admin/push-templates/${id}`, payload)
  return data
}

export const deletePushTemplate = async (id: number): Promise<void> => {
  await client.delete(`/admin/push-templates/${id}`)
}
```

`admin_web/src/lib/pushText.ts` (서버 `shared/push_text.py` 와 같은 규칙 — 화면 미리보기용):

```ts
/** `{date}` → `M월 D일` (서버 render_push_text 와 같은 규칙). dateIso 는 YYYY-MM-DD */
export function renderPushText(text: string, dateIso: string): string {
  const [, m, d] = dateIso.split('-').map(Number)
  if (!m || !d) return text
  return text.split('{date}').join(`${m}월 ${d}일`)
}

/** 오늘(KST) YYYY-MM-DD */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

/** datetime-local 입력의 최솟값(지금 + 2분, 로컬 시각 문자열) */
export function minScheduleLocal(): string {
  const d = new Date(Date.now() + 2 * 60_000)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
```

- [ ] **5-3. 화면** — `admin_web/src/pages/FundNoticesPage.tsx`

먼저 `admin_web/src/lib/apiError.ts` 의 `apiErrorDetail` 반환 타입을 확인한다. 아래 코드의 `errorCode()` 는 반환값이 무엇이든(`unknown` 포함) `code` 를 안전하게 꺼낸다.

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { cancelPushSend, createFundNotice, listPushSends, previewFundNotice } from '../api/fundNotices'
import { createPushTemplate, deletePushTemplate, listPushTemplates, updatePushTemplate } from '../api/pushTemplates'
import { apiErrorDetail, apiErrorMessage } from '../lib/apiError'
import { minScheduleLocal, renderPushText, todayKst } from '../lib/pushText'
import { showToast } from '../lib/toast'
import type { FundNoticePreviewOut, PushSendMode, PushSendOut, PushTemplateOut } from '../types/api'

const MODE_LABEL: Record<PushSendMode, string> = { now: '즉시', test: '테스트', scheduled: '예약' }
const STATUS_LABEL: Record<PushSendOut['status'], string> = {
  scheduled: '예약됨', sending: '발송 중', done: '완료', failed: '실패', cancelled: '취소',
}
const STATUS_CLASS: Record<PushSendOut['status'], string> = {
  scheduled: 'bg-amber-100 text-amber-700',
  sending: 'bg-indigo-100 text-indigo-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
}
const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none'
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-')

function errorCode(e: unknown): string | undefined {
  const d: unknown = apiErrorDetail(e)
  return typeof d === 'object' && d !== null && 'code' in d ? String((d as { code: unknown }).code) : undefined
}

// 펀드 리포트 알림 — 작성·발송(테스트/즉시/예약) · 발송 이력 · 문구 템플릿
export default function FundNoticesPage() {
  const [tab, setTab] = useState<'send' | 'templates'>('send')
  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-slate-900">펀드 리포트 알림</h2>
      <div className="mb-4 flex gap-2">
        {(['send', 'templates'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}
          >
            {t === 'send' ? '발송' : '문구 템플릿'}
          </button>
        ))}
      </div>
      {tab === 'send' ? <SendPanel /> : <TemplatesPanel />}
    </div>
  )
}

function SendPanel() {
  const [date, setDate] = useState(todayKst())
  const [templates, setTemplates] = useState<PushTemplateOut[]>([])
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<FundNoticePreviewOut | null>(null)
  const [scheduleAt, setScheduleAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [sends, setSends] = useState<PushSendOut[]>([])

  const loadSends = useCallback(async () => {
    try {
      setSends((await listPushSends(30)).items)
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    }
  }, [])

  const loadPreview = useCallback(async () => {
    try {
      setPreview(await previewFundNotice(date))
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    }
  }, [date])

  const applyTemplate = (t: PushTemplateOut) => {
    setTemplateId(t.id)
    setTitle(t.title)
    setBody(t.body)
  }

  useEffect(() => {
    void listPushTemplates().then((list) => {
      setTemplates(list)
      if (list[0]) {
        setTemplateId(list[0].id)
        setTitle(list[0].title)
        setBody(list[0].body)
      }
    })
    void loadSends()
  }, [loadSends])

  useEffect(() => {
    void loadPreview()
  }, [loadPreview])

  // 발송 중 행이 있으면 5초마다 이력·미리보기 새로고침
  useEffect(() => {
    if (!sends.some((s) => s.status === 'sending')) return
    const id = setInterval(() => {
      void loadSends()
      void loadPreview()
    }, 5000)
    return () => clearInterval(id)
  }, [sends, loadSends, loadPreview])

  async function submit(mode: PushSendMode, force = false): Promise<void> {
    if (!title.trim() || !body.trim()) {
      showToast('제목과 본문을 입력하세요.', { icon: '⚠️' })
      return
    }
    if (mode === 'scheduled' && !scheduleAt) {
      showToast('예약 시각을 입력하세요.', { icon: '⚠️' })
      return
    }
    setBusy(true)
    try {
      await createFundNotice({
        date, title, body, mode, template_id: templateId, force,
        ...(mode === 'scheduled' ? { scheduled_at: new Date(scheduleAt).toISOString() } : {}),
      })
      showToast(mode === 'test' ? '내 기기로 테스트 발송했어요.' : mode === 'now' ? '발송을 시작했어요.' : '예약했어요.', { icon: '✅' })
      await Promise.all([loadSends(), loadPreview()])
    } catch (e) {
      if (errorCode(e) === 'already_sent' && !force) {
        if (confirm('이 기준일에 이미 보냈거나 예약된 알림이 있어요. 그래도 보낼까요?')) await submit(mode, true)
      } else {
        showToast(apiErrorMessage(e), { icon: '⚠️' })
      }
    } finally {
      setBusy(false)
    }
  }

  async function onCancel(id: number) {
    if (!confirm('예약을 취소할까요?')) return
    try {
      await cancelPushSend(id)
      showToast('예약을 취소했어요.', { icon: '✅' })
      await Promise.all([loadSends(), loadPreview()])
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    }
  }

  const myDevices = preview?.my_device_count ?? 0

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-600">
            기준일
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm text-slate-600">
            템플릿
            <select
              value={templateId ?? ''}
              onChange={(e) => {
                const t = templates.find((x) => x.id === Number(e.target.value))
                if (t) applyTemplate(t)
                else setTemplateId(null)
              }}
              className={inputClass}
            >
              <option value="">직접 입력</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm text-slate-600">
          제목 <span className="text-slate-400">({title.length}/100)</span>
          <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm text-slate-600">
          본문 <span className="text-slate-400">({body.length}/500) · {'{date}'} 는 기준일(M월 D일)로 바뀝니다</span>
          <textarea value={body} maxLength={500} rows={2} onChange={(e) => setBody(e.target.value)} className={inputClass} />
        </label>

        <div className="rounded-xl bg-slate-100 p-3">
          <p className="mb-1 text-xs text-slate-500">폰 알림 미리보기</p>
          <div className="rounded-lg bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">{renderPushText(title, date) || '제목'}</p>
            <p className="text-sm text-slate-600">{renderPushText(body, date) || '본문'}</p>
          </div>
        </div>

        <p className="text-sm text-slate-600">
          대상 기기 <b>{preview?.target_count ?? '-'}</b>대
          {preview?.already_sent && preview.last_send ? (
            <span className="ml-2 text-amber-600">
              · 이 기준일 {STATUS_LABEL[preview.last_send.status]} ({fmt(preview.last_send.scheduled_at ?? preview.last_send.started_at)})
            </span>
          ) : null}
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <button
            disabled={busy || myDevices === 0}
            onClick={() => void submit('test')}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            title={myDevices === 0 ? '앱에서 관리자 계정으로 로그인·알림 허용한 기기가 없어요' : undefined}
          >
            테스트 발송 (내 기기 {myDevices}대)
          </button>
          <button
            disabled={busy}
            onClick={() => void submit('now')}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            지금 발송
          </button>
          <label className="text-sm text-slate-600">
            예약 시각
            <input
              type="datetime-local"
              min={minScheduleLocal()}
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className={inputClass}
            />
          </label>
          <button
            disabled={busy || !scheduleAt}
            onClick={() => void submit('scheduled')}
            className="rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
          >
            예약 발송
          </button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {['기준일', '제목', '종류', '상태', '대상', '성공/실패', '보낸 사람', '시각', ''].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sends.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">발송 이력이 없습니다.</td></tr>
            ) : (
              sends.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{s.ref_date}</td>
                  <td className="px-4 py-3">{renderPushText(s.title, s.ref_date)}</td>
                  <td className="px-4 py-3">{MODE_LABEL[s.mode]}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                  </td>
                  <td className="px-4 py-3">{s.target_count}</td>
                  <td className="px-4 py-3">{s.success_count}/{s.failure_count}</td>
                  <td className="px-4 py-3">{s.created_by_nickname ?? '-'}</td>
                  <td className="px-4 py-3">{fmt(s.mode === 'scheduled' ? s.scheduled_at : s.started_at)}</td>
                  <td className="px-4 py-3">
                    {s.status === 'scheduled' ? (
                      <button onClick={() => void onCancel(s.id)} className="text-sm font-medium text-red-500 hover:text-red-700">취소</button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function TemplatesPanel() {
  const [list, setList] = useState<PushTemplateOut[]>([])
  const [editing, setEditing] = useState<PushTemplateOut | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const load = useCallback(async () => {
    try {
      setList(await listPushTemplates())
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function startEdit(t: PushTemplateOut | null) {
    setEditing(t)
    setTitle(t?.title ?? '')
    setBody(t?.body ?? '')
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) {
      showToast('제목과 본문을 입력하세요.', { icon: '⚠️' })
      return
    }
    try {
      if (editing) await updatePushTemplate(editing.id, { title, body })
      else await createPushTemplate({ title, body })
      showToast('템플릿을 저장했어요.', { icon: '✅' })
      startEdit(null)
      await load()
    } catch (err) {
      showToast(apiErrorMessage(err), { icon: '⚠️' })
    }
  }

  async function onDelete(t: PushTemplateOut) {
    if (!confirm(`'${t.title}' 템플릿을 삭제할까요?`)) return
    try {
      await deletePushTemplate(t.id)
      await load()
    } catch (err) {
      showToast(apiErrorMessage(err), { icon: '⚠️' })
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSave} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">{editing ? `템플릿 수정 (#${editing.id})` : '새 템플릿'}</p>
        <input value={title} maxLength={100} placeholder="제목" onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        <textarea
          value={body}
          maxLength={500}
          rows={2}
          placeholder="본문 — {date} 는 기준일(M월 D일)로 바뀝니다"
          onChange={(e) => setBody(e.target.value)}
          className={inputClass}
        />
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">저장</button>
          {editing ? (
            <button type="button" onClick={() => startEdit(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">취소</button>
          ) : null}
        </div>
      </form>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>{['제목', '본문', '마지막 발송', ''].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">{t.title}</td>
                <td className="px-4 py-3 text-slate-600">{t.body}</td>
                <td className="px-4 py-3">{fmt(t.last_sent_at)}</td>
                <td className="space-x-3 px-4 py-3 text-right">
                  <button onClick={() => startEdit(t)} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">수정</button>
                  <button onClick={() => void onDelete(t)} className="text-sm font-medium text-red-500 hover:text-red-700">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **5-4. 라우트·사이드바·폭**

`admin_web/src/App.tsx`: import 영역 끝에 `import FundNoticesPage from './pages/FundNoticesPage'` 추가, `<Route path="*" ... />`(46행) 바로 위에:
```tsx
        <Route path="fund-notices" element={<FundNoticesPage />} />
```
`admin_web/src/components/Sidebar.tsx` 의 `NAV_GROUPS` 에서 `'회원 관리'` 그룹 바로 앞에 새 그룹 추가:
```tsx
  {
    title: '알림',
    items: [{ to: '/fund-notices', label: '펀드 리포트 알림', icon: '📣' }],
  },
```
`admin_web/src/components/Layout.tsx:9` 를:
```ts
const WIDE_PREFIXES = ['/game/quizzes', '/market/', '/fund-notices']
```

- [ ] **5-5. 검증**

실행: `cd admin_web && npm run build`
예상: tsc 오류 0, vite build 성공.

- [ ] **5-6. 커밋**

```bash
git add admin_web/src/types/api.ts admin_web/src/api/fundNotices.ts admin_web/src/api/pushTemplates.ts \
  admin_web/src/lib/pushText.ts admin_web/src/pages/FundNoticesPage.tsx admin_web/src/App.tsx \
  admin_web/src/components/Sidebar.tsx admin_web/src/components/Layout.tsx
git commit -m "feat(admin): 펀드 리포트 알림 화면 — 작성·미리보기·테스트/즉시/예약 발송·이력·템플릿

(끝 두 줄 규칙 적용)"
```

---

### 작업 6: web_client SSE `fund_report_updated` 처리

**파일:**
- 수정: `web_client/src/types/api.ts:75-80`, `web_client/src/components/NotificationToaster.tsx`
- 검증: `cd web_client && npm run lint && npm run build`

- [ ] **6-1. 타입** — `web_client/src/types/api.ts` 의 `NewPostEvent` 아래에 추가:

```ts
export interface FundReportUpdatedEvent {
  type: 'fund_report_updated'
  date: string
}

export type NotificationEvent = NewPostEvent | FundReportUpdatedEvent
```

- [ ] **6-2. 토스터** — `web_client/src/components/NotificationToaster.tsx`

1~5행(import·`STREAM_URL`)을 다음으로 바꾼다:
```tsx
import { useEffect, useState } from 'react'
import { API_BASE_URL } from '../config'
import { fundRefresher } from '../lib/fundAutoRefresh'
import { loadFunds } from '../lib/fundStore'
import { useAuthStore } from '../store/auth'
import type { NotificationEvent } from '../types/api'

const STREAM_URL = API_BASE_URL + '/notifications/stream'
// 모든 접속자가 같은 순간 리포트를 받으러 가지 않게 0~30초 흩뿌린다
const FUND_JITTER_MS = 30_000
```
16~38행 `useEffect(() => { ... }, [])` 전체를 다음으로 바꾼다(new_post 동작은 그대로):
```tsx
  useEffect(() => {
    const es = new EventSource(STREAM_URL)
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const pushToast = (text: string) => {
      const id = `${Date.now()}-${Math.random()}`
      setToasts((prev) => [...prev, { id, text }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
    }
    const onNotification = (e: MessageEvent<string>) => {
      let payload: Partial<NotificationEvent> = {}
      try {
        payload = JSON.parse(e.data) as Partial<NotificationEvent>
      } catch {
        return
      }
      if (payload.type === 'fund_report_updated') {
        // 갱신 신호 — 로그인 + 이 브라우저에 펀드가 있을 때만, "새 알림" 토스트는 띄우지 않는다
        if (useAuthStore.getState().user === null || loadFunds().length === 0) return
        const t = setTimeout(() => {
          timers.delete(t)
          void fundRefresher.run({ force: true })
          pushToast('오늘 수익률 리포트가 올라왔어요')
        }, Math.random() * FUND_JITTER_MS)
        timers.add(t)
        return
      }
      pushToast(payload.type === 'new_post' ? `새 글: ${payload.title}` : '새 알림이 도착했습니다.')
    }
    es.addEventListener('notification', onNotification)
    return () => {
      es.removeEventListener('notification', onNotification)
      es.close()
      timers.forEach(clearTimeout)
    }
  }, [])
```

- [ ] **6-3. 검증**

실행: `cd web_client && npm run lint && npm run build` → 오류 0.

- [ ] **6-4. 커밋**

```bash
git add web_client/src/types/api.ts web_client/src/components/NotificationToaster.tsx
git commit -m "feat(web): SSE fund_report_updated — 로그인·펀드 있을 때 0~30초 뒤 자동 갱신 + 토스트

(끝 두 줄 규칙 적용)"
```

---

### 작업 7: 모바일 SSE(`fund-signal`) — 푸시 설정 없이 동작

**파일:**
- 생성: `mobile/src/features/fund/fund-signal-core.ts`, `mobile/src/features/fund/fund-signal-core.test.ts`, `mobile/src/features/fund/fund-signal.ts`
- 수정: `mobile/src/app/_layout.tsx`
- 사전: **사용자** 가 `react-native-sse`(순수 JS)·`expo-notifications` 를 한 번에 설치(7-1)

- [ ] **7-1. 사용자에게 의존성 설치 요청(작업 8 것까지 한 번에) + 의존성만 따로 커밋**

흐름이 두 번 멈추지 않게 한 번에 요청한다(설치만으로는 앱이 깨지지 않는다 — import 해야 깨진다):

`! cd mobile && npx expo install react-native-sse expo-notifications`

끝나면 확인 후 의존성 커밋을 **먼저 따로** 한다(작업 7·8 커밋에 섞이지 않게):
```bash
cd mobile && node -p "['react-native-sse','expo-notifications'].map(p=>p+'@'+require(p+'/package.json').version).join(' ')"
cd .. && git add mobile/package.json mobile/package-lock.json
git commit -m "chore(mobile): react-native-sse·expo-notifications 의존성 추가

(끝 두 줄 규칙 적용)"
```

- [ ] **7-2. 실패하는 테스트** — `mobile/src/features/fund/fund-signal-core.test.ts`

```ts
import { createSignalController, parseFundSignal } from './fund-signal-core';

describe('parseFundSignal', () => {
  it('fund_report_updated 만 날짜를 돌려준다', () => {
    expect(parseFundSignal('{"type":"fund_report_updated","date":"2026-10-21"}')).toBe('2026-10-21');
    expect(parseFundSignal('{"type":"new_post","post_id":1}')).toBeNull();
    expect(parseFundSignal('깨진 json')).toBeNull();
  });
});

describe('createSignalController', () => {
  const mk = (fundCount = 1) => {
    const close = jest.fn();
    const deps = {
      open: jest.fn(() => close),
      countFunds: jest.fn(async () => fundCount),
    };
    return { c: createSignalController(deps), deps, close };
  };

  it('로그인 + 앞 화면 + 펀드 있음이면 연결한다', async () => {
    const { c, deps } = mk();
    await c.update({ loggedIn: true, active: true });
    expect(deps.open).toHaveBeenCalledTimes(1);
  });

  it('펀드가 없거나 로그아웃·백그라운드면 연결하지 않는다', async () => {
    const a = mk(0);
    await a.c.update({ loggedIn: true, active: true });
    expect(a.deps.open).not.toHaveBeenCalled();
    const b = mk();
    await b.c.update({ loggedIn: false, active: true });
    await b.c.update({ loggedIn: true, active: false });
    expect(b.deps.open).not.toHaveBeenCalled();
  });

  it('백그라운드로 가면 닫고, 돌아오면 다시 연다(중복 연결 없음)', async () => {
    const { c, deps, close } = mk();
    await c.update({ loggedIn: true, active: true });
    await c.update({ loggedIn: true, active: true });
    expect(deps.open).toHaveBeenCalledTimes(1);
    await c.update({ loggedIn: true, active: false });
    expect(close).toHaveBeenCalledTimes(1);
    await c.update({ loggedIn: true, active: true });
    expect(deps.open).toHaveBeenCalledTimes(2);
  });

  it('dispose 는 연결을 닫는다', async () => {
    const { c, close } = mk();
    await c.update({ loggedIn: true, active: true });
    c.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **7-3. 실패 확인**

실행: `cd mobile && npx jest src/features/fund/fund-signal-core.test.ts`
예상: `Cannot find module './fund-signal-core'`

- [ ] **7-4. 구현** — `mobile/src/features/fund/fund-signal-core.ts`

```ts
// 펀드 리포트 갱신 신호(SSE) — 순수 로직. 연결은 로그인 + 앞 화면 + 펀드 ≥1 일 때만.
export const FUND_SIGNAL_JITTER_MS = 30_000;

/** SSE data(JSON) 에서 fund_report_updated 의 날짜만 꺼낸다. 그 외·깨진 값은 null */
export function parseFundSignal(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { type?: unknown; date?: unknown };
    return v.type === 'fund_report_updated' && typeof v.date === 'string' ? v.date : null;
  } catch {
    return null;
  }
}

export type SignalState = { loggedIn: boolean; active: boolean };
export type SignalDeps = {
  /** 연결을 열고, 닫는 함수를 돌려준다 */
  open: () => () => void;
  countFunds: () => Promise<number>;
};

export function createSignalController(deps: SignalDeps) {
  let close: (() => void) | null = null;
  let seq = 0; // 늦게 끝난 countFunds 가 최신 상태를 덮지 않게

  const stop = () => {
    close?.();
    close = null;
  };

  return {
    async update(s: SignalState): Promise<void> {
      const my = ++seq;
      if (!s.loggedIn || !s.active) {
        stop();
        return;
      }
      if (close) return;
      const count = await deps.countFunds().catch(() => 0);
      if (my !== seq || close) return;
      if (count > 0) close = deps.open();
    },
    dispose: stop,
  };
}
```

`mobile/src/features/fund/fund-signal.ts`:

```ts
// 앱이 열려 있을 때 관리자 "오늘 리포트 업데이트" 신호(SSE)를 받아 0~30초 뒤 자동 갱신(force).
// 푸시 설정(EAS·Firebase) 없이도 동작한다. 백그라운드에서는 연결하지 않는다(배터리·서버 연결 수).
import { useEffect } from 'react';
import { AppState } from 'react-native';
import EventSource from 'react-native-sse';

import { useAuthStore } from '@/features/auth/store';
import { ENV } from '@/lib/env';

import { fundRefresher } from './auto-refresh';
import { createSignalController, FUND_SIGNAL_JITTER_MS, parseFundSignal } from './fund-signal-core';
import { loadFunds } from './fund-store';

function openStream(): () => void {
  const es = new EventSource<'notification'>(`${ENV.blogApiUrl}/api/v1/notifications/stream`);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  es.addEventListener('notification', (e) => {
    if (!parseFundSignal(e.data)) return;
    const t = setTimeout(() => {
      timers.delete(t);
      void fundRefresher.run({ force: true });
    }, Math.random() * FUND_SIGNAL_JITTER_MS);
    timers.add(t);
  });
  return () => {
    timers.forEach(clearTimeout);
    es.removeAllEventListeners();
    es.close();
  };
}

/** 루트 레이아웃에서 한 번 */
export function useFundSignal(): void {
  const loggedIn = useAuthStore((s) => s.user !== null);
  useEffect(() => {
    const c = createSignalController({ open: openStream, countFunds: async () => (await loadFunds()).length });
    void c.update({ loggedIn, active: AppState.currentState === 'active' });
    const sub = AppState.addEventListener('change', (next) => {
      void c.update({ loggedIn, active: next === 'active' });
    });
    return () => {
      sub.remove();
      c.dispose();
    };
  }, [loggedIn]);
}
```

> 앱 실행 중 펀드를 처음 추가하면 다음 포그라운드 복귀 때부터 연결된다(설계상 앱이 열려 있을 때의 보조 신호이고, 주 경로는 푸시·자동 갱신이다).

`mobile/src/app/_layout.tsx`: import 에 `import { useFundSignal } from '@/features/fund/fund-signal';` 추가, `useFundAutoRefresh();` 다음 줄에:
```tsx
  useFundSignal(); // 앱이 열려 있을 때 관리자 리포트 업데이트 신호(SSE) → 자동 갱신
```

- [ ] **7-5. 통과 확인**

실행: `cd mobile && npx jest src/features/fund/fund-signal-core.test.ts` → `5 passed`.
이어서: `cd mobile && npx tsc --noEmit && npx jest --silent` → 오류 0, 실패 0.

- [ ] **7-6. 커밋**

```bash
git add mobile/src/features/fund/fund-signal-core.ts \
  mobile/src/features/fund/fund-signal-core.test.ts mobile/src/features/fund/fund-signal.ts mobile/src/app/_layout.tsx
git commit -m "feat(mobile): 펀드 리포트 갱신 신호 SSE — 로그인·앞 화면·펀드 있을 때만 연결, 0~30초 뒤 갱신

(끝 두 줄 규칙 적용)"
```

---

### 작업 8: 모바일 푸시(권한·등록·핸들러·채널·config)

**파일:**
- 사전: 7-1 에서 `expo-notifications` 설치 완료 → **네이티브 재빌드 필요**(8-10)
- 수정: `mobile/app.config.js`, `mobile/.env.example`, `mobile/src/features/auth/store.ts:64-68`, `mobile/src/app/_layout.tsx`, `mobile/src/app/fund/index.tsx`
- 생성: `mobile/src/features/auth/logout-hooks.ts`, `mobile/src/features/push/` 아래 `config.ts`, `api.ts`, `registration-core.ts`(+test), `registration.ts`, `handlers-core.ts`(+test), `handlers.ts`, `prompt-core.ts`(+test), `prompt.ts`, `push-prompt-sheet.tsx`, `permission-banner.tsx`

- [ ] **8-1. 시작 전: Metro 정지(기기 빨간 화면 방지)**

`expo-notifications` 는 네이티브 모듈이라, 8-8 에서 `_layout.tsx` 가 import 하는 순간 켜져 있는 Metro 가 **옛 바이너리**(기기에 설치된 개발 앱)에 새 번들을 보내 `Cannot find native module 'ExpoPushTokenManager'` 류 빨간 화면이 뜬다. 작업 8 을 시작하기 전에 실행 중인 Metro(8082)를 멈추고 사용자에게 "재빌드(8-10) 전까지 기기 앱은 쓰지 말라"고 알린다. 패키지 설치는 7-1 에서 이미 끝났다.

- [ ] **8-2. 설정** — `mobile/app.config.js`

맨 위 `const isDev = ...` 아래에 추가:
```js
// 푸시(expo-notifications) — 값이 없으면 푸시만 꺼진다(isPushConfigured). docs/push_notification_setup.md 5장
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || undefined;
const GOOGLE_SERVICES_JSON = process.env.GOOGLE_SERVICES_JSON || undefined;
```
`android` 블록의 `predictiveBackGestureEnabled: false,` 다음 줄에:
```js
        ...(GOOGLE_SERVICES_JSON ? { googleServicesFile: GOOGLE_SERVICES_JSON } : {}),
```
`plugins` 배열의 `'expo-secure-store',` 다음 줄에:
```js
        'expo-notifications',
```
`extra: { appEnv: APP_ENV, },` 를:
```js
      extra: {
        appEnv: APP_ENV,
        ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
      },
```
`mobile/.env.example` 끝에 추가(값 없이):
```
# ── 푸시(빌드 시 app.config.js 가 읽음, EXPO_PUBLIC_ 아님) ──
# eas init 으로 받은 projectId(UUID). 없으면 푸시만 꺼진다.
# EAS_PROJECT_ID=
# Firebase google-services.json 경로(커밋 금지 — mobile/secrets/)
# GOOGLE_SERVICES_JSON=./secrets/google-services.json
```

- [ ] **8-3. 실패하는 테스트 3개**

`mobile/src/features/push/registration-core.test.ts`:
```ts
import { syncPushRegistrationWith, unregisterWith, type SyncDeps } from './registration-core';

const mk = (over: Partial<SyncDeps> = {}) => {
  const saved = { v: null as string | null };
  const d: SyncDeps = {
    isConfigured: () => true,
    authToken: () => 'jwt',
    countFunds: async () => 1,
    permission: async () => 'granted',
    getPushToken: async () => 'ExponentPushToken[a]',
    loadSaved: async () => saved.v,
    saveToken: jest.fn(async (t: string | null) => {
      saved.v = t;
    }),
    put: jest.fn(async () => {}),
    del: jest.fn(async () => {}),
    ...over,
  };
  return { d, saved };
};

describe('syncPushRegistrationWith', () => {
  it('설정 안 됨이면 아무것도 안 한다', async () => {
    const { d } = mk({ isConfigured: () => false });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('skipped');
    expect(d.put).not.toHaveBeenCalled();
  });

  it('로그인·펀드·권한이 모두 있으면 PUT 하고 저장한다', async () => {
    const { d, saved } = mk();
    await expect(syncPushRegistrationWith(d)).resolves.toBe('registered');
    expect(d.put).toHaveBeenCalledWith('jwt', 'ExponentPushToken[a]');
    expect(saved.v).toBe('ExponentPushToken[a]');
  });

  it('저장된 토큰과 같으면 PUT 을 생략한다', async () => {
    const { d, saved } = mk();
    saved.v = 'ExponentPushToken[a]';
    await expect(syncPushRegistrationWith(d)).resolves.toBe('unchanged');
    expect(d.put).not.toHaveBeenCalled();
  });

  it('펀드가 0개면 등록된 토큰을 DELETE 한다', async () => {
    const { d, saved } = mk({ countFunds: async () => 0 });
    saved.v = 'ExponentPushToken[a]';
    await expect(syncPushRegistrationWith(d)).resolves.toBe('unregistered');
    expect(d.del).toHaveBeenCalledWith('jwt', 'ExponentPushToken[a]');
    expect(saved.v).toBeNull();
  });

  it('권한이 없으면 등록하지 않는다', async () => {
    const { d } = mk({ permission: async () => 'denied' });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('idle');
    expect(d.put).not.toHaveBeenCalled();
  });

  it('로그아웃 상태면 서버 호출 없이 끝난다', async () => {
    const { d, saved } = mk({ authToken: () => null });
    saved.v = 'ExponentPushToken[a]';
    await expect(syncPushRegistrationWith(d)).resolves.toBe('idle');
    expect(d.del).not.toHaveBeenCalled();
  });

  it('실패는 조용히 failed 로 끝나고 저장값은 그대로', async () => {
    const { d, saved } = mk({ put: jest.fn(async () => Promise.reject(new Error('net'))) });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('failed');
    expect(saved.v).toBeNull();
  });
});

describe('unregisterWith', () => {
  it('저장된 토큰을 주어진 인증 토큰으로 지우고 비운다(실패해도 비운다)', async () => {
    const { d, saved } = mk({ del: jest.fn(async () => Promise.reject(new Error('401'))) });
    saved.v = 'ExponentPushToken[a]';
    await unregisterWith(d, 'old-jwt');
    expect(d.del).toHaveBeenCalledWith('old-jwt', 'ExponentPushToken[a]');
    expect(saved.v).toBeNull();
  });

  it('저장된 토큰이 없으면 호출하지 않는다', async () => {
    const { d } = mk();
    await unregisterWith(d, 'jwt');
    expect(d.del).not.toHaveBeenCalled();
  });
});
```

`mobile/src/features/push/handlers-core.test.ts`:
```ts
import { handleNotificationResponseWith, isFundNotification } from './handlers-core';

describe('isFundNotification', () => {
  it('data.type 이 fund_report 일 때만 true', () => {
    expect(isFundNotification({ type: 'fund_report', date: '2026-10-21' })).toBe(true);
    expect(isFundNotification({ type: 'new_post' })).toBe(false);
    expect(isFundNotification(undefined)).toBe(false);
  });
});

describe('handleNotificationResponseWith', () => {
  it('펀드 알림 탭 → 펀드 화면 이동 + 강제 갱신', () => {
    const deps = { navigate: jest.fn(), refresh: jest.fn() };
    expect(handleNotificationResponseWith({ type: 'fund_report' }, deps)).toBe(true);
    expect(deps.navigate).toHaveBeenCalledWith('/fund');
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it('다른 알림은 무시', () => {
    const deps = { navigate: jest.fn(), refresh: jest.fn() };
    expect(handleNotificationResponseWith({ type: 'new_post' }, deps)).toBe(false);
    expect(deps.navigate).not.toHaveBeenCalled();
  });
});
```

`mobile/src/features/push/prompt-core.test.ts`:
```ts
import { shouldOfferPrompt } from './prompt-core';

describe('shouldOfferPrompt', () => {
  it('설정됨 + 아직 안 물어봄 + 첫 펀드(0→1)일 때만', () => {
    expect(shouldOfferPrompt({ prevCount: 0, nextCount: 1, configured: true, prompted: false })).toBe(true);
    expect(shouldOfferPrompt({ prevCount: 1, nextCount: 2, configured: true, prompted: false })).toBe(false);
    expect(shouldOfferPrompt({ prevCount: 0, nextCount: 1, configured: true, prompted: true })).toBe(false);
    expect(shouldOfferPrompt({ prevCount: 0, nextCount: 1, configured: false, prompted: false })).toBe(false);
  });
});
```

- [ ] **8-4. 실패 확인**

실행: `cd mobile && npx jest src/features/push`
예상: 세 파일 모두 `Cannot find module`

- [ ] **8-5. 순수 로직 구현**

`mobile/src/features/push/registration-core.ts`:
```ts
// 푸시 토큰 등록 동기화 — 순수 로직(의존성 주입). 실패는 조용히(다음 시점 재시도).
export type PushPermission = 'granted' | 'denied' | 'undetermined';

export type SyncDeps = {
  isConfigured: () => boolean;
  authToken: () => string | null;
  countFunds: () => Promise<number>;
  permission: () => Promise<PushPermission>;
  getPushToken: () => Promise<string>;
  loadSaved: () => Promise<string | null>;
  saveToken: (token: string | null) => Promise<void>;
  put: (authToken: string, pushToken: string) => Promise<void>;
  del: (authToken: string, pushToken: string) => Promise<void>;
};

export type SyncResult = 'skipped' | 'registered' | 'unchanged' | 'unregistered' | 'idle' | 'failed';

/** 로그인 + 펀드 ≥1 + 권한 허용 → 등록(토큰이 바뀌었을 때만 PUT). 아니면 등록돼 있던 토큰을 해제 */
export async function syncPushRegistrationWith(d: SyncDeps): Promise<SyncResult> {
  if (!d.isConfigured()) return 'skipped';
  try {
    const auth = d.authToken();
    if (!auth) return 'idle'; // 로그아웃 해제는 unregisterWith(로그아웃 직전 훅)가 맡는다
    const saved = await d.loadSaved();
    const wanted = (await d.countFunds()) > 0 && (await d.permission()) === 'granted';
    if (wanted) {
      const token = await d.getPushToken();
      if (token === saved) return 'unchanged';
      await d.put(auth, token);
      await d.saveToken(token);
      return 'registered';
    }
    if (!saved) return 'idle';
    await d.del(auth, saved);
    await d.saveToken(null);
    return 'unregistered';
  } catch {
    return 'failed';
  }
}

/** 로그아웃 직전 — 지워지기 전 인증 토큰을 받아 해제. 서버 실패여도 기기 기록은 비운다 */
export async function unregisterWith(
  d: Pick<SyncDeps, 'loadSaved' | 'saveToken' | 'del'>,
  authToken: string,
): Promise<void> {
  const saved = await d.loadSaved().catch(() => null);
  if (!saved) return;
  await d.del(authToken, saved).catch(() => {});
  await d.saveToken(null).catch(() => {});
}
```

`mobile/src/features/push/handlers-core.ts`:
```ts
// 알림 탭 처리 — 순수 로직
export const FUND_CHANNEL_ID = 'fund-report';

export function isFundNotification(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'fund_report';
}

export function handleNotificationResponseWith(
  data: unknown,
  deps: { navigate: (path: '/fund') => void; refresh: () => void },
): boolean {
  if (!isFundNotification(data)) return false;
  deps.navigate('/fund');
  deps.refresh();
  return true;
}
```

`mobile/src/features/push/prompt-core.ts`:
```ts
/** 펀드 첫 등록(0→1) 직후, 푸시가 설정돼 있고 아직 물어본 적 없을 때만 안내 시트를 띄운다 */
export function shouldOfferPrompt(s: {
  prevCount: number;
  nextCount: number;
  configured: boolean;
  prompted: boolean;
}): boolean {
  return s.configured && !s.prompted && s.prevCount === 0 && s.nextCount > 0;
}
```

- [ ] **8-6. 통과 확인(순수 로직)**

실행: `cd mobile && npx jest src/features/push` → `13 passed`

- [ ] **8-7. 연결 모듈(네이티브)**

`mobile/src/features/auth/logout-hooks.ts`:
```ts
// 로그아웃 "직전" 훅 — 토큰이 지워지기 전에 받아 서버 정리(푸시 해제 등). 순환 참조를 피해 store 와 분리
type Hook = (authToken: string) => void;
const hooks = new Set<Hook>();

export function registerBeforeLogout(hook: Hook): () => void {
  hooks.add(hook);
  return () => hooks.delete(hook);
}

export function runBeforeLogout(authToken: string): void {
  hooks.forEach((h) => {
    try {
      h(authToken);
    } catch {
      // 훅 실패가 로그아웃을 막지 않는다
    }
  });
}
```
`mobile/src/features/auth/store.ts`: import 영역(10행 `import type { User } from './types';` 다음)에 `import { runBeforeLogout } from './logout-hooks';` 추가, `logout`(64-68행)을:
```ts
  logout: () => {
    const prev = get().token;
    if (prev) runBeforeLogout(prev); // 토큰이 지워지기 전 — 푸시 기기 해제 등
    setHttpAuthToken(null);
    set({ token: null, user: null });
    persist(null, null).catch(() => {});
  },
```

`mobile/src/features/push/config.ts`:
```ts
import Constants from 'expo-constants';

/** app.config.js extra.eas.projectId(env EAS_PROJECT_ID). 없으면 푸시 꺼짐 */
export function getProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId || undefined;
}

export const isPushConfigured = (): boolean => getProjectId() !== undefined;
```

`mobile/src/features/push/api.ts`:
```ts
// 푸시 기기 토큰 API — fetch 직접 호출: 백그라운드 등록에 상단 진행바를 띄우지 않고, 로그아웃 직전 토큰을 인자로 받기 위해
import { ENV } from '@/lib/env';

const BASE = `${ENV.blogApiUrl}/api/v1/push-devices`;

export async function putPushDevice(authToken: string, pushToken: string, platform: 'android' | 'ios'): Promise<void> {
  const res = await fetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ token: pushToken, platform, fund_notice: true }),
  });
  if (!res.ok) throw new Error(`push-devices PUT ${res.status}`);
}

export async function deletePushDevice(authToken: string, pushToken: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(pushToken)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw new Error(`push-devices DELETE ${res.status}`);
}
```

`mobile/src/features/push/registration.ts`:
```ts
// 푸시 등록 동기화 — 실제 의존성 연결. 호출 시점: 앱 실행·로그인 직후, 펀드 추가·삭제, 권한 허용 직후. 로그아웃 직전은 훅.
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { registerBeforeLogout } from '@/features/auth/logout-hooks';
import { useAuthStore } from '@/features/auth/store';
import { loadFunds } from '@/features/fund/fund-store';

import { deletePushDevice, putPushDevice } from './api';
import { getProjectId, isPushConfigured } from './config';
import { syncPushRegistrationWith, unregisterWith, type PushPermission, type SyncDeps } from './registration-core';

const SAVED_KEY = 'push_device_v1';
const platform = Platform.OS === 'ios' ? 'ios' : 'android';

const deps: SyncDeps = {
  isConfigured: isPushConfigured,
  authToken: () => useAuthStore.getState().token,
  countFunds: async () => (await loadFunds()).length,
  permission: async () => (await Notifications.getPermissionsAsync()).status as PushPermission,
  getPushToken: async () => (await Notifications.getExpoPushTokenAsync({ projectId: getProjectId() })).data,
  loadSaved: () => SecureStore.getItemAsync(SAVED_KEY),
  saveToken: (t) => (t ? SecureStore.setItemAsync(SAVED_KEY, t) : SecureStore.deleteItemAsync(SAVED_KEY)),
  put: (auth, token) => putPushDevice(auth, token, platform),
  del: deletePushDevice,
};

export const syncPushRegistration = () => syncPushRegistrationWith(deps);

let hooked = false;
/** 로그아웃 직전 해제 훅 — 앱 시작 시 한 번 */
export function installPushLogoutHook(): void {
  if (hooked) return;
  hooked = true;
  registerBeforeLogout((authToken) => {
    if (isPushConfigured()) void unregisterWith(deps, authToken);
  });
}
```

`mobile/src/features/push/handlers.ts`:
```ts
// 알림 표시·채널·탭 처리 — 루트 레이아웃에서 usePushSetup() 한 번
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useAuthStore } from '@/features/auth/store';
import { fundRefresher } from '@/features/fund/auto-refresh';

import { isPushConfigured } from './config';
import { FUND_CHANNEL_ID, handleNotificationResponseWith } from './handlers-core';
import { installPushLogoutHook, syncPushRegistration } from './registration';

// 같은 알림 응답을 두 번 처리하지 않게(효과 재실행·앱 재실행 때 getLastNotificationResponseAsync 가 같은 응답을 다시 줄 수 있음)
const HANDLED_KEY = 'push_last_handled_v1';
let lastHandled: string | null | undefined; // undefined = 아직 SecureStore 에서 안 읽음

async function claimResponse(id: string): Promise<boolean> {
  if (lastHandled === undefined) lastHandled = await SecureStore.getItemAsync(HANDLED_KEY).catch(() => null);
  if (lastHandled === id) return false;
  lastHandled = id;
  void SecureStore.setItemAsync(HANDLED_KEY, id).catch(() => {});
  return true;
}

// 앱이 앞에 있을 때 받은 알림은 배너를 띄우지 않는다(SSE·자동 갱신이 이미 반영) — 알림 목록에는 남김
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Android 13+ 는 권한 요청 전에 채널이 있어야 한다 */
export async function ensureFundChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(FUND_CHANNEL_ID, {
    name: '펀드 리포트',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export function usePushSetup(): void {
  const router = useRouter();
  const loggedIn = useAuthStore((s) => s.user !== null);
  // 로그인 상태 복원(hydrate) 전에 /fund 로 가면 펀드 화면이 user=null 로 보고 /profile 로 튕긴다 → 복원 후에 처리
  const hydrated = useAuthStore((s) => s.hydrated);

  useEffect(() => {
    if (!isPushConfigured() || !hydrated) return;
    installPushLogoutHook();
    void ensureFundChannel();
    const handle = async (r: Notifications.NotificationResponse | null) => {
      if (!r || !(await claimResponse(r.notification.request.identifier))) return;
      handleNotificationResponseWith(r.notification.request.content.data, {
        navigate: (p) => router.push(p),
        refresh: () => void fundRefresher.run({ force: true }),
      });
    };
    void Notifications.getLastNotificationResponseAsync().then(handle); // 콜드 스타트(앱이 꺼진 상태에서 탭)
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    return () => sub.remove();
  }, [router, hydrated]);

  // 앱 실행·로그인 직후 등록 동기화
  useEffect(() => {
    if (loggedIn) void syncPushRegistration();
  }, [loggedIn]);
}
```

`mobile/src/features/push/prompt.ts`:
```ts
import * as SecureStore from 'expo-secure-store';

const PROMPT_KEY = 'push_prompt_v1';
const BANNER_KEY = 'push_banner_dismissed_v1';

/** 안내 시트를 이미 보여줬는지(다시 묻지 않음). 읽기 실패는 "물어봤음"으로 — 반복 노출 방지 */
export async function wasPrompted(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(PROMPT_KEY)) !== null;
  } catch {
    return true;
  }
}

export const markPrompted = (answer: 'accepted' | 'declined') =>
  SecureStore.setItemAsync(PROMPT_KEY, answer).catch(() => {});

export async function isBannerDismissed(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(BANNER_KEY)) !== null;
  } catch {
    return false;
  }
}

export const dismissBanner = () => SecureStore.setItemAsync(BANNER_KEY, '1').catch(() => {});
```

`mobile/src/features/push/push-prompt-sheet.tsx`:
```tsx
import * as Notifications from 'expo-notifications';
import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BottomSheet, Button } from '@/ui';

import { ensureFundChannel } from './handlers';
import { markPrompted } from './prompt';
import { syncPushRegistration } from './registration';

/** 펀드 첫 등록 직후 한 번 — [알림 받기] 일 때만 OS 권한을 요청한다 */
export function PushPromptSheet({ onClose }: { onClose: () => void }) {
  const accept = async () => {
    await ensureFundChannel();
    await Notifications.requestPermissionsAsync();
    await markPrompted('accepted');
    void syncPushRegistration();
    onClose();
  };
  const later = () => {
    void markPrompted('declined');
    onClose();
  };
  return (
    <BottomSheet title="리포트가 올라오면 알려드릴까요?" onClose={later}>
      <Text style={styles.text}>매일 수익률 리포트가 업데이트되면 알림으로 알려드려요. 설정에서 언제든 끌 수 있어요.</Text>
      <Button label="알림 받기" onPress={() => void accept()} />
      <Button label="나중에" variant="secondary" onPress={later} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: { fontSize: 15, color: theme.colors.textSecondary, lineHeight: 22 },
}));
```

`mobile/src/features/push/permission-banner.tsx`:
```tsx
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { isPushConfigured } from './config';
import { dismissBanner, isBannerDismissed } from './prompt';

/** 알림 권한이 거부돼 있으면 펀드 목록 위에 안내(닫으면 다시 안 보임) */
export function PushPermissionBanner() {
  const [show, setShow] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isPushConfigured()) return;
      let alive = true;
      void Promise.all([Notifications.getPermissionsAsync(), isBannerDismissed()]).then(([p, dismissed]) => {
        if (alive) setShow(p.status === 'denied' && !dismissed);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  if (!show) return null;
  return (
    <View style={styles.box}>
      <Pressable style={styles.flex} onPress={() => void Linking.openSettings()} accessibilityRole="button">
        <Text style={styles.text}>알림이 꺼져 있어요 · 설정 열기</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          void dismissBanner();
          setShow(false);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="알림 안내 닫기"
      >
        <Text style={styles.close}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1),
    backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.card,
    padding: theme.gap(1.5),
  },
  flex: { flex: 1 },
  text: { fontSize: 14, color: theme.colors.text },
  close: { fontSize: 14, color: theme.colors.textSecondary },
}));
```

- [ ] **8-8. 화면 연결**

`mobile/src/app/_layout.tsx`: import 에 `import { usePushSetup } from '@/features/push/handlers';` 추가, `useFundSignal();` 다음 줄에:
```tsx
  usePushSetup(); // 푸시 채널·알림 탭(→ 펀드 화면 + 강제 갱신)·등록 동기화(설정 안 됐으면 아무 일 없음)
```

`mobile/src/app/fund/index.tsx`:
- import 영역(25행 `import { Button, ... } from '@/ui';` 다음)에 추가:
```tsx
import { isPushConfigured } from '@/features/push/config';
import { PushPermissionBanner } from '@/features/push/permission-banner';
import { wasPrompted } from '@/features/push/prompt';
import { shouldOfferPrompt } from '@/features/push/prompt-core';
import { PushPromptSheet } from '@/features/push/push-prompt-sheet';
import { syncPushRegistration } from '@/features/push/registration';
```
- 38행 `const [lines, setLines] = ...` 다음에 `const [promptOpen, setPromptOpen] = useState(false);`
- `handleAdd`(82~95행)를:
```tsx
  const handleAdd = async () => {
    if (funds === null) return; // 저장된 목록을 읽기 전에 추가하면 목록을 덮어쓴다
    try {
      const next = addFund(funds, { name, url }, newFundId());
      await saveFunds(next);
      setFunds(next);
      setName('');
      setUrl('');
      setError('');
      showToast('펀드를 추가했어요');
      void syncPushRegistration();
      const offer = shouldOfferPrompt({
        prevCount: funds.length,
        nextCount: next.length,
        configured: isPushConfigured(),
        prompted: await wasPrompted(),
      });
      if (offer) setPromptOpen(true);
    } catch (e) {
      setError(isFundError(e, 'input') ? e.message : '저장하지 못했어요. 다시 시도해 주세요.');
    }
  };
```
- `handleRemove` 안 `setFunds(next);`(109행) 다음 줄에 `void syncPushRegistration(); // 마지막 펀드를 지우면 알림 해제`
- 138행 `/>`(Stack.Screen 끝) 다음, 139행 `<Card>` 앞에 `<PushPermissionBanner />`
- 파일의 `</ScrollView>` 바로 앞에 `{promptOpen ? <PushPromptSheet onClose={() => setPromptOpen(false)} /> : null}`

- [ ] **8-9. 검증**

실행: `cd mobile && npx tsc --noEmit && npx jest --silent` → 오류 0, 실패 0.
`npx expo lint` 는 사용자가 실행.

- [ ] **8-10. 개발 앱 재빌드(네이티브 모듈 추가) — 커밋 전에 실행 확인**

푸시 설정값(`EAS_PROJECT_ID`)이 아직 없어도 재빌드한다 — 값이 없으면 푸시만 꺼지고 앱은 정상이어야 한다(이것도 확인 대상).
```bash
cd mobile && npm run prebuild:dev:android
APP_ENV=development npx expo run:android --port 8082
```
확인: 앱이 빨간 화면 없이 뜨고, 펀드 화면 진입·펀드 추가가 되며(설정 없으면 안내 시트 안 뜸), 홈·스크리너가 정상. 기기를 다시 연결했다면 `adb reverse tcp:8082 tcp:8082`.

- [ ] **8-11. 커밋**

```bash
git add mobile/app.config.js mobile/.env.example \
  mobile/src/features/auth/logout-hooks.ts mobile/src/features/auth/store.ts mobile/src/app/_layout.tsx mobile/src/app/fund/index.tsx \
  mobile/src/features/push/config.ts mobile/src/features/push/api.ts mobile/src/features/push/registration-core.ts \
  mobile/src/features/push/registration-core.test.ts mobile/src/features/push/registration.ts \
  mobile/src/features/push/handlers-core.ts mobile/src/features/push/handlers-core.test.ts mobile/src/features/push/handlers.ts \
  mobile/src/features/push/prompt-core.ts mobile/src/features/push/prompt-core.test.ts mobile/src/features/push/prompt.ts \
  mobile/src/features/push/push-prompt-sheet.tsx mobile/src/features/push/permission-banner.tsx
git commit -m "feat(mobile): 펀드 리포트 푸시 — 첫 펀드 등록 시 안내·권한, 토큰 등록/해제, 알림 탭→펀드 화면 갱신, 채널

(끝 두 줄 규칙 적용)"
```

- [ ] **8-12. 실푸시 확인(사용자 준비 후)**

사용자 준비(가이드 2-2·3장: FCM V1 키 발급 → `eas init` → `eas credentials` 업로드)가 끝나 projectId 를 알면: 사용자가 `mobile/.env.development.local` 에 `EAS_PROJECT_ID=<UUID>` 와 `GOOGLE_SERVICES_JSON=./secrets/google-services.json` 추가(`google-services.json` 은 이미 있음 — 두 패키지 포함 확인 완료) → 8-10 과 같은 명령으로 재빌드. 확인 순서는 가이드 7장(토큰 등록 → Expo 도구 단독 발송 → 관리자 테스트 발송). 앱이 꺼진 상태에서 알림을 탭해 **내정보로 튕기지 않고 펀드 화면으로 가는지**도 확인한다.

> 출시 전 개선 후보(이번 범위 밖): 다른 기기 로그인으로 세션이 교체되면 `expireSession` 의 DELETE 가 401 로 실패해 옛 기기 토큰이 남는다 — 그 기기에 펀드 푸시가 계속 갈 수 있다(데이터 없음, 탭하면 프로필).

---

### 작업 9: 문서(README · ROADMAP · 설정 가이드)

**파일:** `README.md`, `docs/ROADMAP.md:106`, `:147`, `docs/push_notification_setup.md`

- [ ] **9-1. README** — `grep -n "PUSH_BACKEND\|EXPO_PUBLIC_GAME_API_URL" README.md` 로 찾은 환경변수 설명 줄들 아래에 각각 추가:

```markdown
- **펀드 리포트 알림(푸시·SSE)**: admin_web `/fund-notices` 에서 테스트·즉시·예약 발송. 서버 `PUSH_BACKEND=expo`(로컬 기본 `mock`=로그만), 선택 `EXPO_ACCESS_TOKEN`. 예약은 collector beat `dispatch-scheduled-pushes`(1분). 앱은 빌드 env `EAS_PROJECT_ID`·`GOOGLE_SERVICES_JSON`(없으면 푸시만 꺼지고 SSE·자동 갱신은 정상), `expo-notifications` 추가로 **새 dev build 필요**. 절차: `docs/push_notification_setup.md`.
```

- [ ] **9-2. ROADMAP** — `docs/ROADMAP.md`
- 106행 `- [ ] 실제 FCM 푸시(현재 Mock 대체)` → `- [x] 실제 푸시 — Expo Push(→FCM/APNs) 발송기, 펀드 리포트 알림부터 적용(2026-10-21). 새 글 알림은 아직 users.fcm_token·Mock`
- 147행 `- [ ] 실 FCM 전환(`PUSH_BACKEND=fcm` + 자격증명)` → `- [ ] 서버 PUSH_BACKEND=expo 전환 + EAS 에 FCM V1 키 업로드(docs/push_notification_setup.md 3·6장)`

- [ ] **9-3. 설정 가이드** — `docs/push_notification_setup.md` 0장 표에서
- `서버 발송 구조` 행 → 상태 `✅`, 비고 `expo(Expo Push) 발송기 추가 — PUSH_BACKEND=expo 로 실발송`
- `앱 패키지 expo-notifications` 행 → 상태 `✅ 설치`, 비고 `새 dev build 필요`
- `앱 설정 app.config.js` 행 → 상태 `✅ 연결`, 비고 `env EAS_PROJECT_ID·GOOGLE_SERVICES_JSON 으로 주입`
- 표 아래 문장 `5~7장(연결·확인)은 푸시 구현(설계 문서 12장 순서)이 끝난 뒤 진행한다.` → `구현은 끝났다(2026-10-21). 3장까지 마치면 5~7장으로 연결·확인한다.`

- [ ] **9-4. 커밋**

```bash
git add README.md docs/ROADMAP.md docs/push_notification_setup.md
git commit -m "docs: 펀드 리포트 알림(푸시·SSE) — README 환경변수·ROADMAP·설정 가이드 상태 갱신

(끝 두 줄 규칙 적용)"
```

---

## 배포 메모 (사용자)

1. 운영 서버 DB 마이그레이션: 배포 워크플로가 `alembic upgrade head` 를 돌리는지 확인(새 리비전 `b9c0d1e2f3a4`).
2. 서버 `/opt/stock_app/env/.env.production` 에 `PUSH_BACKEND=expo` — **EAS 에 FCM V1 키를 올린 뒤**에 바꾼다(먼저 바꾸면 Expo 가 `InvalidCredentials` 로 전부 실패 — 이력에 실패로 남을 뿐 서비스 영향은 없음).
3. celery beat 재시작(새 엔트리 `dispatch-scheduled-pushes`).

# 플랫폼별 단일 세션(중복 로그인 처리) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 계정은 플랫폼(web·app·admin)마다 마지막 로그인 1곳만 유효하게 하고, 밀려난 기기는 REST 401·게임 WS 즉시 끊기·시작/복귀 확인으로 로그아웃 + 안내한다.

**Architecture:** PostgreSQL `user_sessions(user_id, platform) → sid` 가 원본. 로그인 시 sid 를 새로 만들어 JWT(`sid`,`plt`)에 넣고, 모든 검증(`get_current_user`·게임 WS)이 DB sid 와 비교한다. 새 로그인은 Redis 채널 `auth:session:replaced` 로 알리고, 게임 서버가 구독해 이전 소켓을 즉시 닫는다(best-effort). 클라이언트는 401 `detail.code` / WS close reason 으로 문구를 구분한다.

**Tech Stack:** FastAPI · async SQLAlchemy · Alembic · redis.asyncio(fakeredis 테스트) · React(Vite, zustand, axios) · Expo RN(zustand, fetch)

**Spec:** `docs/superpowers/specs/2026-10-16-single-session-per-platform-design.md`

**공통 규칙(이 저장소)**
- 백엔드 테스트: `cd backend && uv run pytest -q -p no:warnings <경로>` (DB 는 sqlite in-memory, Redis 는 fakeredis — 실 env·Redis·KIS 미사용).
- web: `cd web_client && npx tsc --noEmit`, 빌드 `npx vite build --mode development --outDir <scratchpad>/wbuild`.
- mobile: `cd mobile && npx tsc --noEmit && npx jest` (**`npx expo lint` 금지, `npm install` 금지**).
- `git add` 는 경로를 하나씩. 커밋은 dev, 메시지 끝에 아래 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- env 실파일(.env.development/.env.production) 수정 금지.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `backend/shared/models.py` (수정) | `UserSession` 모델, `SESSION_PLATFORMS` |
| `backend/alembic/versions/a7b8c9d0e1f2_user_sessions.py` (신규) | 테이블 생성 |
| `backend/shared/security.py` (수정) | `create_access_token(sid=, platform=)` 선택 kwargs |
| `backend/shared/sessions.py` (신규) | 상수·`start_session`·`check_session`·`publish_session_replaced` |
| `backend/shared/auth.py` (수정) | `get_current_user` 세션 검증 + 401 `SESSION_REPLACED` |
| `backend/apps/auth/services/session_login.py` (신규) | `issue_login_token(db, redis, user, platform)` — 발급 공통 경로 |
| `backend/apps/auth/routers/auth.py` (수정) | `/login`=admin, `/guest` platform |
| `backend/apps/auth/schemas.py` (수정) | `GuestLoginRequest.platform` |
| `backend/apps/auth/social/store.py`·`service.py`·`routers/social.py` (수정) | grant 에 client, exchange 가 grant client 사용 |
| `backend/apps/auth/services/account_deletion.py` (수정) | 세션 행 명시 삭제(sqlite 테스트에서도 보장) |
| `backend/apps/trading_game/services/connection_manager.py` (수정) | 소켓별 (platform, sid), `close_replaced` |
| `backend/apps/trading_game/services/ws_bus.py` (수정) | `payload_channels`(페이로드 → async 핸들러) |
| `backend/apps/trading_game/routers/ws_gateway.py` (수정) | 핸드셰이크 세션 검증, 4401+reason, `on_session_replaced` |
| `backend/apps/trading_game/main.py` (수정) | `SESSION_REPLACED_CHANNEL` 구독 연결 |
| `backend/tests/conftest.py` (수정) | auth Redis 싱글턴도 fakeredis 로 격리 |
| `backend/tests/test_single_session.py` (신규) | 백엔드 테스트 전부 |
| `web_client/src/store/auth.ts`, `api/client.ts`, `api/gameClient.ts`, `api/auth.ts`, `hooks/useGameWebSocket.ts`, `pages/GamePage.tsx`, `components/Layout.tsx` (수정) | 사유 구분·시작/복귀 확인·guest platform |
| `mobile/src/lib/api/session-end.ts` (+ test, 신규) | 순수 함수: 사유 판정·문구·확인 간격 |
| `mobile/src/lib/api/auth-token.ts`, `http.ts`, `features/auth/store.ts`, `features/auth/api.ts`, `features/game/use-game-socket.ts`, `app/(tabs)/game.tsx`, `app/_layout.tsx` (수정) | 사유 전달·로그아웃·시작/복귀 확인·guest platform |

---

### Task 1: UserSession 모델 + 마이그레이션 + 토큰 클레임

**Files:**
- Modify: `backend/shared/models.py` (import 블록, `User` 클래스 아래)
- Create: `backend/alembic/versions/a7b8c9d0e1f2_user_sessions.py`
- Modify: `backend/shared/security.py:35-43`
- Test: `backend/tests/test_single_session.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_single_session.py` 새로 만든다.

```python
"""플랫폼별 단일 세션(중복 로그인 처리) — 스펙 docs/superpowers/specs/2026-10-16-single-session-per-platform-design.md.

DB 는 sqlite in-memory, Redis 는 fakeredis.
"""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole, UserSession
from shared.security import create_access_token, decode_token


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def _user(maker, uid: int = 1, role: UserRole = UserRole.FREE) -> User:
    async with maker() as db:
        u = User(id=uid, email=f"u{uid}@t.local", nickname=f"u{uid}", role=role, is_active=True)
        db.add(u)
        await db.commit()
        return u


def test_token_without_session_has_no_sid_claims():
    p = decode_token(create_access_token(subject=1, role="FREE"))
    assert "sid" not in p and "plt" not in p


def test_token_with_session_carries_sid_and_platform():
    p = decode_token(create_access_token(subject=1, role="FREE", sid="abc", platform="web"))
    assert p["sid"] == "abc" and p["plt"] == "web"


async def test_user_session_row_roundtrip(maker):
    await _user(maker)
    async with maker() as db:
        db.add(UserSession(user_id=1, platform="web", sid="s1"))
        await db.commit()
        row = await db.get(UserSession, (1, "web"))
    assert row is not None and row.sid == "s1"
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest -q -p no:warnings tests/test_single_session.py`
Expected: FAIL — `ImportError: cannot import name 'UserSession'`

- [ ] **Step 3: 모델 추가** — `shared/models.py` import 블록의 `from sqlalchemy import (` 안에 `CheckConstraint,` 를 `Boolean,` 바로 뒤에 추가하고, `class User` 정의 바로 아래(`class Board` 위)에 추가:

```python
SESSION_PLATFORMS = ("web", "app", "admin")


class UserSession(Base, TimestampMixin):
    """플랫폼(web/app/admin)별 현재 유효 로그인 1개. 새 로그인이 sid 를 덮어써 같은 플랫폼의 이전 토큰을 무효화한다."""

    __tablename__ = "user_sessions"
    __table_args__ = (
        CheckConstraint("platform IN ('web', 'app', 'admin')", name="ck_user_sessions_platform"),
    )

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    platform: Mapped[str] = mapped_column(String(16), primary_key=True)
    sid: Mapped[str] = mapped_column(String(64), nullable=False)
```

- [ ] **Step 4: 토큰 kwargs** — `shared/security.py` 의 `create_access_token` 을 교체:

```python
def create_access_token(
    *, subject: str | int, role: str, sid: str | None = None, platform: str | None = None
) -> str:
    """sid·platform 은 플랫폼별 단일 세션용(shared/sessions.py). 없으면 기존과 같은 토큰(레거시 호환)."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(subject),
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=EXPIRE_HOURS),
    }
    if sid is not None:
        payload["sid"] = sid
    if platform is not None:
        payload["plt"] = platform
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
```

- [ ] **Step 5: 마이그레이션** — `backend/alembic/versions/a7b8c9d0e1f2_user_sessions.py`:

```python
"""플랫폼별 단일 세션 — user_sessions(user_id, platform) → sid

Revision ID: a7b8c9d0e1f2
Revises: f2a3b4c5d6e7
Create Date: 2026-10-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_sessions",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("platform", sa.String(16), primary_key=True),
        sa.Column("sid", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("platform IN ('web', 'app', 'admin')", name="ck_user_sessions_platform"),
    )


def downgrade() -> None:
    op.drop_table("user_sessions")
```

- [ ] **Step 6: 통과 확인 + 리비전 체인 확인**

Run: `cd backend && uv run pytest -q -p no:warnings tests/test_single_session.py && uv run alembic heads`
Expected: 3 passed, heads 출력이 `a7b8c9d0e1f2 (head)` 1개.

- [ ] **Step 7: 커밋**

```bash
git add backend/shared/models.py backend/shared/security.py backend/alembic/versions/a7b8c9d0e1f2_user_sessions.py backend/tests/test_single_session.py
git commit -m "feat(auth): user_sessions 모델·마이그레이션 + 토큰 sid/plt 클레임(선택)"
```

---

### Task 2: 세션 서비스 `shared/sessions.py`

**Files:**
- Create: `backend/shared/sessions.py`
- Test: `backend/tests/test_single_session.py` (추가)

- [ ] **Step 1: 실패 테스트 추가** — 파일 상단 import 에 `import json`, `from fakeredis import aioredis as fake_aioredis`, `from shared import sessions` 추가 후 아래를 덧붙인다.

```python
async def test_start_session_replaces_sid_per_platform(maker):
    await _user(maker)
    async with maker() as db:
        s1 = await sessions.start_session(db, 1, "web")
        s2 = await sessions.start_session(db, 1, "web")
        a1 = await sessions.start_session(db, 1, "app")
    assert s1 != s2
    async with maker() as db:
        assert (await db.get(UserSession, (1, "web"))).sid == s2
        assert (await db.get(UserSession, (1, "app"))).sid == a1


@pytest.mark.parametrize(
    "payload, stored, ok",
    [
        ({"sub": "1"}, None, True),                                   # 레거시 토큰(sid 없음) 허용
        ({"sub": "1", "sid": "x", "plt": "web"}, None, False),        # 행 없음 → 거부
        ({"sub": "1", "sid": "x", "plt": "web"}, "y", False),         # sid 다름 → 거부
        ({"sub": "1", "sid": "x", "plt": "web"}, "x", True),          # 일치 → 허용
        ({"sub": "1", "sid": "x"}, "x", False),                       # plt 누락 sid 토큰 → 거부
    ],
)
async def test_check_session_rules(maker, payload, stored, ok):
    await _user(maker)
    if stored is not None:
        async with maker() as db:
            db.add(UserSession(user_id=1, platform="web", sid=stored))
            await db.commit()
    async with maker() as db:
        assert await sessions.check_session(db, 1, payload) is ok


async def test_publish_session_replaced_sends_new_sid():
    r = fake_aioredis.FakeRedis(decode_responses=True)
    ps = r.pubsub()
    await ps.subscribe(sessions.SESSION_REPLACED_CHANNEL)
    await ps.get_message(timeout=1)  # subscribe 확인 메시지
    await sessions.publish_session_replaced(r, 1, "web", "new-sid")
    msg = await ps.get_message(ignore_subscribe_messages=True, timeout=1)
    assert json.loads(msg["data"]) == {"user_id": 1, "platform": "web", "sid": "new-sid"}


async def test_publish_failure_is_swallowed():
    class Broken:
        async def publish(self, *_a):
            raise ConnectionError("down")

    await sessions.publish_session_replaced(Broken(), 1, "web", "s")  # 예외 없이 끝나야 함
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest -q -p no:warnings tests/test_single_session.py`
Expected: FAIL — `ImportError: cannot import name 'sessions'`

- [ ] **Step 3: 구현** — `backend/shared/sessions.py`:

```python
"""플랫폼별 단일 세션 — 발급(auth)·검증(모든 서비스)·즉시 끊기 알림(Redis)이 공유한다.

원본은 PostgreSQL user_sessions(user_id, platform) → sid. Redis 발행은 반응 속도용 best-effort 이며,
실패해도 다음 REST·WS 재접속에서 check_session 이 이전 토큰을 거부한다.
"""
from __future__ import annotations

import json
import logging
import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import SESSION_PLATFORMS, UserSession

log = logging.getLogger("shared.sessions")

SESSION_REPLACED = "SESSION_REPLACED"
SESSION_REPLACED_MESSAGE = "다른 기기에서 로그인되어 로그아웃됐어요."
SESSION_REPLACED_CHANNEL = "auth:session:replaced"


async def start_session(db: AsyncSession, user_id: int, platform: str) -> str:
    """새 sid 를 만들어 (user_id, platform) 행에 덮어쓰고 commit → sid. 같은 플랫폼의 이전 토큰은 이 시점부터 무효."""
    if platform not in SESSION_PLATFORMS:
        raise ValueError(f"unknown platform: {platform}")
    sid = secrets.token_urlsafe(24)
    for attempt in range(2):  # 동시 첫 로그인(INSERT 경합) 1회 재시도
        try:
            row = await db.get(UserSession, (user_id, platform))
            if row is None:
                db.add(UserSession(user_id=user_id, platform=platform, sid=sid))
            else:
                row.sid = sid
            await db.commit()
            return sid
        except IntegrityError:
            await db.rollback()
            if attempt == 1:
                raise
    raise RuntimeError("unreachable")


async def check_session(db: AsyncSession, user_id: int, payload: dict) -> bool:
    """토큰 payload 가 지금 유효한 세션인지. sid 없는 레거시 토큰은 허용(최대 12h 후 자연 만료)."""
    sid = payload.get("sid")
    if sid is None:
        return True
    platform = payload.get("plt")
    if platform not in SESSION_PLATFORMS:
        return False
    row = await db.get(UserSession, (user_id, platform))
    return row is not None and row.sid == sid


async def publish_session_replaced(redis, user_id: int, platform: str, sid: str) -> None:
    """같은 플랫폼의 이전 기기 즉시 끊기 알림(sid = 새 현재 sid). 실패는 로그만."""
    try:
        await redis.publish(
            SESSION_REPLACED_CHANNEL,
            json.dumps({"user_id": user_id, "platform": platform, "sid": sid}),
        )
    except Exception:
        log.warning("세션 교체 알림 발행 실패 user=%s platform=%s", user_id, platform, exc_info=True)
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest -q -p no:warnings tests/test_single_session.py`
Expected: 11 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/shared/sessions.py backend/tests/test_single_session.py
git commit -m "feat(auth): 세션 서비스 — start_session·check_session·교체 알림 발행"
```

---

### Task 3: `get_current_user` 세션 검증

**Files:**
- Modify: `backend/shared/auth.py:22-41`
- Test: `backend/tests/test_single_session.py` (추가)

- [ ] **Step 1: 실패 테스트 추가** — import 에 `import httpx`, `from fastapi import Depends, FastAPI`, `from shared.auth import get_current_user`, `from shared.database import get_db` 추가.

```python
@pytest.fixture
async def me_client(maker):
    """get_current_user 만 거치는 최소 앱 — GET /whoami."""
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(user: User = Depends(get_current_user)):
        return {"id": user.id}

    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_relogin_same_platform_rejects_old_token(maker, me_client):
    await _user(maker)
    async with maker() as db:
        old = create_access_token(subject=1, role="FREE", sid=await sessions.start_session(db, 1, "web"), platform="web")
        new = create_access_token(subject=1, role="FREE", sid=await sessions.start_session(db, 1, "web"), platform="web")
    r_old = await me_client.get("/whoami", headers=_bearer(old))
    assert r_old.status_code == 401
    assert r_old.json()["detail"]["code"] == "SESSION_REPLACED"
    assert (await me_client.get("/whoami", headers=_bearer(new))).status_code == 200


async def test_other_platform_token_stays_valid(maker, me_client):
    await _user(maker)
    async with maker() as db:
        app_tok = create_access_token(subject=1, role="FREE", sid=await sessions.start_session(db, 1, "app"), platform="app")
        await sessions.start_session(db, 1, "web")
    assert (await me_client.get("/whoami", headers=_bearer(app_tok))).status_code == 200


async def test_legacy_token_without_sid_is_allowed(maker, me_client):
    await _user(maker)
    legacy = create_access_token(subject=1, role="FREE")
    assert (await me_client.get("/whoami", headers=_bearer(legacy))).status_code == 200
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest -q -p no:warnings tests/test_single_session.py -k "relogin or other_platform or legacy"`
Expected: `test_relogin_same_platform_rejects_old_token` FAIL(200 반환), 나머지 PASS

- [ ] **Step 3: 구현** — `shared/auth.py` import 에 `from shared.sessions import SESSION_REPLACED, SESSION_REPLACED_MESSAGE, check_session` 추가, `get_current_user` 의 마지막 부분을 교체:

```python
    user = await db.get(User, int(payload.get("sub", 0)))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "사용자를 찾을 수 없습니다.")
    # 같은 플랫폼에서 다시 로그인했으면 이전 토큰 거부 — 클라이언트는 detail.code 로 안내 문구를 구분한다
    if not await check_session(db, user.id, payload):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            {"code": SESSION_REPLACED, "message": SESSION_REPLACED_MESSAGE},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
```

- [ ] **Step 4: 통과 + 회귀 확인**

Run: `cd backend && uv run pytest -q -p no:warnings`
Expected: 전체 PASS(기존 테스트 토큰은 sid 없음 → 레거시 허용이라 영향 없음)

- [ ] **Step 5: 커밋**

```bash
git add backend/shared/auth.py backend/tests/test_single_session.py
git commit -m "feat(auth): get_current_user 세션 검증 — 교체된 토큰은 401 SESSION_REPLACED"
```

---

### Task 4: 발급 공통 경로 + `/login`(admin)·`/guest`(platform)

**Files:**
- Create: `backend/apps/auth/services/session_login.py`
- Modify: `backend/apps/auth/routers/auth.py` (`login`, `guest_login`, import)
- Modify: `backend/apps/auth/schemas.py:15-18`
- Modify: `backend/tests/conftest.py` (auth Redis 격리 픽스처 추가)
- Test: `backend/tests/test_single_session.py` (추가)

- [ ] **Step 1: conftest 격리** — `backend/tests/conftest.py` 끝에 추가(로그인 시 발행이 실 Redis 로 새지 않게):

```python
@pytest.fixture(autouse=True)
def _isolate_auth_redis(monkeypatch):
    """auth 프로세스 Redis 싱글턴도 fakeredis 로 — 로그인 시 세션 교체 알림 발행이 실제 Redis 로 새지 않게."""
    from fakeredis import aioredis as fake_aioredis

    from apps.auth import deps as auth_deps

    monkeypatch.setattr(auth_deps, "_redis", fake_aioredis.FakeRedis(decode_responses=True))
    yield
```

- [ ] **Step 2: 실패 테스트 추가** — import 에 `from apps.auth.main import app as auth_app`, `from apps.auth.deps import get_redis as auth_get_redis` 추가.

```python
@pytest.fixture
async def auth_ctx(maker, monkeypatch):
    """auth 앱 + 공유 fakeredis(발행 확인용). 게스트 게이트는 켠다."""
    monkeypatch.setenv("AUTH_GUEST_ENABLED", "true")
    redis = fake_aioredis.FakeRedis(decode_responses=True)

    async def _db():
        async with maker() as s:
            yield s

    auth_app.dependency_overrides[get_db] = _db
    auth_app.dependency_overrides[auth_get_redis] = lambda: redis
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=auth_app), base_url="http://t") as c:
        yield c, redis
    auth_app.dependency_overrides.clear()


async def test_guest_default_platform_is_web(auth_ctx):
    c, _ = auth_ctx
    r = await c.post("/api/v1/auth/guest", json={"nickname": "주린이"})
    assert r.status_code == 200
    assert decode_token(r.json()["access_token"])["plt"] == "web"


async def test_guest_app_platform_and_relogin_publishes(auth_ctx):
    c, redis = auth_ctx
    ps = redis.pubsub()
    await ps.subscribe(sessions.SESSION_REPLACED_CHANNEL)
    await ps.get_message(timeout=1)
    r = await c.post("/api/v1/auth/guest", json={"nickname": "주린이", "platform": "app"})
    p = decode_token(r.json()["access_token"])
    assert p["plt"] == "app"
    msg = await ps.get_message(ignore_subscribe_messages=True, timeout=1)
    assert json.loads(msg["data"])["sid"] == p["sid"]


async def test_guest_rejects_admin_platform(auth_ctx):
    c, _ = auth_ctx
    r = await c.post("/api/v1/auth/guest", json={"nickname": "x", "platform": "admin"})
    assert r.status_code == 422


async def test_admin_login_uses_admin_platform(maker, auth_ctx):
    from shared.security import hash_password

    async with maker() as db:
        db.add(User(email="admin@stock.app", nickname="관리자", role=UserRole.ADMIN, is_active=True,
                    password_hash=hash_password("pw1234")))
        await db.commit()
    c, _ = auth_ctx
    r = await c.post("/api/v1/auth/login", json={"email": "admin@stock.app", "password": "pw1234"})
    assert r.status_code == 200
    assert decode_token(r.json()["access_token"])["plt"] == "admin"


async def test_login_succeeds_when_redis_publish_fails(auth_ctx):
    class Broken:
        async def publish(self, *_a):
            raise ConnectionError("down")

    c, _ = auth_ctx
    auth_app.dependency_overrides[auth_get_redis] = lambda: Broken()
    r = await c.post("/api/v1/auth/guest", json={"nickname": "주린이"})
    assert r.status_code == 200
```

- [ ] **Step 3: 실패 확인**

Run: `cd backend && uv run pytest -q -p no:warnings tests/test_single_session.py -k "guest or admin_login or redis_publish"`
Expected: FAIL — `KeyError: 'plt'` (아직 sid 없는 토큰), admin 422 테스트는 200 으로 FAIL

- [ ] **Step 4: 스키마** — `apps/auth/schemas.py` 상단에 `from typing import Literal` 이 없으면 추가하고 `GuestLoginRequest` 교체:

```python
class GuestLoginRequest(BaseModel):
    """임시 로그인 — 닉네임만 입력(개발용). platform 은 단일 세션 구분(web_client=web, 앱=app)."""

    nickname: str = Field(..., min_length=1, max_length=20, description="표시 닉네임")
    platform: Literal["web", "app"] = Field("web", description="로그인 플랫폼(미지정 시 web — 구 앱 빌드 호환)")
```

- [ ] **Step 5: 발급 서비스** — `backend/apps/auth/services/session_login.py`:

```python
"""로그인 토큰 발급 공통 경로 — 세션 시작(commit) → 토큰 → 같은 플랫폼 이전 기기 끊기 알림.

라우터(/login·/guest·/social/exchange)는 이 함수만 부른다. 세션 저장 실패면 토큰을 내주지 않는다(예외 전파).
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.security import create_access_token
from shared.sessions import publish_session_replaced, start_session


async def issue_login_token(db: AsyncSession, redis, user: User, platform: str) -> str:
    user_id, role = user.id, user.role.value
    sid = await start_session(db, user_id, platform)
    token = create_access_token(subject=user_id, role=role, sid=sid, platform=platform)
    await publish_session_replaced(redis, user_id, platform, sid)
    return token
```

- [ ] **Step 6: 라우터** — `apps/auth/routers/auth.py`:
  - import 에 `from ..services.session_login import issue_login_token` 추가, `from shared.security import create_access_token, verify_password` → `from shared.security import verify_password`.
  - `login` 시그니처에 `redis=Depends(get_redis)` 추가, 마지막 발급 줄 교체:
```python
@router.post("/login", response_model=schemas.TokenResponse)
async def login(
    payload: schemas.LoginRequest, db: AsyncSession = Depends(get_db), redis=Depends(get_redis)
):
    # ... 기존 이메일·비밀번호·is_active 검증 그대로 ...
    token = await issue_login_token(db, redis, user, "admin")  # /login 은 admin_web 전용
    return schemas.TokenResponse(access_token=token, user=user)
```
  - `guest_login` 시그니처에 `redis=Depends(get_redis)` 추가, 마지막 발급 줄 교체:
```python
    token = await issue_login_token(db, redis, user, payload.platform)
    return schemas.TokenResponse(access_token=token, user=user)
```
  - 운영 세션은 `expire_on_commit=False`(`shared/database.py:28`)라 commit 후 `user` 직렬화에 refresh 불필요.

- [ ] **Step 7: 통과 + 회귀**

Run: `cd backend && uv run pytest -q -p no:warnings`
Expected: 전체 PASS(`test_auth_guest_gate.py` 포함 — 기본 platform=web 이라 기존 요청 바디 그대로 동작)

- [ ] **Step 8: 커밋**

```bash
git add backend/apps/auth/services/session_login.py backend/apps/auth/routers/auth.py backend/apps/auth/schemas.py backend/tests/conftest.py backend/tests/test_single_session.py
git commit -m "feat(auth): 로그인 발급 공통 경로 — /login=admin·/guest platform 세션 시작 + 교체 알림"
```

---

### Task 5: 간편 로그인 — grant 에 client, exchange 가 grant 의 플랫폼 사용

**Files:**
- Modify: `backend/apps/auth/social/store.py` (`ExchangeGrant`, `issue_exchange_code`, `consume_exchange_code`)
- Modify: `backend/apps/auth/social/service.py` (`complete_social_login`, `redeem_exchange_code`)
- Modify: `backend/apps/auth/routers/social.py` (callback 이 client 전달, exchange 발급 교체)
- Test: `backend/tests/test_single_session.py` (추가)

- [ ] **Step 1: 실패 테스트 추가** — import 에 `import base64`, `import hashlib`, `from apps.auth.social.store import SocialStore, get_social_store` 추가.

```python
async def test_grant_keeps_client_and_old_grant_defaults_to_web():
    r = fake_aioredis.FakeRedis(decode_responses=True)
    store = SocialStore(r)
    code = await store.issue_exchange_code(7, "cc", "app")
    assert (await store.consume_exchange_code(code)).client == "app"
    # 배포 전 발급된 grant(client 없음) → web
    await r.set("auth:social:code:old", json.dumps({"user_id": 7, "cc": "cc"}))
    assert (await store.consume_exchange_code("old")).client == "web"


async def test_exchange_uses_grant_client_not_body(maker):
    verifier = "dBjftJeZ4CVP-mJ0z9-iFGc8Ld2ZRY0kbtiYn3sV1mA"
    cc = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    await _user(maker, uid=5)
    store = SocialStore(fake_aioredis.FakeRedis(decode_responses=True))
    code = await store.issue_exchange_code(5, cc, "app")

    async def _db():
        async with maker() as s:
            yield s

    auth_app.dependency_overrides[get_db] = _db
    auth_app.dependency_overrides[get_social_store] = lambda: store
    auth_app.dependency_overrides[auth_get_redis] = lambda: fake_aioredis.FakeRedis(decode_responses=True)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=auth_app), base_url="http://t") as c:
            r = await c.post("/api/v1/auth/social/exchange",
                             json={"code": code, "code_verifier": verifier, "platform": "web"})
    finally:
        auth_app.dependency_overrides.clear()
    assert r.status_code == 200
    assert decode_token(r.json()["access_token"])["plt"] == "app"
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest -q -p no:warnings tests/test_single_session.py -k "grant or exchange"`
Expected: FAIL — `TypeError: issue_exchange_code() takes 3 positional arguments but 4 were given`

- [ ] **Step 3: store** — `apps/auth/social/store.py`:

```python
@dataclass(frozen=True)
class ExchangeGrant:
    """교환 코드에 묶인 사용자·verifier challenge·로그인 플랫폼(서명된 state 의 client: web|app)."""

    user_id: int
    cc: str
    client: str = "web"
```

```python
    async def issue_exchange_code(self, user_id: int, cc: str, client: str = "web") -> str:
        code = secrets.token_urlsafe(32)
        value = json.dumps({"user_id": user_id, "cc": cc, "client": client})
        await self._redis.set(_CODE_KEY.format(code), value, ex=EXCHANGE_CODE_TTL_SECONDS)
        return code
```

`consume_exchange_code` 의 마지막 부분 교체:

```python
        user_id, cc = data.get("user_id"), data.get("cc")
        if not isinstance(user_id, int) or isinstance(user_id, bool) or not isinstance(cc, str):
            return None
        client = data.get("client")
        return ExchangeGrant(user_id=user_id, cc=cc, client=client if client in ("web", "app") else "web")
```

- [ ] **Step 4: service** — `apps/auth/social/service.py`:
  - `complete_social_login` 시그니처의 `cc: str,` 다음에 `client: str = "web",` 추가, 마지막 줄을 `return await store.issue_exchange_code(user.id, cc, client)` 로.
  - `redeem_exchange_code` 교체(docstring 첫 줄만 바뀌고 나머지 문단 유지):

```python
async def redeem_exchange_code(
    db: AsyncSession, store: SocialStore, code: str, code_verifier: str | None
) -> tuple[User, str]:
    """교환 코드(1회) + verifier → (활성 사용자, 로그인 플랫폼). 실패는 ExchangeError.

    코드는 GETDEL 로 먼저 소모하므로 verifier 가 틀려도 재시도할 수 없다.
    verifier 불일치는 '없는 코드'와 같은 401 문구(코드 존재 여부를 드러내지 않음).
    """
    grant = await store.consume_exchange_code(code)
    if grant is None or not verifier_matches(code_verifier, grant.cc):
        raise ExchangeError(401, INVALID_CODE_MESSAGE)
    user = await db.get(User, grant.user_id)
    if user is None:
        raise ExchangeError(401, "사용자를 찾을 수 없습니다.")
    if not user.is_active:
        raise ExchangeError(403, "비활성화된 계정입니다.")
    return user, grant.client
```

- [ ] **Step 5: router** — `apps/auth/routers/social.py`:
  - import 에 `from ..deps import get_redis`, `from ..services.session_login import issue_login_token` 추가. `create_access_token` 이 이 파일에서 더 쓰이지 않으면 import 제거(`grep -n create_access_token apps/auth/routers/social.py`).
  - callback 의 `complete_social_login(...)` 호출 인자에 `client=payload.client,` 추가(`cc=payload.cc,` 다음).
  - exchange 교체:

```python
@router.post("/exchange", response_model=schemas.TokenResponse)
async def exchange(
    payload: schemas.SocialExchangeRequest,
    db: AsyncSession = Depends(get_db),
    store: SocialStore = Depends(get_social_store),
    redis=Depends(get_redis),
):
    """일회용 교환 코드 + code_verifier → 서비스 JWT. 플랫폼은 서명된 state 에서 온 grant 의 client(요청 바디 무시)."""
    try:
        user, client = await redeem_exchange_code(db, store, payload.code, payload.code_verifier)
    except ExchangeError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc
    token = await issue_login_token(db, redis, user, client)
    return schemas.TokenResponse(access_token=token, user=user)
```

- [ ] **Step 6: 통과 + 회귀(기존 social 테스트 포함)**

Run: `cd backend && uv run pytest -q -p no:warnings`
Expected: 전체 PASS. `test_social_login.py`·`test_social_core.py` 에서 `redeem_exchange_code` 반환을 User 로 가정한 곳이 깨지면 그 언패킹만 `user, _ = await redeem_exchange_code(...)` 로 고친다(동작 변경 아님). `test_social_login.py` 의 exchange 응답 토큰 검사(`decode_token`)가 `plt` 등 추가 클레임으로 깨지지 않는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add backend/apps/auth/social/store.py backend/apps/auth/social/service.py backend/apps/auth/routers/social.py backend/tests/test_single_session.py
git commit -m "feat(auth): 간편 로그인 세션 — 교환 코드 grant 에 client 저장, exchange 가 grant 플랫폼으로 발급"
```
(기존 social 테스트를 고쳤다면 그 파일도 경로 지정해 add)

---

### Task 6: 회원 탈퇴 시 세션 행 삭제

**Files:**
- Modify: `backend/apps/auth/services/account_deletion.py:64-74`
- Test: `backend/tests/test_single_session.py` (추가)

- [ ] **Step 1: 실패 테스트**

```python
async def test_delete_account_removes_sessions(maker):
    from apps.auth.services.account_deletion import CONFIRM_PHRASE, delete_account

    await _user(maker, uid=9)
    async with maker() as db:
        await sessions.start_session(db, 9, "web")
        await sessions.start_session(db, 9, "app")
    async with maker() as db:
        user = await db.get(User, 9)
        await delete_account(db, user, confirm=CONFIRM_PHRASE, redis=fake_aioredis.FakeRedis(decode_responses=True))
    async with maker() as db:
        assert await db.get(UserSession, (9, "web")) is None
        assert await db.get(UserSession, (9, "app")) is None
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest -q -p no:warnings tests/test_single_session.py -k delete_account`
Expected: FAIL — 행이 남음(sqlite 는 FK cascade 미적용)

- [ ] **Step 3: 구현** — `account_deletion.py` 의 `from shared.models import ...` 에 `UserSession` 추가, `await db.execute(delete(User).where(User.id == uid))` 바로 앞에:

```python
        # 운영 PG 는 FK CASCADE 로도 지워지지만, 방언(sqlite 테스트) 무관하게 명시 삭제
        await db.execute(delete(UserSession).where(UserSession.user_id == uid))
```

- [ ] **Step 4: 통과 + 회귀**

Run: `cd backend && uv run pytest -q -p no:warnings`
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/auth/services/account_deletion.py backend/tests/test_single_session.py
git commit -m "feat(auth): 회원 탈퇴 시 user_sessions 행 삭제"
```

---

### Task 7: 게임 WS — 핸드셰이크 검증 + 즉시 끊기

**Files:**
- Modify: `backend/apps/trading_game/services/connection_manager.py` (`__init__`, `connect`, `disconnect`, `close_all`, 새 `close_replaced`)
- Modify: `backend/apps/trading_game/services/ws_bus.py` (`run_subscriber` 에 `payload_channels`)
- Modify: `backend/apps/trading_game/routers/ws_gateway.py` (`game_stream`, 새 `on_session_replaced`)
- Modify: `backend/apps/trading_game/main.py` (lifespan 구독)
- Test: `backend/tests/test_single_session.py` (추가)

- [ ] **Step 1: 실패 테스트** — import 에 `import asyncio`, `import fakeredis`, `from fastapi.testclient import TestClient`, `from starlette.websockets import WebSocketDisconnect`, `from apps.trading_game.routers import ws_gateway`, `from apps.trading_game.services import ws_bus`, `from apps.trading_game.services.connection_manager import ConnectionManager` 추가.

```python
class _WS:
    def __init__(self):
        self.closed: tuple[int, str] | None = None

    async def accept(self):
        pass

    async def send_text(self, _t):
        pass

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)


async def test_close_replaced_closes_only_stale_same_platform_sockets():
    m = ConnectionManager()
    old_web, new_web, app_ws, legacy = _WS(), _WS(), _WS(), _WS()
    await m.connect(1, old_web, platform="web", sid="old")
    await m.connect(1, new_web, platform="web", sid="new")
    await m.connect(1, app_ws, platform="app", sid="a")
    await m.connect(1, legacy)  # 레거시 토큰(플랫폼 모름)
    await m.close_replaced(1, "web", "new")
    assert old_web.closed == (4401, "SESSION_REPLACED")
    assert new_web.closed is None and app_ws.closed is None and legacy.closed is None
    assert m.has_user(1)  # 나머지 소켓은 유지


async def test_bus_payload_channel_calls_async_handler():
    server = fakeredis.FakeServer()

    def factory():
        return fake_aioredis.FakeRedis(server=server, decode_responses=True)

    got: list[dict] = []

    async def handler(data: dict) -> None:
        got.append(data)

    stop, ready = asyncio.Event(), asyncio.Event()
    task = asyncio.create_task(ws_bus.run_subscriber(
        ConnectionManager(), stop, factory, ready=ready,
        payload_channels={sessions.SESSION_REPLACED_CHANNEL: handler},
    ))
    await asyncio.wait_for(ready.wait(), 2)
    await sessions.publish_session_replaced(factory(), 1, "web", "s2")
    for _ in range(200):
        if got:
            break
        await asyncio.sleep(0.01)
    stop.set()
    await asyncio.wait_for(task, 3)
    assert got == [{"user_id": 1, "platform": "web", "sid": "s2"}]


class _Row:
    def __init__(self, sid):
        self.sid = sid


class _ActiveUser:
    is_active = True


class _SessionDB:
    """User 는 활성, UserSession 은 현재 sid='cur' 로 응답하는 가짜 세션."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, model, _id):
        return _Row("cur") if model is UserSession else _ActiveUser()


def test_ws_handshake_rejects_replaced_token_with_reason(monkeypatch):
    monkeypatch.setattr(ws_gateway, "manager", ConnectionManager())
    monkeypatch.setattr(ws_gateway, "AsyncSessionLocal", lambda: _SessionDB())
    app = FastAPI()
    app.include_router(ws_gateway.router)
    stale = create_access_token(subject=1, role="FREE", sid="old", platform="web")
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as ei:
            with client.websocket_connect(f"/ws/game/stream?token={stale}") as ws:
                ws.receive_text()
    assert ei.value.code == 4401
    assert ei.value.reason == "SESSION_REPLACED"
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest -q -p no:warnings tests/test_single_session.py -k "close_replaced or payload_channel or handshake"`
Expected: FAIL — `TypeError: connect() got an unexpected keyword argument 'platform'` 등

- [ ] **Step 3: ConnectionManager** — `connection_manager.py`:

`__init__` 끝에 추가:
```python
        self._meta: dict[WebSocket, tuple[str | None, str | None]] = {}  # 로그인 socket -> (platform, sid)
```

`connect`·`disconnect` 교체:
```python
    async def connect(self, user_id: int, ws: WebSocket, platform: str | None = None, sid: str | None = None) -> None:
        await ws.accept()
        async with self._lock:
            self._conns.setdefault(user_id, set()).add(ws)
            self._meta[ws] = (platform, sid)

    async def disconnect(self, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            self._meta.pop(ws, None)
            conns = self._conns.get(user_id)
            if conns:
                conns.discard(ws)
                if not conns:
                    self._conns.pop(user_id, None)
```

`close_all` 안의 `self._conns.clear()` 다음 줄에 `self._meta.clear()` 추가. 그리고 `close_all` 바로 위에 추가:

```python
    async def close_replaced(self, user_id: int, platform: str, current_sid: str) -> None:
        """같은 플랫폼 새 로그인 → 그 유저·플랫폼 소켓 중 sid 가 다른(이전) 것만 4401 로 닫는다.
        방금 붙은 새 소켓(current_sid)·다른 플랫폼·레거시(플랫폼 모름) 소켓은 유지."""
        async with self._lock:
            stale = []
            for ws in self._conns.get(user_id, set()):
                plt, sid = self._meta.get(ws, (None, None))
                if plt == platform and sid != current_sid:
                    stale.append(ws)
        for ws in stale:
            await self.disconnect(user_id, ws)
            with contextlib.suppress(Exception):
                await asyncio.wait_for(ws.close(code=4401, reason="SESSION_REPLACED"), timeout=SEND_TIMEOUT)
```

- [ ] **Step 4: ws_bus** — `ws_bus.py`:
  - `from typing import Callable` → `from typing import Awaitable, Callable`
  - `run_subscriber` 시그니처의 `extra_channels: ...` 다음 줄에 `payload_channels: dict[str, Callable[[dict], Awaitable[None]]] | None = None,` 추가.
  - docstring 에 한 줄: `payload_channels: 같은 연결로 받을 추가 채널 → JSON 페이로드를 받는 async 핸들러(예: 세션 교체 즉시 끊기).`
  - 본문 `extra = dict(extra_channels or {})` 다음에 `payload_handlers = dict(payload_channels or {})`.
  - 구독부 교체:
```python
            if extra or payload_handlers:
                await pubsub.subscribe(*extra.keys(), *payload_handlers.keys())
```
  - 메시지 처리 `try:` 블록 교체:
```python
                try:
                    channel = msg.get("channel") if msg.get("type") == "message" else None
                    handler = extra.get(channel) if channel is not None else None
                    if handler is not None:
                        handler()
                        continue
                    payload_handler = payload_handlers.get(channel) if channel is not None else None
                    if payload_handler is not None:
                        await payload_handler(json.loads(msg["data"]))
                        continue
                    await dispatch(manager, msg)
                except Exception:
                    log.exception("WS 버스 메시지 전달 실패 — skip")
```

- [ ] **Step 5: gateway** — `ws_gateway.py` import 에 `from shared.sessions import SESSION_REPLACED, check_session` 추가. `game_stream` 의 사용자 조회부터 `manager.connect` 까지를 교체:

```python
    # REST 와 동일하게 유저 존재·활성 + 단일 세션 검증(같은 플랫폼에서 다시 로그인한 이전 토큰 차단)
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        session_ok = user is not None and user.is_active and await check_session(db, user_id, payload)
    if user is None or not user.is_active:
        await ws.accept()
        await ws.close(code=4401)
        return
    if not session_ok:
        await ws.accept()
        await ws.close(code=4401, reason=SESSION_REPLACED)  # 4401 재사용 — 설치된 클라이언트가 재연결을 멈추는 코드
        return
    await manager.connect(user_id, ws, platform=payload.get("plt"), sid=payload.get("sid"))
```

파일 끝에 추가:
```python
async def on_session_replaced(data: dict) -> None:
    """auth 가 발행한 세션 교체 알림(버스 payload_channels) → 이 인스턴스의 이전 소켓 즉시 닫기."""
    try:
        user_id, platform, sid = int(data["user_id"]), str(data["platform"]), str(data["sid"])
    except (KeyError, TypeError, ValueError):
        return
    await manager.close_replaced(user_id, platform, sid)
```

- [ ] **Step 6: main 구독** — `apps/trading_game/main.py` import 에 `from shared.sessions import SESSION_REPLACED_CHANNEL` 추가, lifespan 의 버스 생성 교체(`ws_gateway` 는 이미 import 돼 있음 — `ws_gateway._sentiment_loop` 사용 중):

```python
    bus = asyncio.create_task(ws_bus.run_subscriber(
        manager, stop,
        extra_channels={position_cache.DIRTY_CHANNEL: position_cache.mark_dirty_local},
        payload_channels={SESSION_REPLACED_CHANNEL: ws_gateway.on_session_replaced},
    ))
```

- [ ] **Step 7: 통과 + 회귀**

Run: `cd backend && uv run pytest -q -p no:warnings`
Expected: 전체 PASS(`test_game_ws_public`·`test_scaling_ws_bus` 포함 — 기존 테스트 토큰은 sid 없음, 가짜 세션 get 은 sid 검사까지 가지 않음)

- [ ] **Step 8: 커밋**

```bash
git add backend/apps/trading_game/services/connection_manager.py backend/apps/trading_game/services/ws_bus.py backend/apps/trading_game/routers/ws_gateway.py backend/apps/trading_game/main.py backend/tests/test_single_session.py
git commit -m "feat(game): 단일 세션 WS — 핸드셰이크 검증(4401 SESSION_REPLACED) + 세션 교체 즉시 끊기"
```

---

### Task 8: web_client — 사유 구분·시작/복귀 확인·guest platform

**Files:**
- Modify: `web_client/src/store/auth.ts`
- Modify: `web_client/src/api/client.ts`, `web_client/src/api/gameClient.ts`
- Modify: `web_client/src/api/auth.ts`
- Modify: `web_client/src/hooks/useGameWebSocket.ts`
- Modify: `web_client/src/pages/GamePage.tsx`
- Modify: `web_client/src/components/Layout.tsx`

(web_client 는 단위 테스트 러너가 없다 → tsc·빌드·Task 10 브라우저로 검증)

- [ ] **Step 1: auth API** — `api/auth.ts`: 타입 import 에 `UserOut` 추가, `guestLogin` 바디를 `{ nickname, platform: 'web' }` 로, 그리고 추가:

```typescript
/** 현재 사용자(세션 확인용) — GET /auth/me. authClient 엔 Bearer 인터셉터가 없어 토큰을 직접 넘긴다 */
export const fetchMe = async (token: string): Promise<UserOut> => {
  const { data } = await authClient.get<UserOut>('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
  return data
}
```

- [ ] **Step 2: store** — `store/auth.ts`:

import 를 `import { deleteAccount as deleteAccountApi, fetchMe, guestLogin } from '../api/auth'` 로. `bearerToken` 아래에 추가:
```typescript
/** 세션 종료 사유 — 서버 401 detail.code / WS close reason 이 'SESSION_REPLACED' 면 replaced */
export type SessionEndReason = 'expired' | 'replaced'

const SESSION_END_MESSAGE: Record<SessionEndReason, string> = {
  expired: '로그인이 만료되었어요. 다시 로그인해 주세요',
  replaced: '다른 기기에서 로그인되어 로그아웃됐어요',
}

/** 401 응답 본문 → 사유. {detail:{code:'SESSION_REPLACED'}} 만 replaced */
export const reasonFromBody = (data: unknown): SessionEndReason => {
  const detail = typeof data === 'object' && data !== null && 'detail' in data ? data.detail : undefined
  return typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'SESSION_REPLACED'
    ? 'replaced'
    : 'expired'
}

const VALIDATE_INTERVAL_MS = 60_000
let lastValidatedAt = 0
```

`AuthState` 의 `expireSession` 선언을 교체하고 `validateSession` 추가:
```typescript
  expireSession: (rejectedToken: string | null, reason?: SessionEndReason) => void
  /** 시작·탭 복귀 시 GET /auth/me 로 세션 확인. force=false 면 마지막 확인 60초 이내 생략. 네트워크 오류는 무시 */
  validateSession: (force?: boolean) => Promise<void>
```

구현의 `expireSession` 교체 + `validateSession` 추가:
```typescript
  expireSession: (rejectedToken, reason = 'expired') => {
    if (rejectedToken === null || rejectedToken !== get().token) return
    get().logout()
    // 여러 요청이 동시에 401 이어도 첫 호출만 여기까지 온다(이후엔 token=null) → 토스트 1회
    showToast(SESSION_END_MESSAGE[reason])
  },

  validateSession: async (force = false) => {
    const { token } = get()
    if (!token) return
    const now = Date.now()
    if (!force && now - lastValidatedAt < VALIDATE_INTERVAL_MS) return
    lastValidatedAt = now
    try {
      const user = await fetchMe(token)
      if (get().token !== token) return // 확인 중 로그아웃·재로그인됨
      localStorage.setItem(USER_KEY, JSON.stringify(user))
      set({ user })
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        get().expireSession(token, reasonFromBody(e.response.data))
      }
      // 네트워크 오류·5xx 는 무시(오프라인에서 로그아웃시키지 않음)
    }
  },
```

- [ ] **Step 3: 인터셉터** — `api/client.ts`·`api/gameClient.ts` 의 import 에 `reasonFromBody` 추가, 401 분기의 호출을 각각:

```typescript
      useAuthStore.getState().expireSession(
        bearerToken(err.config?.headers?.Authorization),
        reasonFromBody(err.response.data),
      )
```
(`client.ts` 는 `if (err.response?.status === 401)` 블록 안, `gameClient.ts` 는 `axios.isAxiosError(err) && err.response?.status === 401` 블록 안 — 둘 다 `err.response` 존재가 보장됨. TS 가 좁히지 못하면 `err.response?.data`)

- [ ] **Step 4: WS 훅** — `hooks/useGameWebSocket.ts`: 시그니처 `onAuthFailed: (reason: string) => void`, onclose 의 `onAuthFailedRef.current()` → `onAuthFailedRef.current(e.reason)`. 주석의 "onAuthFailed 호출" → "onAuthFailed(close reason) 호출".

- [ ] **Step 5: GamePage** — WS 콜백 교체:

```tsx
  // 4401 → 로그아웃 + 안내(reason 'SESSION_REPLACED' = 다른 기기 로그인, 그 외 만료)
  useGameWebSocket(token, ready, (reason) =>
    expireSession(token, reason === 'SESSION_REPLACED' ? 'replaced' : 'expired'),
  )
```

- [ ] **Step 6: Layout 시작/복귀 확인** — `components/Layout.tsx` 의 `fetchBoards` effect 바로 아래에:

```tsx
  // 시작·탭 복귀 시 세션 확인 — 블로그처럼 인증 요청이 없는 화면에서도 만료·다른 기기 로그인을 반영
  useEffect(() => {
    const validate = useAuthStore.getState().validateSession
    void validate(true)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void validate()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
```

- [ ] **Step 7: 검증**

Run: `cd web_client && npx tsc --noEmit && npx vite build --mode development --outDir <scratchpad>/wbuild`
Expected: 오류 없음, `✓ built`

- [ ] **Step 8: 커밋**

```bash
git add web_client/src/store/auth.ts web_client/src/api/client.ts web_client/src/api/gameClient.ts web_client/src/api/auth.ts web_client/src/hooks/useGameWebSocket.ts web_client/src/pages/GamePage.tsx web_client/src/components/Layout.tsx
git commit -m "feat(web): 단일 세션 — 다른 기기 로그인 안내 구분·시작/복귀 세션 확인·게스트 platform=web"
```

---

### Task 9: mobile — 사유 구분·4401 로그아웃·시작/복귀 확인·guest platform

**Files:**
- Create: `mobile/src/lib/api/session-end.ts`, `mobile/src/lib/api/session-end.test.ts`
- Modify: `mobile/src/lib/api/auth-token.ts`, `mobile/src/lib/api/http.ts:62-73`
- Modify: `mobile/src/features/auth/store.ts`, `mobile/src/features/auth/api.ts`
- Modify: `mobile/src/features/game/use-game-socket.ts:22-29,75-81`
- Modify: `mobile/src/app/(tabs)/game.tsx` (useGameSocket 콜백)
- Modify: `mobile/src/app/_layout.tsx`

- [ ] **Step 1: 실패 테스트** — `mobile/src/lib/api/session-end.test.ts`:

```typescript
import { reasonFromBody, sessionEndMessage, shouldValidate, VALIDATE_INTERVAL_MS } from './session-end';

describe('reasonFromBody', () => {
  test('detail.code SESSION_REPLACED → replaced', () => {
    expect(reasonFromBody({ detail: { code: 'SESSION_REPLACED', message: 'x' } })).toBe('replaced');
  });
  test('그 외(문자열 detail·빈 본문) → expired', () => {
    expect(reasonFromBody({ detail: '유효하지 않은 토큰입니다.' })).toBe('expired');
    expect(reasonFromBody(undefined)).toBe('expired');
    expect(reasonFromBody('text')).toBe('expired');
  });
});

describe('sessionEndMessage', () => {
  test('사유별 문구', () => {
    expect(sessionEndMessage('replaced')).toBe('다른 기기에서 로그인되어 로그아웃됐어요');
    expect(sessionEndMessage('expired')).toBe('로그인이 만료되었어요. 다시 로그인해 주세요');
  });
});

describe('shouldValidate', () => {
  test('force 면 항상', () => {
    expect(shouldValidate(1_000, 1_001, true)).toBe(true);
  });
  test('60초 이내면 생략, 지나면 확인', () => {
    expect(shouldValidate(0, VALIDATE_INTERVAL_MS - 1, false)).toBe(false);
    expect(shouldValidate(0, VALIDATE_INTERVAL_MS, false)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/lib/api/session-end.test.ts`
Expected: FAIL — `Cannot find module './session-end'`

- [ ] **Step 3: 순수 함수** — `mobile/src/lib/api/session-end.ts`:

```typescript
/** 세션 종료 사유 판정·안내 문구·확인 간격 — http 클라이언트·auth store·게임 소켓이 공유(web store/auth.ts 와 같은 규칙) */
export type SessionEndReason = 'expired' | 'replaced';

export const VALIDATE_INTERVAL_MS = 60_000;

/** 401 응답 본문 → 사유. {detail:{code:'SESSION_REPLACED'}} 만 replaced */
export function reasonFromBody(body: unknown): SessionEndReason {
  const detail = typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
  return typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'SESSION_REPLACED'
    ? 'replaced'
    : 'expired';
}

export function sessionEndMessage(reason: SessionEndReason): string {
  return reason === 'replaced'
    ? '다른 기기에서 로그인되어 로그아웃됐어요'
    : '로그인이 만료되었어요. 다시 로그인해 주세요';
}

/** 시작(force)은 항상, 포그라운드 복귀는 마지막 확인 후 60초가 지났을 때만 */
export function shouldValidate(lastAt: number, now: number, force: boolean): boolean {
  return force || now - lastAt >= VALIDATE_INTERVAL_MS;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd mobile && npx jest src/lib/api/session-end.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: auth-token / http** — `auth-token.ts` 의 `onUnauthorized`·`registerUnauthorizedHandler`·`notifyUnauthorized` 를 교체(상단에 `import type { SessionEndReason } from './session-end';`):

```typescript
let onUnauthorized: ((rejectedToken: string | null, reason: SessionEndReason) => void) | null = null;

/** 401 응답을 받았을 때 실행할 콜백을 등록한다(auth store 의 expireSession). */
export function registerUnauthorizedHandler(
  handler: ((rejectedToken: string | null, reason: SessionEndReason) => void) | null,
): void {
  onUnauthorized = handler;
}

/** rejectedToken = 401 받은 요청에 실었던 토큰(재로그인 직후 이전 요청의 401 이 새 세션을 지우지 않게) */
export function notifyUnauthorized(rejectedToken: string | null, reason: SessionEndReason): void {
  onUnauthorized?.(rejectedToken, reason);
}
```
(파일 주석 "둘 중 어느 쪽도 import하지 않는다" 는 유지 — session-end 는 순수 모듈이라 순환 없음)

`http.ts` 에 `import { reasonFromBody } from './session-end';` 추가, 401 분기 교체(`token` 은 함수 위쪽에서 요청에 실은 값):
```typescript
    if (res.status === 401) {
      notifyUnauthorized(token, reasonFromBody(body));
    }
```

- [ ] **Step 6: auth api** — `features/auth/api.ts`: `guestLogin` 바디 `{ nickname, platform: 'app' }`, 추가:

```typescript
/** 현재 사용자(세션 확인용) — GET /api/v1/auth/me. 401 은 http 클라이언트가 notifyUnauthorized 로 처리 */
export async function fetchMe(): Promise<User> {
  return toUser(await authApi.get<RawUser>('/api/v1/auth/me'));
}
```

- [ ] **Step 7: auth store** — `features/auth/store.ts`:
  - 순환 확인 먼저: `grep -rn "features/auth" mobile/src/ui` → 결과 없어야 함(있으면 showToast 를 `@/ui/app-toast` 에서 직접 import).
  - import 추가: `import { sessionEndMessage, shouldValidate, type SessionEndReason } from '@/lib/api/session-end';`, `import { showToast } from '@/ui';`, api import 에 `fetchMe`.
  - `AuthState` 에 추가:
```typescript
  /** 서버가 토큰을 거부(401·WS 4401) — 거부된 토큰이 현재 토큰일 때만 로그아웃 + 안내 1회 */
  expireSession: (rejectedToken: string | null, reason: SessionEndReason) => void;
  /** 실행·포그라운드 복귀 시 GET /auth/me 로 세션 확인(force=false 면 60초 이내 생략, 네트워크 오류 무시) */
  validateSession: (force?: boolean) => Promise<void>;
```
  - `persist` 함수 아래에 `let lastValidatedAt = 0;`
  - 구현 추가(`deleteAccount` 다음):
```typescript
  expireSession: (rejectedToken, reason) => {
    if (rejectedToken === null || rejectedToken !== get().token) return;
    get().logout();
    showToast(sessionEndMessage(reason));
  },

  validateSession: async (force = false) => {
    const { token } = get();
    if (!token) return;
    const now = Date.now();
    if (!shouldValidate(lastValidatedAt, now, force)) return;
    lastValidatedAt = now;
    try {
      const user = await fetchMe();
      if (get().token !== token) return;
      set({ user });
      persist(token, user).catch(() => {});
    } catch {
      // 401 은 http 클라이언트 → notifyUnauthorized → expireSession 이 처리. 네트워크 오류·5xx 는 무시
    }
  },
```
  - 파일 끝 핸들러 교체:
```typescript
// http 클라이언트가 401 을 받으면 사유별 안내와 함께 로그아웃(web client interceptor 와 동일 동작)
registerUnauthorizedHandler((rejectedToken, reason) => {
  useAuthStore.getState().expireSession(rejectedToken, reason);
});
```

- [ ] **Step 8: 게임 소켓 + game.tsx** — `use-game-socket.ts`: 시그니처 `onAuthFailed: (reason: string) => void`, onclose 의 `onAuthFailedRef.current();` → `onAuthFailedRef.current(e.reason ?? '');`. `app/(tabs)/game.tsx`:

```tsx
  const expireSession = useAuthStore((s) => s.expireSession);
  // ...
  // 4401 → 로그아웃 + 안내(웹과 동일). reason 'SESSION_REPLACED' = 다른 기기 로그인
  useGameSocket(token, ready, (reason) =>
    expireSession(token, reason === 'SESSION_REPLACED' ? 'replaced' : 'expired'),
  );
```
`grep -n pushToast "mobile/src/app/(tabs)/game.tsx"` 로 다른 사용처가 없으면 `const pushToast = ...` 줄 제거.

- [ ] **Step 9: 루트 레이아웃** — `app/_layout.tsx`: `import { AppState } from 'react-native';` 추가, 기존 hydrate effect 를 교체:

```tsx
  useEffect(() => {
    // 복원 후 세션 확인(실행 시 1회), 이후 포그라운드 복귀마다(60초 간격 제한) — 만료·다른 기기 로그인 반영
    void useAuthStore
      .getState()
      .hydrate()
      .then(() => useAuthStore.getState().validateSession(true));
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void useAuthStore.getState().validateSession();
    });
    return () => sub.remove();
  }, []);
```

- [ ] **Step 10: 검증**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: tsc 오류 없음, jest 전체 PASS(기존 190 + 5 = 195)

- [ ] **Step 11: 커밋**

```bash
git add mobile/src/lib/api/session-end.ts mobile/src/lib/api/session-end.test.ts mobile/src/lib/api/auth-token.ts mobile/src/lib/api/http.ts mobile/src/features/auth/store.ts mobile/src/features/auth/api.ts mobile/src/features/game/use-game-socket.ts "mobile/src/app/(tabs)/game.tsx" mobile/src/app/_layout.tsx
git commit -m "feat(mobile): 단일 세션 — 사유별 안내·게임 4401 로그아웃·실행/복귀 세션 확인·게스트 platform=app"
```

---

### Task 10: 통합 확인 + 문서

**Files:**
- Modify: `README.md` (인증 섹션)
- Modify: `docs/ROADMAP.md` (완료 항목)

- [ ] **Step 1: 마이그레이션 스모크(일회용 PG)** — 메모리 규칙(일회용 docker PG, 끝나면 정리):

```bash
docker run -d --rm --name ss-smoke-pg -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=smoke -p 55432:5432 postgres:16
# pg_isready 로 준비 대기(perl select 대기 사용, sleep 금지)
cd backend && grep -n "DATABASE_URL\|POSTGRES" shared/database.py alembic/env.py   # 변수명 확인
cd backend && <확인한 변수명>=postgresql+asyncpg://postgres:smoke@localhost:55432/smoke uv run alembic upgrade head
docker stop ss-smoke-pg
```
Expected: `upgrade head` 가 `a7b8c9d0e1f2` 까지 오류 없이 적용. 출력·로그에 접속 문자열을 다시 노출하지 않는다.

- [ ] **Step 2: 전체 테스트**

Run: `cd backend && uv run pytest -q -p no:warnings` / `cd web_client && npx tsc --noEmit` / `cd mobile && npx tsc --noEmit && npx jest`
Expected: 모두 통과

- [ ] **Step 3: 로컬 브라우저 스모크(web)** — 일회용 PG 에 `alembic upgrade head` 후 로컬 auth(8001, `AUTH_GUEST_ENABLED=true`)·trading_game(8003)·로컬 Redis(DB 5)를 띄우고, web_client 를 로컬 API(`VITE_AUTH_BASE_URL=http://localhost:8001/api/v1` 등)로 실행. chrome-devtools `isolatedContext` 두 개(A·B)로 같은 닉네임 게스트 로그인:
  - A 를 게임 화면에 둔 채 B 로그인 → A 에 즉시 "다른 기기에서 로그인되어 로그아웃됐어요" 토스트 + 헤더 "로그인" 버튼.
  - A 를 블로그 화면에 두고 B 재로그인 → A 새로고침 시 같은 안내·로그아웃.
  - 끝나면 서버·vite·컨테이너 종료, 테스트 페이지 닫기(page 1·22 는 건드리지 않음). 시즌이 없어 게임 화면 WS 확인이 어려우면 결과를 그대로 보고하고 REST·새로고침 경로만 확인.

- [ ] **Step 4: 문서** — README 의 인증(auth) 설명 근처에 추가:

```markdown
- **단일 세션(플랫폼별)**: 같은 계정은 web·app·admin 마다 마지막 로그인 1곳만 유효(`user_sessions`, 마이그레이션 `a7b8c9d0e1f2`). 밀려난 기기는 401 `SESSION_REPLACED` / 게임 WS 4401(reason `SESSION_REPLACED`)로 로그아웃되고, 웹·앱은 시작·복귀 시 `/auth/me` 로 확인한다. auth·trading_game 은 같은 `REDIS_URL`(채널 `auth:session:replaced`)을 써야 게임 WS 즉시 끊기가 동작.
```

`docs/ROADMAP.md` 의 Phase 3 "회원 탈퇴" 항목 아래에:
```markdown
- [x] **중복 로그인 처리(플랫폼별 단일 세션)** — web 1 + app 1(+admin) 유지, 같은 플랫폼 재로그인 시 이전 기기 401·게임 WS 즉시 끊기·안내, 시작·복귀 시 `/auth/me` 확인 (2026-10-16, 스펙 `docs/superpowers/specs/2026-10-16-single-session-per-platform-design.md`). 앱은 새 빌드 필요
```

- [ ] **Step 5: 커밋**

```bash
git add README.md docs/ROADMAP.md
git commit -m "docs: 단일 세션(중복 로그인 처리) README·로드맵 반영"
```

- [ ] **Step 6: 머지·배포는 사용자 지시 대기** — "머지 해줘" 시 `git fetch . dev:main`, push 는 사용자가 직접(`backend/**` → deploy-server 가 `alembic upgrade head`, `web_client/**` → deploy-web, 앱은 새 빌드).

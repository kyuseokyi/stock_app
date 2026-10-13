# 간편 로그인(카카오·네이버) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web_client·모바일(Expo)에서 카카오·네이버로 로그인해 기존과 같은 서비스 JWT 를 받는다(blog·trading_game 무변경). 닉네임 게스트 로그인은 개발용 플래그 뒤로 숨긴다.

**Architecture:** auth 서비스에 `백엔드 콜백 + 일회용 교환 코드` 흐름을 추가한다. `start`(서명 state JWT → 302 공급자) → 공급자 → `callback`(state·nonce 검증 → 공급자 code 교환·프로필 → (provider, provider_id) 사용자 찾기/생성 → Redis 60초 교환 코드 → 302 복귀 주소) → 클라이언트 `exchange`(GETDEL → `TokenResponse`). 복귀 주소는 state 의 client/app_variant 로 **서버 설정에서만** 고른다. 백엔드 레이어: `routers/social.py`(HTTP 매핑) → `social/service.py`(유스케이스) → `social/{providers,store,state,config}.py`(어댑터·저장소). 설정·Redis·HTTP 전송은 모두 FastAPI 의존성이라 테스트가 override 한다.

**Tech Stack:** FastAPI·SQLAlchemy async·PyJWT·httpx·redis.asyncio / pytest(+aiosqlite·fakeredis·httpx.MockTransport) · React 18 + TS strict + Vite + Tailwind + zustand + axios + react-router v6 · Expo SDK 57(expo-web-browser `openAuthSessionAsync`, expo-linking `createURL`, expo-router NativeIntent) + Unistyles v3 + jest-expo

**스펙:** `docs/superpowers/specs/2026-10-13-social-login-kakao-naver-design.md`

---

## 공통 규칙 (모든 태스크)

- 브랜치 `dev`. 스테이징은 명시 경로만(`git add -A`/`git add .` 금지). `.claude/`·`.serena/project.yml` 절대 스테이징 금지. 괄호가 들어간 경로(`mobile/src/app/(tabs)/...`)는 **따옴표로 감싼다**.
- 커밋 메시지 끝에 정확히:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- 백엔드 명령은 `conda activate stock_app` 후 `cd backend && uv run ...`. 테스트는 네트워크·DB·Redis 없이 돈다(sqlite in-memory + fakeredis + MockTransport). **`alembic upgrade` 를 개발 DB(터널 15432)에 실행하지 않는다** — 마이그레이션 검증은 Task 9(로컬 docker 5432 의 일회용 DB)에서만.
- 백엔드 기준선: `uv run pytest` → **228 passed**. 이 계획 완료 시 **295 passed**(+67: models 3 · core 14 · providers 19 · login 31).
- web_client 검증(프론트 태스크 공통 종료 조건):
  ```bash
  cd web_client
  npx tsc --noEmit
  VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build
  grep -l "localhost:800" dist/assets/*.js || echo "OK: localhost 없음"
  ```
- mobile 검증: `cd mobile && npx tsc --noEmit && npx jest` (기준선 63 → 72).
- TS 규칙: 명시적 `any`·`@ts-ignore` 금지. `as`는 외부 데이터 경계에서만, `!`는 근거 주석과 함께만.
- 기존 `/auth/login`·`/auth/guest`·`/auth/me` 의 응답·동작은 바꾸지 않는다(`test_guest_login_unchanged` 회귀 테스트). `LoginModal` props(`open`/`onClose`/`onSuccess`)는 그대로 — 호출부 3곳(Layout·PostDetailPage·GamePage) 무수정. 모바일 스토어 `login(nickname)` 시그니처 불변.
- admin_web 은 범위 밖(관리자는 이메일 로그인 유지). 애플 로그인·게스트→소셜 계정 이관·회원 탈퇴도 범위 밖.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `backend/shared/models.py` (수정) | `AuthProvider.NAVER` + `users (provider, provider_id)` UniqueConstraint |
| `backend/alembic/versions/e5f6a7b8c9d0_social_login_naver_provider_unique.py` | enum `ADD VALUE 'NAVER'`(autocommit) + 유니크 제약 |
| `backend/apps/auth/social/config.py` | `SocialSettings`(요청 시점 env 로드)·`get_social_settings` 의존성·기동 경고 |
| `backend/apps/auth/social/state.py` | `sign_state`/`verify_state`(PyJWT HS256, `typ=social_state`) |
| `backend/apps/auth/social/store.py` | `SocialStore`(nonce SET NX·교환 코드 SET EX/GETDEL)·`get_social_store` 의존성 |
| `backend/apps/auth/social/providers.py` | Kakao/Naver/Fake 어댑터·`build_provider`·`get_http_transport` 의존성 |
| `backend/apps/auth/social/service.py` | `find_or_create_user`·`complete_social_login`·`redeem_exchange_code` |
| `backend/apps/auth/routers/social.py` | `GET providers` · `GET {p}/start` · `GET {p}/callback` · `POST exchange` |
| `backend/apps/auth/schemas.py`, `main.py` (수정) | `SocialProvidersOut`·`SocialExchangeRequest`, 라우터 등록·기동 경고 로그 |
| `backend/tests/test_social_{models,core,providers,login}.py` | TDD 테스트 4종 |
| `web_client/src/{vite-env.d.ts,config.ts,types/api.ts}` (수정), `tailwind.config.js` (수정) | `ENABLE_GUEST_LOGIN`, 소셜 타입, `kakao`/`naver` 색 토큰 |
| `web_client/src/api/auth.ts`, `src/store/auth.ts` (수정) | `socialStartUrl`·`getSocialProviders`·`exchangeSocialCode`, `loginWithToken` |
| `web_client/src/lib/socialLogin.ts` | 복귀 경로 보관/검증(sessionStorage)·오류 문구 |
| `web_client/src/components/LoginModal.tsx` (교체), `src/pages/AuthCompletePage.tsx`, `src/App.tsx` (수정) | 소셜 버튼 + 개발용 게스트 폼, `/auth/complete` 라우트 |
| `mobile/app.config.js`, `src/lib/env.ts` (수정) | dev 스킴 `stockapp-dev`, `enableGuestLogin` |
| `mobile/src/features/auth/return-url.ts` (+ `.test.ts`) | `parseAuthReturnUrl`·`isAuthReturnUrl`·`socialErrorMessage`(순수) |
| `mobile/src/features/auth/{api,store}.ts` (수정), `social.ts`, `social-button.tsx` | 공급자 조회·교환, `loginWithToken`, 인앱 브라우저 세션, 버튼 |
| `mobile/src/app/+native-intent.tsx` | Android 에서 복귀 딥링크가 Unmatched `/auth` 로 라우팅되는 것 차단 |
| `mobile/src/app/(tabs)/profile.tsx` (수정) | 카카오·네이버 버튼 + 개발용 게스트 폼 |
| `web_client/Dockerfile`, `docker-compose.prod.yml`, `backend/.env.example`, `mobile/.env.example`, `README.md`, `docs/ROADMAP.md` (수정) | 빌드 인자·환경변수 키·문서 |

---

### Task 1: 백엔드 — users 모델(NAVER·유니크) + 마이그레이션

**Files:**
- Modify: `backend/shared/models.py`
- Create: `backend/alembic/versions/e5f6a7b8c9d0_social_login_naver_provider_unique.py`
- Create: `backend/tests/test_social_models.py`

> 테스트는 `Base.metadata.create_all`(sqlite)로 스키마를 만든다 → **모델**이 NAVER·유니크를 반영해야 통과한다. PG 마이그레이션 자체는 sqlite 에서 돌릴 수 없으므로 Task 9 에서 일회용 로컬 DB 로 검증한다. 현재 alembic head 는 `d4e5f6a7b8c9`(`uv run alembic heads` 로 확인 — upgrade 금지).

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_social_models.py`:

```python
"""간편 로그인 — users 모델(NAVER 공급자 + (provider, provider_id) 유니크) 테스트."""
from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import AuthProvider, Base, User


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s
    await engine.dispose()


def test_auth_provider_has_naver():
    assert AuthProvider("NAVER") is AuthProvider.NAVER


async def test_same_provider_account_is_unique(session):
    session.add_all([
        User(provider=AuthProvider.KAKAO, provider_id="123", nickname="a"),
        User(provider=AuthProvider.KAKAO, provider_id="123", nickname="b"),
    ])
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_null_provider_rows_and_other_provider_same_id_ok(session):
    session.add_all([
        User(email="admin@x", nickname="관리자"),  # provider/provider_id 모두 NULL
        User(email="g@guest.local", nickname="게스트"),  # NULL 끼리는 충돌 없음
        User(provider=AuthProvider.KAKAO, provider_id="123", nickname="k"),
        User(provider=AuthProvider.NAVER, provider_id="123", nickname="n"),  # 공급자가 다르면 같은 id 허용
    ])
    await session.commit()
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_social_models.py -v`
Expected: 3 FAILED — `ValueError: 'NAVER' is not a valid AuthProvider`(1·3번), `Failed: DID NOT RAISE IntegrityError`(2번)

- [ ] **Step 3: 모델 수정** — `backend/shared/models.py`

(a) `from sqlalchemy import (...)` 목록의 `Text,` 다음 줄에 `UniqueConstraint,` 추가:

```python
    Text,
    UniqueConstraint,
    func,
)
```

(b) `AuthProvider` 에 NAVER 추가:

```python
class AuthProvider(str, enum.Enum):
    """소셜 로그인 공급자."""

    KAKAO = "KAKAO"
    GOOGLE = "GOOGLE"
    APPLE = "APPLE"
    NAVER = "NAVER"
```

(c) `class User` 의 `__tablename__ = "users"` 바로 아래에 추가:

```python
    __tablename__ = "users"
    # 같은 공급자 계정(provider+provider_id)은 한 명. 둘 다 NULL 인 기존(관리자·게스트) 행끼리는 충돌하지 않는다.
    __table_args__ = (
        UniqueConstraint("provider", "provider_id", name="uq_users_provider_provider_id"),
    )
```

- [ ] **Step 4: 마이그레이션 작성** — `backend/alembic/versions/e5f6a7b8c9d0_social_login_naver_provider_unique.py`:

```python
"""social login: auth_provider += NAVER, users(provider, provider_id) unique

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-13
"""
from __future__ import annotations

from alembic import op

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PG enum 값 추가는 트랜잭션 밖에서 안전 — autocommit 블록 + IF NOT EXISTS(재실행 무해)
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE auth_provider ADD VALUE IF NOT EXISTS 'NAVER'")
    # (provider, provider_id) 유니크 — 둘 다 NULL 인 기존 행(관리자·게스트)은 PG 에서 서로 충돌하지 않는다
    op.create_unique_constraint(
        "uq_users_provider_provider_id", "users", ["provider", "provider_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_users_provider_provider_id", "users", type_="unique")
    # auth_provider 의 'NAVER' 값은 되돌리지 않는다(no-op).
    # PG 는 enum 값 삭제(DROP VALUE)를 지원하지 않으며, 타입 재생성은 NAVER 사용자 행이 있으면 실패한다.
```

- [ ] **Step 5: 통과 확인**

Run: `cd backend && uv run pytest tests/test_social_models.py -v` → 3 passed
Run: `cd backend && uv run alembic heads` → `e5f6a7b8c9d0 (head)` (단일 head)
Run: `cd backend && uv run pytest -q` → 231 passed

- [ ] **Step 6: 커밋**

```bash
git add backend/shared/models.py backend/alembic/versions/e5f6a7b8c9d0_social_login_naver_provider_unique.py backend/tests/test_social_models.py
git commit -m "feat(auth): 간편 로그인 데이터 — auth_provider NAVER 추가·users(provider, provider_id) 유니크 마이그레이션

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: 백엔드 — 설정 · state 서명 · Redis 저장소

**Files:**
- Create: `backend/apps/auth/social/__init__.py`, `config.py`, `state.py`, `store.py`
- Create: `backend/tests/test_social_core.py`

> 설정은 **요청 시점에** env 를 읽는 `get_social_settings()` 의존성으로 제공한다(테스트는 `dependency_overrides` 로 `SocialSettings(...)` 를 주입, 또는 monkeypatch 로 env 를 바꾼 뒤 `load_social_settings()`). 로컬 `backend/.env.development` 값이 테스트에 새지 않도록 env 테스트는 `clean_env` 픽스처로 관련 키를 모두 지운다. Redis 는 `get_social_store()` 지연 싱글턴(trading_game `deps.get_redis` 와 같은 패턴) — 테스트는 `SocialStore(FakeRedis)` 로 교체.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_social_core.py`:

```python
"""간편 로그인 — 설정(SocialSettings)·state 서명·Redis 저장소 테스트."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fakeredis import aioredis as fake_aioredis

from apps.auth.social.config import SocialSettings, load_social_settings, startup_warnings
from apps.auth.social.state import StateError, sign_state, verify_state
from apps.auth.social.store import SocialStore
from shared import security

SOCIAL_ENV_KEYS = (
    "APP_ENV", "KAKAO_REST_API_KEY", "KAKAO_CLIENT_SECRET", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET",
    "SOCIAL_STATE_SECRET", "SOCIAL_REDIRECT_BASE", "SOCIAL_WEB_RETURN_URL",
    "SOCIAL_APP_RETURN_URL_PROD", "SOCIAL_APP_RETURN_URL_DEV", "SOCIAL_FAKE_PROVIDER",
)
SECRET = "test-state-secret-0123456789abcdef"


@pytest.fixture
def clean_env(monkeypatch):
    for key in SOCIAL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    return monkeypatch


# ---------------------------------------------------------------- settings
def test_settings_defaults_and_kakao_key(clean_env):
    clean_env.setenv("KAKAO_REST_API_KEY", "kakao-key")
    s = load_social_settings()
    assert s.is_enabled("kakao") is True
    assert s.is_enabled("naver") is False
    assert s.is_enabled("apple") is False
    assert s.redirect_uri("kakao") == "http://localhost:8001/api/v1/auth/social/kakao/callback"
    assert s.return_url("web", None) == "http://localhost:3000/auth/complete"
    assert s.return_url("app", "prod") == "stockapp://auth"
    assert s.return_url("app", "dev") == "stockapp-dev://auth"


def test_settings_read_at_call_time(clean_env):
    assert load_social_settings().is_enabled("naver") is False
    clean_env.setenv("NAVER_CLIENT_ID", "nid")
    assert load_social_settings().is_enabled("naver") is False  # secret 없으면 비활성
    clean_env.setenv("NAVER_CLIENT_SECRET", "nsecret")
    clean_env.setenv("SOCIAL_REDIRECT_BASE", "https://auth.example.com/api/v1/auth/social/")
    s = load_social_settings()
    assert s.is_enabled("naver") is True
    assert s.redirect_uri("naver") == "https://auth.example.com/api/v1/auth/social/naver/callback"


def test_fake_mode_enables_all_but_is_ignored_in_production(clean_env):
    clean_env.setenv("SOCIAL_FAKE_PROVIDER", "true")
    dev = load_social_settings()
    assert dev.fake_mode is True
    assert dev.is_enabled("kakao") and dev.is_enabled("naver")

    clean_env.setenv("APP_ENV", "production")
    prod = load_social_settings()
    assert prod.fake_mode is False
    assert prod.is_enabled("kakao") is False


def test_state_secret_falls_back_to_jwt_key():
    assert SocialSettings().effective_state_secret == security.SECRET_KEY
    assert SocialSettings(state_secret="own").effective_state_secret == "own"


def test_startup_warnings():
    assert startup_warnings(SocialSettings(fake_provider_requested=True)) == []
    warns = startup_warnings(SocialSettings(app_env="production", fake_provider_requested=True))
    assert len(warns) == 2  # 가짜 모드 무시 + state 키 폴백
    assert startup_warnings(SocialSettings(app_env="production", state_secret="x")) == []


# ---------------------------------------------------------------- state
def test_state_roundtrip_web_and_app():
    web = verify_state(SECRET, sign_state(SECRET, provider="kakao", client="web", app_variant=None), provider="kakao")
    assert (web.provider, web.client, web.app_variant) == ("kakao", "web", None)
    assert web.nonce

    app = verify_state(SECRET, sign_state(SECRET, provider="naver", client="app", app_variant="dev"), provider="naver")
    assert (app.client, app.app_variant) == ("app", "dev")


def test_state_nonce_differs_per_sign():
    a = verify_state(SECRET, sign_state(SECRET, provider="kakao", client="web", app_variant=None), provider="kakao")
    b = verify_state(SECRET, sign_state(SECRET, provider="kakao", client="web", app_variant=None), provider="kakao")
    assert a.nonce != b.nonce


def test_state_expired():
    past = datetime.now(timezone.utc) - timedelta(minutes=11)
    token = sign_state(SECRET, provider="kakao", client="web", app_variant=None, now=past)
    with pytest.raises(StateError):
        verify_state(SECRET, token, provider="kakao")


def test_state_forged_with_other_secret():
    token = sign_state("attacker-secret-0123456789abcdef", provider="kakao", client="web", app_variant=None)
    with pytest.raises(StateError):
        verify_state(SECRET, token, provider="kakao")


def test_state_provider_mismatch():
    token = sign_state(SECRET, provider="kakao", client="web", app_variant=None)
    with pytest.raises(StateError):
        verify_state(SECRET, token, provider="naver")


def test_state_garbage_and_access_token_rejected():
    with pytest.raises(StateError):
        verify_state(SECRET, "not-a-jwt", provider="kakao")
    access = security.create_access_token(subject=1, role="FREE")  # typ 없음
    with pytest.raises(StateError):
        verify_state(security.SECRET_KEY, access, provider="kakao")


# ---------------------------------------------------------------- store
@pytest.fixture
def store():
    return SocialStore(fake_aioredis.FakeRedis(decode_responses=True))


async def test_nonce_single_use(store):
    assert await store.use_nonce("n1") is True
    assert await store.use_nonce("n1") is False
    assert await store.use_nonce("n2") is True


async def test_exchange_code_single_use_with_ttl(store):
    code = await store.issue_exchange_code(42)
    assert 0 < await store._redis.ttl(f"auth:social:code:{code}") <= 60
    assert await store.consume_exchange_code(code) == 42
    assert await store.consume_exchange_code(code) is None


async def test_unknown_exchange_code(store):
    assert await store.consume_exchange_code("nope") is None
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_social_core.py -v`
Expected: 수집 오류 — `ModuleNotFoundError: No module named 'apps.auth.social'`

- [ ] **Step 3: 구현** — `backend/apps/auth/social/__init__.py`:

```python
"""간편 로그인(카카오·네이버) — 백엔드 콜백 + 일회용 교환 코드 방식.

스펙: docs/superpowers/specs/2026-10-13-social-login-kakao-naver-design.md
"""
```

`backend/apps/auth/social/config.py`:

```python
"""간편 로그인 설정 — 요청 시점에 환경변수를 읽는다.

라우터는 `Depends(get_social_settings)` 로 받으므로 테스트는 dependency_overrides 로
키 유무·가짜 모드·운영 여부를 자유롭게 바꿀 수 있다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from shared import security

PROVIDERS: tuple[str, ...] = ("kakao", "naver")

DEFAULT_REDIRECT_BASE = "http://localhost:8001/api/v1/auth/social"
DEFAULT_WEB_RETURN_URL = "http://localhost:3000/auth/complete"
DEFAULT_APP_RETURN_URL_PROD = "stockapp://auth"
DEFAULT_APP_RETURN_URL_DEV = "stockapp-dev://auth"


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class SocialSettings:
    app_env: str = "development"
    kakao_rest_api_key: str = ""
    kakao_client_secret: str = ""  # 카카오 콘솔에서 Client Secret 을 '사용함'으로 켠 경우만
    naver_client_id: str = ""
    naver_client_secret: str = ""
    state_secret: str = ""  # 비면 JWT_SECRET_KEY 로 폴백
    redirect_base: str = DEFAULT_REDIRECT_BASE
    web_return_url: str = DEFAULT_WEB_RETURN_URL
    app_return_url_prod: str = DEFAULT_APP_RETURN_URL_PROD
    app_return_url_dev: str = DEFAULT_APP_RETURN_URL_DEV
    fake_provider_requested: bool = False  # SOCIAL_FAKE_PROVIDER 원값(운영에선 무시)

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def fake_mode(self) -> bool:
        """가짜 공급자 모드 — 운영(APP_ENV=production)에서는 켜져 있어도 무시."""
        return self.fake_provider_requested and not self.is_production

    @property
    def effective_state_secret(self) -> str:
        return self.state_secret or security.SECRET_KEY

    def has_keys(self, provider: str) -> bool:
        if provider == "kakao":
            return bool(self.kakao_rest_api_key)
        if provider == "naver":
            return bool(self.naver_client_id and self.naver_client_secret)
        return False

    def is_enabled(self, provider: str) -> bool:
        return provider in PROVIDERS and (self.fake_mode or self.has_keys(provider))

    def redirect_uri(self, provider: str) -> str:
        """공급자 콘솔에 등록하는 Redirect URI 와 정확히 같아야 한다."""
        return f"{self.redirect_base.rstrip('/')}/{provider}/callback"

    def return_url(self, client: str, app_variant: str | None) -> str:
        """복귀 주소는 서버 설정에서만 고른다(오픈 리다이렉트 방지)."""
        if client == "app":
            return self.app_return_url_dev if app_variant == "dev" else self.app_return_url_prod
        return self.web_return_url


def load_social_settings() -> SocialSettings:
    env = os.getenv
    return SocialSettings(
        app_env=env("APP_ENV", "development"),
        kakao_rest_api_key=env("KAKAO_REST_API_KEY", ""),
        kakao_client_secret=env("KAKAO_CLIENT_SECRET", ""),
        naver_client_id=env("NAVER_CLIENT_ID", ""),
        naver_client_secret=env("NAVER_CLIENT_SECRET", ""),
        state_secret=env("SOCIAL_STATE_SECRET", ""),
        redirect_base=env("SOCIAL_REDIRECT_BASE", "") or DEFAULT_REDIRECT_BASE,
        web_return_url=env("SOCIAL_WEB_RETURN_URL", "") or DEFAULT_WEB_RETURN_URL,
        app_return_url_prod=env("SOCIAL_APP_RETURN_URL_PROD", "") or DEFAULT_APP_RETURN_URL_PROD,
        app_return_url_dev=env("SOCIAL_APP_RETURN_URL_DEV", "") or DEFAULT_APP_RETURN_URL_DEV,
        fake_provider_requested=_truthy(env("SOCIAL_FAKE_PROVIDER")),
    )


def get_social_settings() -> SocialSettings:
    """FastAPI 의존성 — 매 요청 env 를 다시 읽는다(테스트는 override)."""
    return load_social_settings()


def startup_warnings(settings: SocialSettings) -> list[str]:
    """기동 시 로그로 남길 설정 경고(운영에서 위험한 조합)."""
    warnings: list[str] = []
    if settings.is_production and settings.fake_provider_requested:
        warnings.append("SOCIAL_FAKE_PROVIDER=true 는 운영(APP_ENV=production)에서 무시됩니다.")
    if settings.is_production and not settings.state_secret:
        warnings.append("SOCIAL_STATE_SECRET 미설정 — JWT_SECRET_KEY 로 폴백합니다. 운영에서는 별도 값을 설정하세요.")
    return warnings
```

`backend/apps/auth/social/state.py`:

```python
"""OAuth state — 서명 JWT(HS256) {provider, client, app_variant, nonce, exp=10분}.

서버에 세션을 두지 않고도 콜백에서 '누가 시작한 요청인지·어디로 돌려보낼지'를 검증한다.
nonce 1회 사용은 store.use_nonce 가 담당한다(재사용 공격 차단).
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt

STATE_TTL_SECONDS = 600
_ALGORITHM = "HS256"
_TYP = "social_state"  # access token 과 섞이지 않게 구분
_CLIENTS = {"web", "app"}
_APP_VARIANTS = {"dev", "prod"}


class StateError(Exception):
    """state 서명·만료·형식·공급자 불일치."""


@dataclass(frozen=True)
class StatePayload:
    provider: str
    client: str
    app_variant: str | None
    nonce: str


def sign_state(
    secret: str,
    *,
    provider: str,
    client: str,
    app_variant: str | None,
    ttl_seconds: int = STATE_TTL_SECONDS,
    now: datetime | None = None,
) -> str:
    issued = now or datetime.now(timezone.utc)
    payload = {
        "typ": _TYP,
        "provider": provider,
        "client": client,
        "app": app_variant,
        "nonce": secrets.token_urlsafe(16),
        "iat": issued,
        "exp": issued + timedelta(seconds=ttl_seconds),
    }
    return jwt.encode(payload, secret, algorithm=_ALGORITHM)


def verify_state(secret: str, token: str, *, provider: str) -> StatePayload:
    try:
        data = jwt.decode(token, secret, algorithms=[_ALGORITHM], options={"require": ["exp"]})
    except jwt.PyJWTError as exc:
        raise StateError(str(exc)) from exc

    if data.get("typ") != _TYP:
        raise StateError("typ 불일치")
    if data.get("provider") != provider:
        raise StateError("provider 불일치")
    client = data.get("client")
    if client not in _CLIENTS:
        raise StateError("client 값 오류")
    app_variant = data.get("app")
    if client == "app" and app_variant not in _APP_VARIANTS:
        raise StateError("app 값 오류")
    nonce = data.get("nonce")
    if not isinstance(nonce, str) or not nonce:
        raise StateError("nonce 없음")
    return StatePayload(
        provider=provider,
        client=client,
        app_variant=app_variant if client == "app" else None,
        nonce=nonce,
    )
```

`backend/apps/auth/social/store.py`:

```python
"""Redis 저장소 — state nonce 1회 사용 + 일회용 교환 코드(60초).

라우터는 `Depends(get_social_store)` 로 받으므로 테스트는 fakeredis 로 교체한다.
"""

from __future__ import annotations

import os
import secrets

import redis.asyncio as aioredis

NONCE_TTL_SECONDS = 600
EXCHANGE_CODE_TTL_SECONDS = 60

_NONCE_KEY = "auth:social:nonce:{}"
_CODE_KEY = "auth:social:code:{}"


class SocialStore:
    def __init__(self, redis: aioredis.Redis):
        self._redis = redis

    async def use_nonce(self, nonce: str) -> bool:
        """처음 쓰는 nonce 면 True, 이미 쓴 nonce 면 False(SET NX)."""
        ok = await self._redis.set(_NONCE_KEY.format(nonce), "1", nx=True, ex=NONCE_TTL_SECONDS)
        return bool(ok)

    async def issue_exchange_code(self, user_id: int) -> str:
        code = secrets.token_urlsafe(32)
        await self._redis.set(_CODE_KEY.format(code), str(user_id), ex=EXCHANGE_CODE_TTL_SECONDS)
        return code

    async def consume_exchange_code(self, code: str) -> int | None:
        """교환 코드 → user_id. GETDEL 이라 두 번째 호출부터는 None."""
        raw = await self._redis.getdel(_CODE_KEY.format(code))
        if raw is None:
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None


_store: SocialStore | None = None


def get_social_store() -> SocialStore:
    """FastAPI 의존성 — 프로세스 싱글턴(REDIS_URL)."""
    global _store
    if _store is None:
        url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        _store = SocialStore(aioredis.from_url(url, decode_responses=True))
    return _store
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest tests/test_social_core.py -v` → 14 passed
Run: `cd backend && uv run pytest -q` → 245 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/auth/social/__init__.py backend/apps/auth/social/config.py backend/apps/auth/social/state.py backend/apps/auth/social/store.py backend/tests/test_social_core.py
git commit -m "feat(auth): 간편 로그인 기반 — 요청 시점 설정(SocialSettings)·서명 state JWT·Redis nonce/교환 코드 저장소

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 3: 백엔드 — 공급자 어댑터(카카오·네이버·가짜)

**Files:**
- Create: `backend/apps/auth/social/providers.py`
- Create: `backend/tests/test_social_providers.py`

> 공급자 HTTP 는 `httpx.MockTransport` 로 흉내 낸다. 어댑터는 `transport` 를 생성자로 받고, 라우터는 `Depends(get_http_transport)`(기본 `None` = 실네트워크)로 넘긴다. 실패 판정은 비-2xx 뿐 아니라 **HTTP 200 + `{"error": …}`(네이버 토큰 실패)**, `access_token`/`id` 누락, 네이버 `resultcode != "00"`, JSON 아님, 네트워크 오류(타임아웃 5초)까지 모두 `ProviderError`. 카카오 `id` 는 정수 → 문자열로 저장.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_social_providers.py`:

```python
"""간편 로그인 — 공급자 어댑터(카카오·네이버·가짜) 테스트. 공급자 HTTP 는 httpx.MockTransport."""
from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from apps.auth.social.config import SocialSettings
from apps.auth.social.providers import (
    FakeProvider,
    KakaoProvider,
    NaverProvider,
    ProviderError,
    build_provider,
)

REDIRECT = "http://localhost:8001/api/v1/auth/social/kakao/callback"


def _mock(routes: dict[str, httpx.Response], calls: list[httpx.Request]) -> httpx.MockTransport:
    """host → 고정 응답. 호출된 요청은 calls 에 기록."""

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return routes.get(request.url.host, httpx.Response(404))

    return httpx.MockTransport(handler)


def _form(request: httpx.Request) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(request.content.decode()).items()}


def _query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


# ---------------------------------------------------------------- kakao
def test_kakao_authorize_url():
    url = KakaoProvider("kakao-key").authorize_url(redirect_uri=REDIRECT, state="st")
    assert url.startswith("https://kauth.kakao.com/oauth/authorize?")
    assert _query(url) == {"response_type": "code", "client_id": "kakao-key", "redirect_uri": REDIRECT, "state": "st"}


async def test_kakao_success_profile_nickname():
    calls: list[httpx.Request] = []
    transport = _mock({
        "kauth.kakao.com": httpx.Response(200, json={"access_token": "kat", "token_type": "bearer"}),
        "kapi.kakao.com": httpx.Response(200, json={
            "id": 4242,  # 카카오 회원번호는 정수
            "kakao_account": {"profile": {"nickname": "  카카오친구  "}},
            "properties": {"nickname": "옛닉"},
        }),
    }, calls)
    profile = await KakaoProvider("kakao-key", transport=transport).exchange_code(
        code="c1", state="st", redirect_uri=REDIRECT
    )
    assert profile.id == "4242"
    assert profile.nickname == "카카오친구"

    token_req, me_req = calls
    assert token_req.method == "POST" and str(token_req.url) == KakaoProvider.TOKEN_URL
    assert _form(token_req) == {
        "grant_type": "authorization_code", "client_id": "kakao-key", "redirect_uri": REDIRECT, "code": "c1",
    }
    assert me_req.method == "GET" and str(me_req.url) == KakaoProvider.PROFILE_URL
    assert me_req.headers["Authorization"] == "Bearer kat"


async def test_kakao_client_secret_and_properties_fallback():
    calls: list[httpx.Request] = []
    transport = _mock({
        "kauth.kakao.com": httpx.Response(200, json={"access_token": "kat"}),
        "kapi.kakao.com": httpx.Response(200, json={"id": 7, "properties": {"nickname": "프로퍼티닉"}}),
    }, calls)
    profile = await KakaoProvider("kakao-key", "kakao-secret", transport).exchange_code(
        code="c1", state="st", redirect_uri=REDIRECT
    )
    assert profile.nickname == "프로퍼티닉"
    assert _form(calls[0])["client_secret"] == "kakao-secret"


async def test_kakao_no_nickname_is_none():
    transport = _mock({
        "kauth.kakao.com": httpx.Response(200, json={"access_token": "kat"}),
        "kapi.kakao.com": httpx.Response(200, json={"id": 7, "kakao_account": {}}),
    }, [])
    profile = await KakaoProvider("k", transport=transport).exchange_code(code="c", state="s", redirect_uri=REDIRECT)
    assert (profile.id, profile.nickname) == ("7", None)


@pytest.mark.parametrize("routes", [
    {"kauth.kakao.com": httpx.Response(401, json={"error": "invalid_client"})},
    {"kauth.kakao.com": httpx.Response(200, json={"error": "invalid_grant"})},
    {"kauth.kakao.com": httpx.Response(200, json={"access_token": "kat"}),
     "kapi.kakao.com": httpx.Response(500, text="boom")},
    {"kauth.kakao.com": httpx.Response(200, json={"access_token": "kat"}),
     "kapi.kakao.com": httpx.Response(200, json={"kakao_account": {}})},  # id 누락
    {"kauth.kakao.com": httpx.Response(200, text="not json")},
])
async def test_kakao_failures_raise_provider_error(routes):
    with pytest.raises(ProviderError):
        await KakaoProvider("k", transport=_mock(routes, [])).exchange_code(code="c", state="s", redirect_uri=REDIRECT)


async def test_network_error_raises_provider_error():
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timeout", request=request)

    with pytest.raises(ProviderError):
        await KakaoProvider("k", transport=httpx.MockTransport(boom)).exchange_code(
            code="c", state="s", redirect_uri=REDIRECT
        )


# ---------------------------------------------------------------- naver
def test_naver_authorize_url():
    url = NaverProvider("nid", "nsecret").authorize_url(redirect_uri=REDIRECT, state="st")
    assert url.startswith("https://nid.naver.com/oauth2.0/authorize?")
    assert _query(url) == {"response_type": "code", "client_id": "nid", "redirect_uri": REDIRECT, "state": "st"}


async def test_naver_success_and_form():
    calls: list[httpx.Request] = []
    transport = _mock({
        "nid.naver.com": httpx.Response(200, json={"access_token": "nat", "token_type": "bearer"}),
        "openapi.naver.com": httpx.Response(200, json={
            "resultcode": "00", "message": "success",
            "response": {"id": "naver-abc", "nickname": "네이버친구", "name": "홍길동"},
        }),
    }, calls)
    profile = await NaverProvider("nid", "nsecret", transport).exchange_code(code="c1", state="st", redirect_uri=REDIRECT)
    assert profile.id == "naver-abc"
    assert profile.nickname == "네이버친구"
    assert _form(calls[0]) == {
        "grant_type": "authorization_code", "client_id": "nid", "client_secret": "nsecret", "code": "c1", "state": "st",
    }
    assert calls[1].headers["Authorization"] == "Bearer nat"


async def test_naver_name_fallback():
    transport = _mock({
        "nid.naver.com": httpx.Response(200, json={"access_token": "nat"}),
        "openapi.naver.com": httpx.Response(200, json={"resultcode": "00", "response": {"id": "n1", "name": "홍길동"}}),
    }, [])
    profile = await NaverProvider("nid", "ns", transport).exchange_code(code="c", state="s", redirect_uri=REDIRECT)
    assert profile.nickname == "홍길동"


@pytest.mark.parametrize("routes", [
    # 네이버는 토큰 실패를 HTTP 200 + error 로 돌려줄 수 있다
    {"nid.naver.com": httpx.Response(200, json={"error": "invalid_request", "error_description": "no code"})},
    {"nid.naver.com": httpx.Response(200, json={"access_token": "nat"}),
     "openapi.naver.com": httpx.Response(200, json={"resultcode": "024", "message": "Authentication failed"})},
    {"nid.naver.com": httpx.Response(200, json={"access_token": "nat"}),
     "openapi.naver.com": httpx.Response(200, json={"resultcode": "00", "response": {"nickname": "id없음"}})},
    {"nid.naver.com": httpx.Response(503, text="down")},
])
async def test_naver_failures_raise_provider_error(routes):
    with pytest.raises(ProviderError):
        await NaverProvider("nid", "ns", _mock(routes, [])).exchange_code(code="c", state="s", redirect_uri=REDIRECT)


# ---------------------------------------------------------------- fake + factory
async def test_fake_provider():
    fake = FakeProvider("kakao")
    url = fake.authorize_url(redirect_uri=REDIRECT, state="st")
    assert url.startswith(REDIRECT + "?")
    assert _query(url) == {"code": "fake", "state": "st"}
    profile = await fake.exchange_code(code="fake", state="st", redirect_uri=REDIRECT)
    assert (profile.id, profile.nickname) == ("fake-kakao-tester", "테스트유저")
    with pytest.raises(ProviderError):
        await fake.exchange_code(code="real", state="st", redirect_uri=REDIRECT)


def test_build_provider():
    assert build_provider("kakao", SocialSettings()) is None
    assert isinstance(build_provider("kakao", SocialSettings(kakao_rest_api_key="k")), KakaoProvider)
    assert isinstance(build_provider("naver", SocialSettings(naver_client_id="i", naver_client_secret="s")), NaverProvider)
    fake = SocialSettings(kakao_rest_api_key="k", fake_provider_requested=True)
    assert isinstance(build_provider("kakao", fake), FakeProvider)  # 가짜 모드가 실키보다 우선
    prod = SocialSettings(app_env="production", fake_provider_requested=True)
    assert build_provider("kakao", prod) is None
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_social_providers.py -v`
Expected: 수집 오류 — `ModuleNotFoundError: No module named 'apps.auth.social.providers'`

- [ ] **Step 3: 구현** — `backend/apps/auth/social/providers.py`:

```python
"""공급자 어댑터 — 카카오·네이버(httpx) + 가짜 공급자(로컬/개발 스모크용).

공통 계약: authorize_url(redirect_uri, state) → 인가 URL,
          exchange_code(code, state, redirect_uri) → ProviderProfile(실패 시 ProviderError).
공급자 토큰은 프로필 조회에만 쓰고 저장하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx

from .config import SocialSettings

HTTP_TIMEOUT_SECONDS = 5.0


@dataclass(frozen=True)
class ProviderProfile:
    id: str
    nickname: str | None


class ProviderError(Exception):
    """토큰 교환·프로필 조회 실패(비-2xx, 필수 필드 누락, 네트워크 오류)."""


class Provider(Protocol):
    name: str

    def authorize_url(self, *, redirect_uri: str, state: str) -> str: ...

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> ProviderProfile: ...


def get_http_transport() -> httpx.AsyncBaseTransport | None:
    """FastAPI 의존성 — 기본 None(실네트워크). 테스트는 httpx.MockTransport 로 override."""
    return None


async def _request_json(
    http: httpx.AsyncClient, method: str, url: str, **kwargs: Any
) -> dict[str, Any]:
    try:
        resp = await http.request(method, url, **kwargs)
    except httpx.HTTPError as exc:
        raise ProviderError(f"{url} 요청 실패: {exc}") from exc
    if not resp.is_success:
        raise ProviderError(f"{url} 응답 {resp.status_code}")
    try:
        body = resp.json()
    except ValueError as exc:
        raise ProviderError(f"{url} JSON 아님") from exc
    if not isinstance(body, dict):
        raise ProviderError(f"{url} 응답 형식 오류")
    return body


def _access_token(body: dict[str, Any]) -> str:
    # 네이버는 실패도 HTTP 200 + {"error": ...} 로 줄 수 있다 → access_token 유무로 판정
    token = body.get("access_token")
    if not isinstance(token, str) or not token:
        raise ProviderError(f"access_token 없음: {body.get('error')}")
    return token


def _clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


class KakaoProvider:
    name = "kakao"
    AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize"
    TOKEN_URL = "https://kauth.kakao.com/oauth/token"
    PROFILE_URL = "https://kapi.kakao.com/v2/user/me"

    def __init__(
        self, client_id: str, client_secret: str = "", transport: httpx.AsyncBaseTransport | None = None
    ):
        self._client_id = client_id
        self._client_secret = client_secret
        self._transport = transport

    def authorize_url(self, *, redirect_uri: str, state: str) -> str:
        query = urlencode(
            {"response_type": "code", "client_id": self._client_id, "redirect_uri": redirect_uri, "state": state}
        )
        return f"{self.AUTHORIZE_URL}?{query}"

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> ProviderProfile:
        form = {
            "grant_type": "authorization_code",
            "client_id": self._client_id,
            "redirect_uri": redirect_uri,
            "code": code,
        }
        if self._client_secret:
            form["client_secret"] = self._client_secret
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, transport=self._transport) as http:
            token = _access_token(await _request_json(http, "POST", self.TOKEN_URL, data=form))
            me = await _request_json(
                http, "GET", self.PROFILE_URL, headers={"Authorization": f"Bearer {token}"}
            )
        user_id = me.get("id")  # 카카오 회원번호는 정수 → 문자열로 저장
        if user_id is None or str(user_id) == "":
            raise ProviderError("카카오 프로필 id 없음")
        profile = _dict(_dict(me.get("kakao_account")).get("profile"))
        properties = _dict(me.get("properties"))
        nickname = _clean(profile.get("nickname")) or _clean(properties.get("nickname"))
        return ProviderProfile(id=str(user_id), nickname=nickname)


class NaverProvider:
    name = "naver"
    AUTHORIZE_URL = "https://nid.naver.com/oauth2.0/authorize"
    TOKEN_URL = "https://nid.naver.com/oauth2.0/token"
    PROFILE_URL = "https://openapi.naver.com/v1/nid/me"

    def __init__(
        self, client_id: str, client_secret: str, transport: httpx.AsyncBaseTransport | None = None
    ):
        self._client_id = client_id
        self._client_secret = client_secret
        self._transport = transport

    def authorize_url(self, *, redirect_uri: str, state: str) -> str:
        query = urlencode(
            {"response_type": "code", "client_id": self._client_id, "redirect_uri": redirect_uri, "state": state}
        )
        return f"{self.AUTHORIZE_URL}?{query}"

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> ProviderProfile:
        form = {
            "grant_type": "authorization_code",
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "code": code,
            "state": state,
        }
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, transport=self._transport) as http:
            token = _access_token(await _request_json(http, "POST", self.TOKEN_URL, data=form))
            me = await _request_json(
                http, "GET", self.PROFILE_URL, headers={"Authorization": f"Bearer {token}"}
            )
        if me.get("resultcode") not in (None, "00"):
            raise ProviderError(f"네이버 프로필 resultcode={me.get('resultcode')}")
        resp = _dict(me.get("response"))
        user_id = _clean(resp.get("id"))
        if user_id is None:
            raise ProviderError("네이버 프로필 id 없음")
        nickname = _clean(resp.get("nickname")) or _clean(resp.get("name"))
        return ProviderProfile(id=user_id, nickname=nickname)


class FakeProvider:
    """가짜 공급자 — /start 가 자기 콜백으로 code=fake 를 붙여 보낸다(개발·스모크 전용)."""

    def __init__(self, name: str):
        self.name = name

    def authorize_url(self, *, redirect_uri: str, state: str) -> str:
        return f"{redirect_uri}?{urlencode({'code': 'fake', 'state': state})}"

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> ProviderProfile:
        if code != "fake":
            raise ProviderError("가짜 공급자는 code=fake 만 허용")
        return ProviderProfile(id=f"fake-{self.name}-tester", nickname="테스트유저")


def build_provider(
    name: str, settings: SocialSettings, transport: httpx.AsyncBaseTransport | None = None
) -> Provider | None:
    """설정에 맞는 어댑터. 가짜 모드면 FakeProvider, 키가 없으면 None(비활성)."""
    if not settings.is_enabled(name):
        return None
    if settings.fake_mode:
        return FakeProvider(name)
    if name == "kakao":
        return KakaoProvider(settings.kakao_rest_api_key, settings.kakao_client_secret, transport)
    if name == "naver":
        return NaverProvider(settings.naver_client_id, settings.naver_client_secret, transport)
    return None
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest tests/test_social_providers.py -v` → 19 passed
Run: `cd backend && uv run pytest -q` → 264 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/auth/social/providers.py backend/tests/test_social_providers.py
git commit -m "feat(auth): 간편 로그인 공급자 어댑터 — 카카오·네이버(httpx, 5초 타임아웃·200+error 실패 처리)·가짜 공급자

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: 백엔드 — 서비스 + 라우터(providers/start/callback/exchange)

**Files:**
- Create: `backend/apps/auth/social/service.py`, `backend/apps/auth/routers/social.py`
- Modify: `backend/apps/auth/schemas.py`, `backend/apps/auth/main.py`
- Create: `backend/tests/test_social_login.py`

> **콜백 판정 순서(테스트로 고정):**
> 1. `state` 없음·서명/만료/형식 오류·provider 불일치 → **400 HTML**(복귀 주소를 모르므로 리다이렉트 안 함)
> 2. nonce 재사용(`SET NX` 실패) → `복귀?error=state_invalid`
> 3. 공급자 `error` 파라미터: `access_denied` → `cancelled`, 그 밖의 값 → `provider_failed`
> 4. 공급자 비활성(키 회수) 또는 `code` 없음 → `provider_failed`
> 5. 토큰 교환·프로필 실패(`ProviderError`) → `provider_failed`
> 6. 사용자 찾기/생성 후 비활성 → `inactive`
> 7. 성공 → `복귀?code=<교환코드 60초>`
>
> `exchange`: 없는/이미 쓴 코드 → 401, 사용자 없음 → 401, 비활성 → 403(기존 `/login` 과 같은 문구), 성공 → 기존 `TokenResponse`. 알 수 없는 공급자·`client` 누락/오류는 `Literal` 검증으로 **422**. `app` 은 `client=app` 일 때만 의미가 있고 기본 `prod`.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_social_login.py`:

```python
"""간편 로그인 — auth API(providers/start/callback/exchange) 통합 테스트.

DB 는 sqlite in-memory, Redis 는 fakeredis, 공급자 HTTP 는 httpx.MockTransport.
설정·저장소·전송은 dependency_overrides 로 주입한다(실 env·Redis·네트워크 미사용).
"""
from __future__ import annotations

import re
from dataclasses import replace
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fakeredis import aioredis as fake_aioredis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth.main import app
from apps.auth.social.config import SocialSettings, get_social_settings
from apps.auth.social.providers import get_http_transport
from apps.auth.social.service import normalize_nickname
from apps.auth.social.state import sign_state
from apps.auth.social.store import SocialStore, get_social_store
from shared.database import get_db
from shared.models import AuthProvider, Base, User
from shared.security import decode_token

SECRET = "test-state-secret-0123456789abcdef"
BASE = "/api/v1/auth/social"
WEB_RETURN = "http://localhost:3000/auth/complete"
KEYED = SocialSettings(
    kakao_rest_api_key="kakao-key",
    naver_client_id="nid",
    naver_client_secret="nsecret",
    state_secret=SECRET,
)


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def ctx(maker):
    """ctx.client(ASGI) + 바꿔 끼울 수 있는 ctx.settings / ctx.transport + ctx.store(fakeredis)."""
    state = SimpleNamespace(
        settings=KEYED,
        transport=None,
        store=SocialStore(fake_aioredis.FakeRedis(decode_responses=True)),
        maker=maker,
    )

    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_social_settings] = lambda: state.settings
    app.dependency_overrides[get_social_store] = lambda: state.store
    app.dependency_overrides[get_http_transport] = lambda: state.transport
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        state.client = client
        yield state
    app.dependency_overrides.clear()


def _query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


def _kakao(user_id: int = 4242, nickname: str | None = "카카오친구", token_status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "kauth.kakao.com":
            if token_status != 200:
                return httpx.Response(token_status, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "kat"})
        if request.url.host == "kapi.kakao.com":
            profile = {"nickname": nickname} if nickname is not None else {}
            return httpx.Response(200, json={"id": user_id, "kakao_account": {"profile": profile}})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


async def _start(ctx, provider: str = "kakao", **params: str) -> str:
    """/start → 302 → 공급자 인가 URL 의 state 반환."""
    r = await ctx.client.get(f"{BASE}/{provider}/start", params={"client": "web", **params})
    assert r.status_code == 302, r.text
    return _query(r.headers["location"])["state"]


async def _callback(ctx, provider: str = "kakao", **params: str) -> httpx.Response:
    return await ctx.client.get(f"{BASE}/{provider}/callback", params=params)


async def _login(ctx, **start_params: str) -> tuple[str, dict[str, str]]:
    """start → callback 까지. (복귀 Location, 쿼리) 반환."""
    state = await _start(ctx, **start_params)
    r = await _callback(ctx, code="c1", state=state)
    assert r.status_code == 302, r.text
    return r.headers["location"], _query(r.headers["location"])


async def _users(ctx) -> list[User]:
    async with ctx.maker() as s:
        return list((await s.execute(select(User).order_by(User.id))).scalars())


# ---------------------------------------------------------------- providers / start
async def test_providers_endpoint(ctx):
    r = await ctx.client.get(f"{BASE}/providers")
    assert r.status_code == 200
    assert r.json() == {"kakao": True, "naver": True}

    ctx.settings = SocialSettings(state_secret=SECRET)
    assert (await ctx.client.get(f"{BASE}/providers")).json() == {"kakao": False, "naver": False}


async def test_start_redirects_to_kakao_authorize(ctx):
    r = await ctx.client.get(f"{BASE}/kakao/start", params={"client": "web"})
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://kauth.kakao.com/oauth/authorize?")
    q = _query(loc)
    assert q["client_id"] == "kakao-key"
    assert q["redirect_uri"] == "http://localhost:8001/api/v1/auth/social/kakao/callback"
    assert q["response_type"] == "code" and q["state"]


async def test_start_redirects_to_naver_authorize(ctx):
    r = await ctx.client.get(f"{BASE}/naver/start", params={"client": "app", "app": "dev"})
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://nid.naver.com/oauth2.0/authorize?")


async def test_start_disabled_provider_503(ctx):
    ctx.settings = SocialSettings(state_secret=SECRET)
    r = await ctx.client.get(f"{BASE}/kakao/start", params={"client": "web"})
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "PROVIDER_DISABLED"


async def test_start_validation(ctx):
    assert (await ctx.client.get(f"{BASE}/apple/start", params={"client": "web"})).status_code == 422
    assert (await ctx.client.get(f"{BASE}/kakao/start", params={"client": "desktop"})).status_code == 422
    assert (await ctx.client.get(f"{BASE}/kakao/start")).status_code == 422  # client 필수


# ---------------------------------------------------------------- callback 성공 + exchange
async def test_callback_creates_user_and_exchange_issues_token(ctx):
    ctx.transport = _kakao(user_id=4242, nickname="카카오친구")
    loc, q = await _login(ctx)
    assert loc.startswith(WEB_RETURN + "?")
    assert set(q) == {"code"}

    users = await _users(ctx)
    assert len(users) == 1
    u = users[0]
    assert (u.provider, u.provider_id, u.nickname) == (AuthProvider.KAKAO, "4242", "카카오친구")
    assert u.email is None and u.password_hash is None and u.social_token is None
    assert u.role.value == "FREE" and u.is_active is True

    r = await ctx.client.post(f"{BASE}/exchange", json={"code": q["code"]})
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["user"] == {"id": u.id, "email": None, "nickname": "카카오친구", "role": "FREE"}
    assert decode_token(body["access_token"])["sub"] == str(u.id)


async def test_relogin_returns_same_user_without_overwriting_nickname(ctx):
    ctx.transport = _kakao(user_id=4242, nickname="처음닉")
    await _login(ctx)
    ctx.transport = _kakao(user_id=4242, nickname="바뀐닉")
    _, q = await _login(ctx)

    users = await _users(ctx)
    assert len(users) == 1
    assert users[0].nickname == "처음닉"
    r = await ctx.client.post(f"{BASE}/exchange", json={"code": q["code"]})
    assert r.json()["user"]["id"] == users[0].id


async def test_same_id_on_other_provider_is_other_user(ctx):
    ctx.transport = _kakao(user_id=1)
    await _login(ctx)

    def naver(request: httpx.Request) -> httpx.Response:
        if request.url.host == "nid.naver.com":
            return httpx.Response(200, json={"access_token": "nat"})
        return httpx.Response(200, json={"resultcode": "00", "response": {"id": "1", "nickname": "네이버"}})

    ctx.transport = httpx.MockTransport(naver)
    state = await _start(ctx, provider="naver")
    r = await _callback(ctx, provider="naver", code="c", state=state)
    assert "code" in _query(r.headers["location"])
    assert [(u.provider, u.provider_id) for u in await _users(ctx)] == [
        (AuthProvider.KAKAO, "1"), (AuthProvider.NAVER, "1"),
    ]


async def test_nickname_fallback_when_provider_has_none(ctx):
    ctx.transport = _kakao(nickname=None)
    await _login(ctx)
    assert re.fullmatch(r"유저\d{4}", (await _users(ctx))[0].nickname)


def test_normalize_nickname():
    assert normalize_nickname("  닉  ") == "닉"
    assert len(normalize_nickname("가" * 150)) == 100
    assert re.fullmatch(r"유저\d{4}", normalize_nickname("   "))


# ---------------------------------------------------------------- callback 실패
async def test_provider_failure_redirects_provider_failed(ctx):
    ctx.transport = _kakao(token_status=500)
    _, q = await _login(ctx)
    assert q == {"error": "provider_failed"}
    assert await _users(ctx) == []


async def test_provider_cancel_redirects_cancelled(ctx):
    state = await _start(ctx)
    r = await _callback(ctx, error="access_denied", error_description="User denied access", state=state)
    assert r.status_code == 302
    assert _query(r.headers["location"]) == {"error": "cancelled"}

    state = await _start(ctx)
    r = await _callback(ctx, error="server_error", state=state)
    assert _query(r.headers["location"]) == {"error": "provider_failed"}


async def test_missing_code_is_provider_failed(ctx):
    state = await _start(ctx)
    r = await _callback(ctx, state=state)
    assert _query(r.headers["location"]) == {"error": "provider_failed"}


async def test_nonce_reuse_redirects_state_invalid(ctx):
    ctx.transport = _kakao()
    state = await _start(ctx)
    first = await _callback(ctx, code="c1", state=state)
    assert "code" in _query(first.headers["location"])
    replay = await _callback(ctx, code="c1", state=state)
    assert replay.status_code == 302
    assert _query(replay.headers["location"]) == {"error": "state_invalid"}


@pytest.mark.parametrize("make_state", [
    lambda: None,  # state 없음
    lambda: "garbage",
    lambda: sign_state("attacker-secret-0123456789abcdef", provider="kakao", client="web", app_variant=None),
    lambda: sign_state(SECRET, provider="naver", client="web", app_variant=None),  # provider 불일치
    lambda: sign_state(SECRET, provider="kakao", client="web", app_variant=None, ttl_seconds=-1),  # 만료
])
async def test_invalid_state_returns_400_html_without_redirect(ctx, make_state):
    state = make_state()
    params = {"code": "c1"} | ({"state": state} if state else {})
    r = await _callback(ctx, **params)
    assert r.status_code == 400
    assert "location" not in r.headers
    assert r.headers["content-type"].startswith("text/html")


async def test_inactive_user_redirects_inactive(ctx):
    async with ctx.maker() as s:
        s.add(User(provider=AuthProvider.KAKAO, provider_id="4242", nickname="정지", is_active=False))
        await s.commit()
    ctx.transport = _kakao(user_id=4242)
    _, q = await _login(ctx)
    assert q == {"error": "inactive"}


# ---------------------------------------------------------------- 복귀 주소 선택
@pytest.mark.parametrize("params, prefix", [
    ({"client": "web"}, WEB_RETURN + "?"),
    ({"client": "app", "app": "dev"}, "stockapp-dev://auth?"),
    ({"client": "app", "app": "prod"}, "stockapp://auth?"),
    ({"client": "app"}, "stockapp://auth?"),  # app 미지정 → prod
])
async def test_return_url_by_client(ctx, params, prefix):
    ctx.transport = _kakao()
    loc, q = await _login(ctx, **params)
    assert loc.startswith(prefix)
    assert "code" in q


async def test_return_url_comes_from_settings(ctx):
    ctx.settings = replace(KEYED, web_return_url="https://app.example.com/auth/complete")
    ctx.transport = _kakao()
    loc, _ = await _login(ctx)
    assert loc.startswith("https://app.example.com/auth/complete?code=")


# ---------------------------------------------------------------- exchange
async def test_exchange_code_is_single_use(ctx):
    ctx.transport = _kakao()
    _, q = await _login(ctx)
    assert (await ctx.client.post(f"{BASE}/exchange", json={"code": q["code"]})).status_code == 200
    again = await ctx.client.post(f"{BASE}/exchange", json={"code": q["code"]})
    assert again.status_code == 401


async def test_exchange_unknown_code_401(ctx):
    r = await ctx.client.post(f"{BASE}/exchange", json={"code": "nope"})
    assert r.status_code == 401
    assert (await ctx.client.post(f"{BASE}/exchange", json={"code": ""})).status_code == 422


async def test_exchange_inactive_user_403(ctx):
    async with ctx.maker() as s:
        user = User(provider=AuthProvider.KAKAO, provider_id="9", nickname="정지", is_active=False)
        s.add(user)
        await s.commit()
        user_id = user.id
    code = await ctx.store.issue_exchange_code(user_id)
    r = await ctx.client.post(f"{BASE}/exchange", json={"code": code})
    assert r.status_code == 403


# ---------------------------------------------------------------- 가짜 공급자 모드
async def test_fake_mode_full_flow(ctx):
    ctx.settings = SocialSettings(state_secret=SECRET, fake_provider_requested=True)
    assert (await ctx.client.get(f"{BASE}/providers")).json() == {"kakao": True, "naver": True}

    r = await ctx.client.get(f"{BASE}/naver/start", params={"client": "web"})
    assert r.status_code == 302
    loc = urlsplit(r.headers["location"])
    assert loc.path == f"{BASE}/naver/callback"  # 공급자 대신 자기 콜백
    assert _query(r.headers["location"])["code"] == "fake"

    cb = await ctx.client.get(f"{loc.path}?{loc.query}")
    code = _query(cb.headers["location"])["code"]
    body = (await ctx.client.post(f"{BASE}/exchange", json={"code": code})).json()
    assert body["user"]["nickname"] == "테스트유저"
    u = (await _users(ctx))[0]
    assert (u.provider, u.provider_id) == (AuthProvider.NAVER, "fake-naver-tester")


async def test_fake_mode_ignored_in_production(ctx):
    ctx.settings = SocialSettings(app_env="production", state_secret=SECRET, fake_provider_requested=True)
    assert (await ctx.client.get(f"{BASE}/providers")).json() == {"kakao": False, "naver": False}
    r = await ctx.client.get(f"{BASE}/kakao/start", params={"client": "web"})
    assert r.status_code == 503


# ---------------------------------------------------------------- 회귀: 기존 엔드포인트
async def test_guest_login_unchanged(ctx):
    r = await ctx.client.post("/api/v1/auth/guest", json={"nickname": "주린이"})
    assert r.status_code == 200
    assert r.json()["user"]["nickname"] == "주린이"
    assert r.json()["user"]["email"].endswith("@guest.local")
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_social_login.py -v`
Expected: 수집 오류 — `ModuleNotFoundError: No module named 'apps.auth.social.service'`

- [ ] **Step 3: 서비스** — `backend/apps/auth/social/service.py`:

```python
"""간편 로그인 유스케이스 — 콜백 처리(프로필 → 사용자 → 교환 코드)와 교환 코드 → 사용자.

라우터는 HTTP(리다이렉트·상태코드) 매핑만 하고, 판단은 여기서 한다.
"""

from __future__ import annotations

import logging
import secrets

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import AuthProvider, User, UserRole

from .providers import Provider, ProviderError, ProviderProfile
from .store import SocialStore

logger = logging.getLogger("auth.social")

NICKNAME_MAX = 100


class SocialLoginError(Exception):
    """콜백 실패 — code 는 복귀 주소에 ?error= 로 실린다(provider_failed·inactive)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class ExchangeError(Exception):
    """교환 실패 — status_code/message 로 HTTP 응답."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def normalize_nickname(raw: str | None) -> str:
    """공급자 닉네임 → 앞뒤 공백 제거·최대 100자, 없으면 '유저' + 4자리 난수."""
    nickname = (raw or "").strip()[:NICKNAME_MAX]
    return nickname or f"유저{secrets.randbelow(10000):04d}"


async def find_or_create_user(
    db: AsyncSession, provider: AuthProvider, profile: ProviderProfile
) -> User:
    """(provider, provider_id) 로 찾고 없으면 생성. 기존 사용자 닉네임은 덮어쓰지 않는다.

    이메일로 기존 계정과 병합하지 않으며 공급자 토큰(social_token)도 저장하지 않는다.
    """
    stmt = select(User).where(User.provider == provider, User.provider_id == profile.id)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if user is not None:
        return user

    user = User(
        email=None,
        password_hash=None,
        role=UserRole.FREE,
        is_active=True,
        provider=provider,
        provider_id=profile.id,
        nickname=normalize_nickname(profile.nickname),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # 같은 계정의 동시 첫 로그인 — 유니크 제약에 걸리면 먼저 만들어진 행을 쓴다
        await db.rollback()
        return (await db.execute(stmt)).scalar_one()
    await db.refresh(user)
    return user


async def complete_social_login(
    *,
    db: AsyncSession,
    store: SocialStore,
    provider: Provider,
    code: str,
    state: str,
    redirect_uri: str,
) -> str:
    """공급자 code → 프로필 → 사용자 → 일회용 교환 코드. 실패는 SocialLoginError."""
    try:
        profile = await provider.exchange_code(code=code, state=state, redirect_uri=redirect_uri)
    except ProviderError as exc:
        logger.warning("social login provider failure (%s): %s", provider.name, exc)
        raise SocialLoginError("provider_failed") from exc

    user = await find_or_create_user(db, AuthProvider(provider.name.upper()), profile)
    if not user.is_active:
        raise SocialLoginError("inactive")
    return await store.issue_exchange_code(user.id)


async def redeem_exchange_code(db: AsyncSession, store: SocialStore, code: str) -> User:
    """교환 코드(1회) → 활성 사용자. 실패는 ExchangeError."""
    user_id = await store.consume_exchange_code(code)
    if user_id is None:
        raise ExchangeError(401, "로그인 코드가 만료되었거나 이미 사용되었어요. 다시 로그인해 주세요.")
    user = await db.get(User, user_id)
    if user is None:
        raise ExchangeError(401, "사용자를 찾을 수 없습니다.")
    if not user.is_active:
        raise ExchangeError(403, "비활성화된 계정입니다.")
    return user
```

- [ ] **Step 4: 스키마** — `backend/apps/auth/schemas.py` 파일 **끝**에 추가(기존 클래스 무수정):

```python
class SocialProvidersOut(BaseModel):
    """간편 로그인 공급자 활성 여부(버튼 노출용)."""

    kakao: bool
    naver: bool


class SocialExchangeRequest(BaseModel):
    """콜백이 복귀 주소에 실어 준 일회용 교환 코드."""

    code: str = Field(..., min_length=1, max_length=200)
```

- [ ] **Step 5: 라우터** — `backend/apps/auth/routers/social.py`:

```python
"""간편 로그인 라우터 — providers / start / callback / exchange.

흐름: start(302 공급자) → callback(302 복귀 주소?code=교환코드) → exchange(TokenResponse).
복귀 주소는 state 의 client/app_variant 로 서버 설정에서만 고른다(오픈 리다이렉트 방지).
"""

from __future__ import annotations

from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_db
from shared.security import create_access_token

from .. import schemas
from ..social.config import SocialSettings, get_social_settings
from ..social.providers import build_provider, get_http_transport
from ..social.service import (
    ExchangeError,
    SocialLoginError,
    complete_social_login,
    redeem_exchange_code,
)
from ..social.state import StateError, sign_state, verify_state
from ..social.store import SocialStore, get_social_store

router = APIRouter(prefix="/api/v1/auth/social", tags=["auth-social"])

ProviderName = Literal["kakao", "naver"]
_LABELS = {"kakao": "카카오", "naver": "네이버"}
# 공급자가 '사용자 취소'로 돌려주는 error 값. 그 밖의 error 는 provider_failed.
_CANCEL_ERRORS = {"access_denied"}

_STATE_ERROR_HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>로그인 오류</title></head>
<body style="font-family:sans-serif;padding:32px;text-align:center;color:#191f28">
<h1 style="font-size:18px">로그인 요청이 만료되었거나 올바르지 않아요</h1>
<p style="color:#8b95a1">이 창을 닫고 앱 또는 웹에서 다시 로그인해 주세요.</p>
</body></html>"""


def _with_query(url: str, **params: str) -> str:
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True) + list(params.items())
    return urlunsplit(parts._replace(query=urlencode(query)))


def _redirect(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=status.HTTP_302_FOUND)


def _state_error_page() -> HTMLResponse:
    return HTMLResponse(_STATE_ERROR_HTML, status_code=status.HTTP_400_BAD_REQUEST)


@router.get("/providers", response_model=schemas.SocialProvidersOut)
async def providers(settings: SocialSettings = Depends(get_social_settings)):
    """버튼 노출용(공개) — 키가 설정됐거나 가짜 모드면 true."""
    return schemas.SocialProvidersOut(
        kakao=settings.is_enabled("kakao"), naver=settings.is_enabled("naver")
    )


@router.get("/{provider}/start")
async def start(
    provider: ProviderName,
    client: Literal["web", "app"] = Query(..., description="web | app"),
    app: Literal["dev", "prod"] = Query("prod", description="client=app 일 때 앱 변형(스킴 선택)"),
    settings: SocialSettings = Depends(get_social_settings),
    transport: httpx.AsyncBaseTransport | None = Depends(get_http_transport),
):
    impl = build_provider(provider, settings, transport)
    if impl is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "PROVIDER_DISABLED", "message": f"{_LABELS[provider]} 로그인은 준비 중이에요."},
        )
    state = sign_state(
        settings.effective_state_secret,
        provider=provider,
        client=client,
        app_variant=app if client == "app" else None,
    )
    return _redirect(impl.authorize_url(redirect_uri=settings.redirect_uri(provider), state=state))


@router.get("/{provider}/callback")
async def callback(
    provider: ProviderName,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
    settings: SocialSettings = Depends(get_social_settings),
    store: SocialStore = Depends(get_social_store),
    transport: httpx.AsyncBaseTransport | None = Depends(get_http_transport),
):
    # 1) state 서명·만료·provider — 실패하면 복귀 주소를 모르므로 400 HTML 로 끝낸다
    if not state:
        return _state_error_page()
    try:
        payload = verify_state(settings.effective_state_secret, state, provider=provider)
    except StateError:
        return _state_error_page()
    return_url = settings.return_url(payload.client, payload.app_variant)

    # 2) nonce 1회 사용
    if not await store.use_nonce(payload.nonce):
        return _redirect(_with_query(return_url, error="state_invalid"))

    # 3) 공급자 오류(사용자 취소 등)
    if error:
        reason = "cancelled" if error in _CANCEL_ERRORS else "provider_failed"
        return _redirect(_with_query(return_url, error=reason))

    impl = build_provider(provider, settings, transport)
    if impl is None or not code:
        return _redirect(_with_query(return_url, error="provider_failed"))

    # 4) code → 프로필 → 사용자 → 교환 코드
    try:
        exchange_code = await complete_social_login(
            db=db,
            store=store,
            provider=impl,
            code=code,
            state=state,
            redirect_uri=settings.redirect_uri(provider),
        )
    except SocialLoginError as exc:
        return _redirect(_with_query(return_url, error=exc.code))
    return _redirect(_with_query(return_url, code=exchange_code))


@router.post("/exchange", response_model=schemas.TokenResponse)
async def exchange(
    payload: schemas.SocialExchangeRequest,
    db: AsyncSession = Depends(get_db),
    store: SocialStore = Depends(get_social_store),
):
    """일회용 교환 코드 → 서비스 JWT(기존 TokenResponse 형식)."""
    try:
        user = await redeem_exchange_code(db, store, payload.code)
    except ExchangeError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc
    token = create_access_token(subject=user.id, role=user.role.value)
    return schemas.TokenResponse(access_token=token, user=user)
```

- [ ] **Step 6: 앱 등록** — `backend/apps/auth/main.py` 전체(기존 동작 유지 + `social` 라우터·기동 경고):

```python
"""인증 마이크로서비스 (FastAPI).

역할: 소셜/이메일 로그인, JWT 발급·검증, 권한 관리 전담.

실행:
    cd backend
    uv run uvicorn apps.auth.main:app --reload --port 8001
문서: http://localhost:8001/docs
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.cors import build_allowed_origins

from .routers import auth, social
from .social.config import load_social_settings, startup_warnings

logger = logging.getLogger("auth")

app = FastAPI(title="Stock App - Auth Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=build_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(social.router)

# 간편 로그인 설정 경고(운영에서 가짜 공급자 켜짐·state 키 미설정) — 기동 시 1회
for _msg in startup_warnings(load_social_settings()):
    logger.warning("[social] %s", _msg)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "auth"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.auth.main:app", host="0.0.0.0", port=8001, reload=True)
```

- [ ] **Step 7: 통과 확인**

Run: `cd backend && uv run pytest tests/test_social_login.py -v` → 31 passed
Run: `cd backend && uv run pytest -q` → **295 passed**(기존 228 + 67)

- [ ] **Step 8: 커밋**

```bash
git add backend/apps/auth/social/service.py backend/apps/auth/routers/social.py backend/apps/auth/schemas.py backend/apps/auth/main.py backend/tests/test_social_login.py
git commit -m "feat(auth): 간편 로그인 API — providers/start/callback/exchange(백엔드 콜백 + 일회용 교환 코드, 복귀 주소 서버 고정, 가짜 공급자 모드)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: web_client 기반 — 설정 · 타입 · API · 스토어 · 보조 lib

**Files:**
- Modify: `web_client/src/vite-env.d.ts`, `src/config.ts`, `src/types/api.ts`, `src/api/auth.ts`, `src/store/auth.ts`, `tailwind.config.js`
- Create: `web_client/src/lib/socialLogin.ts`

- [ ] **Step 1: `src/vite-env.d.ts`** — `ImportMetaEnv` 의 `readonly VITE_STOCK_API_URL?: string` 다음 줄에 추가:

```ts
  readonly VITE_ENABLE_GUEST_LOGIN?: string
```

- [ ] **Step 2: `src/config.ts`** — 파일 **끝**에 추가(기존 내용 유지):

```ts
// 닉네임(게스트) 로그인 노출 — 개발·테스트용.
//   'true' → 노출, 'false' → 숨김, 미설정 → dev(vite serve)만 노출(배포 빌드 기본 숨김).
const GUEST_FLAG = import.meta.env.VITE_ENABLE_GUEST_LOGIN
export const ENABLE_GUEST_LOGIN: boolean =
  GUEST_FLAG === 'true' || (import.meta.env.DEV && GUEST_FLAG !== 'false')
```

- [ ] **Step 3: `src/types/api.ts`** — `TokenResponse` 인터페이스 바로 아래에 추가:

```ts
/** 간편 로그인 공급자 — 출처: backend/apps/auth/routers/social.py */
export type SocialProvider = 'kakao' | 'naver'

/** GET /auth/social/providers — 공급자별 활성 여부(버튼 노출용) */
export type SocialProviders = Record<SocialProvider, boolean>
```

- [ ] **Step 4: `tailwind.config.js`** — `colors` 의 `line: '#e5e8eb', // border` 다음 줄에 추가(공급자 가이드 고정색이라 토큰으로 둔다):

```js
        kakao: '#FEE500', // 카카오 로그인 버튼(공급자 가이드 색)
        naver: '#03C75A', // 네이버 로그인 버튼(공급자 가이드 색)
```

- [ ] **Step 5: `src/api/auth.ts`** — 전체 교체(`guestLogin` 동작 불변 + 3개 함수 추가):

```ts
import axios from 'axios'
import { AUTH_BASE_URL as authURL } from '../config'
import type { SocialProvider, SocialProviders, TokenResponse } from '../types/api'

// 인증 서비스 base URL (auth 8001) — 빌드 타임 주입, 폴백/fail-fast 는 ../config

const authClient = axios.create({
  baseURL: authURL,
  headers: { 'Content-Type': 'application/json' },
})

// 임시 로그인 — 닉네임으로 게스트 계정 발급(개발·테스트용, ENABLE_GUEST_LOGIN 일 때만 노출)
export const guestLogin = async (nickname: string): Promise<TokenResponse> => {
  const { data } = await authClient.post<TokenResponse>('/auth/guest', { nickname })
  return data // { access_token, token_type, user }
}

// ---- 간편 로그인(카카오·네이버) ----
// 흐름: 브라우저를 start URL 로 이동 → 공급자 → auth 콜백 → /auth/complete?code=… → exchange

/** 브라우저 이동용 시작 URL(axios 아님 — 페이지 전체 이동) */
export const socialStartUrl = (provider: SocialProvider): string =>
  `${authURL.replace(/\/$/, '')}/auth/social/${provider}/start?client=web`

/** 공급자별 활성 여부(키 미설정 공급자는 false → 버튼 숨김) */
export const getSocialProviders = async (): Promise<SocialProviders> => {
  const { data } = await authClient.get<Partial<SocialProviders>>('/auth/social/providers')
  return { kakao: data.kakao === true, naver: data.naver === true }
}

/** 일회용 교환 코드 → 서비스 JWT(게스트 로그인과 같은 TokenResponse) */
export const exchangeSocialCode = async (code: string): Promise<TokenResponse> => {
  const { data } = await authClient.post<TokenResponse>('/auth/social/exchange', { code })
  return data
}
```

- [ ] **Step 6: `src/store/auth.ts`** — 전체 교체(`login` 은 같은 저장 경로인 `loginWithToken` 을 거치도록만 바뀜 — 동작 불변):

```ts
import { create } from 'zustand'
import { guestLogin } from '../api/auth'
import type { TokenResponse, UserOut } from '../types/api'

// localStorage 키 (client.ts 인터셉터와 공유)
export const TOKEN_KEY = 'wc_token'
const USER_KEY = 'wc_user'

const readUser = (): UserOut | null => {
  try {
    // getItem 이 null 이면 JSON.parse(null) === null → || null 로 동일 처리(원본 JS 동작). `!` 는 타입 표기용.
    return (JSON.parse(localStorage.getItem(USER_KEY)!) as UserOut | null) || null
  } catch {
    return null
  }
}

interface AuthState {
  token: string | null
  user: UserOut | null
  login: (nickname: string) => Promise<UserOut>
  /** 이미 발급된 토큰(간편 로그인 교환 결과)을 저장 — login 과 같은 저장 경로 */
  loginWithToken: (res: TokenResponse) => UserOut
  logout: () => void
}

// 로그인 전역 상태. 게스트(닉네임)·간편 로그인(카카오·네이버) 모두 같은 키에 토큰+유저를 저장한다.
export const useAuthStore = create<AuthState>()((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: readUser(),

  login: async (nickname) => {
    const res = await guestLogin(nickname)
    return get().loginWithToken(res)
  },

  loginWithToken: ({ access_token, user }) => {
    localStorage.setItem(TOKEN_KEY, access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    set({ token: access_token, user })
    return user
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    set({ token: null, user: null })
  },
}))
```

- [ ] **Step 7: `src/lib/socialLogin.ts`**

```ts
// 간편 로그인 보조 — 복귀 경로 보관(sessionStorage)과 오류 코드 문구.
// 복귀 경로는 같은 사이트 내부 경로만 허용한다(오픈 리다이렉트 방지).

const RETURN_KEY = 'wc_login_return'
export const AUTH_COMPLETE_PATH = '/auth/complete'

/** 내부 경로만 허용: '/'로 시작, '//'·'/\' 금지, 완료 라우트 자신 금지 */
export function isSafeReturnPath(path: string | null): path is string {
  return (
    !!path &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/\\') &&
    !path.startsWith(AUTH_COMPLETE_PATH)
  )
}

/** 공급자로 떠나기 직전 현재 경로를 기억 */
export function rememberLoginReturn(): void {
  try {
    sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search)
  } catch {
    // 저장 불가(사파리 프라이빗 등) → 완료 후 홈으로
  }
}

/** 기억한 경로를 꺼내고 지운다. 없거나 안전하지 않으면 '/' */
export function takeLoginReturn(): string {
  let saved: string | null = null
  try {
    saved = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    saved = null
  }
  return isSafeReturnPath(saved) ? saved : '/'
}

/** 콜백 ?error= 코드 → 사용자 문구 (출처: backend/apps/auth/routers/social.py) */
export function socialErrorMessage(code: string): string {
  switch (code) {
    case 'cancelled':
      return '로그인을 취소했어요.'
    case 'inactive':
      return '이용이 제한된 계정이에요. 고객센터로 문의해 주세요.'
    case 'state_invalid':
      return '로그인 요청이 만료되었어요. 다시 시도해 주세요.'
    case 'provider_failed':
    default:
      return '로그인에 실패했어요. 잠시 후 다시 시도해 주세요.'
  }
}
```

- [ ] **Step 8: 검증** — 공통 web_client 검증 명령. 기대: tsc 통과, 빌드 통과, `OK: localhost 없음`.

- [ ] **Step 9: 커밋**

```bash
git add web_client/src/vite-env.d.ts web_client/src/config.ts web_client/src/types/api.ts web_client/tailwind.config.js web_client/src/api/auth.ts web_client/src/store/auth.ts web_client/src/lib/socialLogin.ts
git commit -m "feat(web): 간편 로그인 기반 — 소셜 API(start URL·providers·exchange)·loginWithToken·복귀 경로 보관·ENABLE_GUEST_LOGIN·카카오/네이버 색 토큰

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: web_client 화면 — LoginModal · 완료 라우트

**Files:**
- Modify: `web_client/src/components/LoginModal.tsx`(교체), `web_client/src/App.tsx`
- Create: `web_client/src/pages/AuthCompletePage.tsx`

> - LoginModal: 열릴 때마다 `getSocialProviders()` → 활성 공급자 버튼만 노출. 클릭 시 `rememberLoginReturn()`(현재 `pathname+search`) 후 `location.assign(startUrl)`. 게스트 닉네임 폼은 `ENABLE_GUEST_LOGIN` 일 때만(배포 빌드 기본 false → 번들에서 제거됨). 공급자 0개 + 게스트 off 면 "준비 중"/"연결할 수 없어요" 안내(빈 모달 방지).
> - AuthCompletePage: **React 18 StrictMode 는 dev 에서 effect 를 두 번 실행**한다 → 교환 코드(GETDEL 1회용)를 두 번 쓰면 두 번째가 401 이 되어 성공했는데도 오류 화면이 뜬다. `useRef` 가드로 교환을 1회만 실행한다.

- [ ] **Step 1: `src/components/LoginModal.tsx`** — 전체 교체(props 동일):

```tsx
import { type FormEvent, useEffect, useState } from 'react'
import { getSocialProviders, socialStartUrl } from '../api/auth'
import { ENABLE_GUEST_LOGIN } from '../config'
import { rememberLoginReturn } from '../lib/socialLogin'
import { useAuthStore } from '../store/auth'
import type { SocialProvider, SocialProviders } from '../types/api'

interface LoginModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

type ProvidersState = { status: 'loading' } | { status: 'ready'; providers: SocialProviders } | { status: 'error' }

const SOCIAL_BUTTONS: { provider: SocialProvider; label: string; className: string }[] = [
  { provider: 'kakao', label: '카카오로 시작하기', className: 'bg-kakao text-black' },
  { provider: 'naver', label: '네이버로 시작하기', className: 'bg-naver text-white' },
]

// 로그인 모달 — 카카오·네이버 간편 로그인 + (개발용) 닉네임 로그인
export default function LoginModal({ open, onClose, onSuccess }: LoginModalProps) {
  const login = useAuthStore((s) => s.login)
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [providersState, setProvidersState] = useState<ProvidersState>({ status: 'loading' })

  // 열릴 때마다 공급자 활성 여부 조회(키 미설정 공급자는 버튼 숨김)
  useEffect(() => {
    if (!open) return
    let alive = true
    setProvidersState({ status: 'loading' })
    getSocialProviders()
      .then((providers) => {
        if (alive) setProvidersState({ status: 'ready', providers })
      })
      .catch(() => {
        if (alive) setProvidersState({ status: 'error' })
      })
    return () => {
      alive = false
    }
  }, [open])

  if (!open) return null

  const visibleSocial =
    providersState.status === 'ready'
      ? SOCIAL_BUTTONS.filter((b) => providersState.providers[b.provider])
      : []
  const noOptions = providersState.status !== 'loading' && visibleSocial.length === 0 && !ENABLE_GUEST_LOGIN

  const startSocial = (provider: SocialProvider) => {
    rememberLoginReturn()
    window.location.assign(socialStartUrl(provider))
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const nick = nickname.trim()
    if (!nick) {
      setError('닉네임을 입력하세요.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await login(nick)
      setNickname('')
      onSuccess?.()
      onClose()
    } catch {
      setError('로그인에 실패했습니다. (auth 서버 8001 확인)')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-card bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">로그인</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-muted">간편 로그인으로 댓글·게임에 참여하세요.</p>

        <div className="space-y-2">
          {providersState.status === 'loading' && (
            <p className="py-2 text-center text-sm text-ink-muted">불러오는 중…</p>
          )}
          {visibleSocial.map((b) => (
            <button
              key={b.provider}
              type="button"
              onClick={() => startSocial(b.provider)}
              className={`h-11 w-full rounded-btn text-sm font-semibold transition hover:brightness-95 ${b.className}`}
            >
              {b.label}
            </button>
          ))}
          {noOptions && (
            <p className="py-2 text-center text-sm text-ink-muted">
              {providersState.status === 'error'
                ? '로그인 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
                : '로그인을 준비하고 있어요.'}
            </p>
          )}
        </div>

        {ENABLE_GUEST_LOGIN && (
          <form onSubmit={submit} className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-xs text-ink-muted">개발용 닉네임 로그인</p>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
              placeholder="닉네임 (예: 주린이)"
              className="w-full rounded-field border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
            {error && <p className="mt-2 text-sm text-up">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="mt-3 w-full rounded-btn bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
            >
              {loading ? '로그인 중…' : '닉네임으로 시작'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `src/pages/AuthCompletePage.tsx`**

```tsx
import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeSocialCode } from '../api/auth'
import EmptyState from '../components/ui/EmptyState'
import { socialErrorMessage, takeLoginReturn } from '../lib/socialLogin'
import { useAuthStore } from '../store/auth'

// 간편 로그인 완료 라우트(/auth/complete) — auth 콜백이 ?code=교환코드 또는 ?error=코드 로 보낸다.
export default function AuthCompletePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const loginWithToken = useAuthStore((s) => s.loginWithToken)
  const code = params.get('code')
  const errorCode = params.get('error')
  const [exchangeError, setExchangeError] = useState<string | null>(null)
  // 교환 코드는 1회용 — React StrictMode 의 effect 이중 실행에서 두 번째 교환(401)을 막는다
  const startedRef = useRef(false)

  useEffect(() => {
    if (!code || errorCode || startedRef.current) return
    startedRef.current = true
    exchangeSocialCode(code)
      .then((res) => {
        loginWithToken(res)
        navigate(takeLoginReturn(), { replace: true })
      })
      .catch((err: unknown) => {
        const inactive = axios.isAxiosError(err) && err.response?.status === 403
        setExchangeError(socialErrorMessage(inactive ? 'inactive' : 'state_invalid'))
      })
  }, [code, errorCode, loginWithToken, navigate])

  const message = errorCode
    ? socialErrorMessage(errorCode)
    : (exchangeError ?? (code ? null : '잘못된 접근이에요. 다시 로그인해 주세요.'))

  if (!message) return <p className="py-16 text-center text-ink-muted">로그인 중…</p>

  const cancelled = errorCode === 'cancelled'
  return (
    <EmptyState
      emoji={cancelled ? '👋' : '🔒'}
      title={cancelled ? '로그인을 취소했어요' : '로그인하지 못했어요'}
      description={message}
      action={
        <Link
          to="/"
          replace
          className="inline-flex h-11 items-center justify-center rounded-btn bg-brand px-4 text-sm font-semibold text-white hover:brightness-95"
        >
          홈으로
        </Link>
      }
    />
  )
}
```

- [ ] **Step 3: `src/App.tsx`** — import 추가 + 라우트 추가(`*` 폴백 **위**):

```tsx
import Layout from './components/Layout'
import AuthCompletePage from './pages/AuthCompletePage'
```

```tsx
        <Route path="auth/complete" element={<AuthCompletePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
```

- [ ] **Step 4: 검증** — 공통 web_client 검증 명령 + 게스트 폼 플래그 확인:

```bash
cd web_client
grep -c "닉네임으로 시작" dist/assets/index-*.js   # 기대: 0 (배포 빌드 기본 숨김)
VITE_ENABLE_GUEST_LOGIN=true VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build
grep -c "닉네임으로 시작" dist/assets/index-*.js   # 기대: 1
VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build   # dist 원복
```

- [ ] **Step 5: 커밋**

```bash
git add web_client/src/components/LoginModal.tsx web_client/src/pages/AuthCompletePage.tsx web_client/src/App.tsx
git commit -m "feat(web): 간편 로그인 화면 — 카카오·네이버 버튼(비활성 공급자 숨김)·개발용 게스트 폼 플래그·/auth/complete 교환 라우트(StrictMode 1회 가드)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 7: 모바일 — 복귀 URL 파서(TDD) · 인앱 브라우저 세션 · 내정보 버튼

**Files:**
- Create: `mobile/src/features/auth/return-url.ts`, `return-url.test.ts`, `social.ts`, `social-button.tsx`, `mobile/src/app/+native-intent.tsx`
- Modify: `mobile/app.config.js`, `mobile/src/lib/env.ts`, `mobile/src/features/auth/api.ts`, `mobile/src/features/auth/store.ts`, `mobile/src/app/(tabs)/profile.tsx`

> - SDK 57 시그니처(설치본 `node_modules/*/build/*.d.ts` 로 확인): `WebBrowser.openAuthSessionAsync(url: string, redirectUrl?: string | null, options?) → Promise<WebBrowserAuthSessionResult>`(`{type:'success', url}` | `{type:'cancel'|'dismiss'|…}`), `Linking.createURL(path, {scheme?, queryParams?, isTripleSlashed?}) → string`(dev build: `stockapp-dev://auth`).
> - `parseAuthReturnUrl` 은 RN 의 불완전한 `URL`/`URLSearchParams` 를 피하려고 직접 파싱하며, Expo 모듈을 import 하지 않아 jest 목 없이 돈다.
> - `app=dev|prod` 는 **스킴과 같은 출처**(`APP_ENV` → `app.config.js` `extra.appEnv` → `Constants.expoConfig.extra.appEnv`)로 정한다. `EXPO_PUBLIC_APP_ENV` 로 정하면 바이너리가 갖지 않은 스킴으로 복귀해 세션이 닫히지 않을 수 있다.
> - Android 는 복귀 링크가 앱 인텐트로도 들어와 expo-router 가 없는 `/auth` 로 이동(Unmatched)한다 → `+native-intent.tsx` 의 `redirectSystemPath` 가 `null`(현재 화면 유지)을 돌려준다(expo-router `link/linking.js` subscribe 는 falsy 면 이동하지 않음). 앱이 그 링크로 콜드 스타트한 경우만 `/profile`.
> - 기존 코드에 `stockapp` 스킴 참조는 `app.config.js` 한 곳뿐(검색 확인). 스킴 변경은 **dev build 1회 재생성** 필요(Task 8 README).

- [ ] **Step 1: 실패하는 테스트 작성** — `mobile/src/features/auth/return-url.test.ts`:

```ts
import { isAuthReturnUrl, parseAuthReturnUrl, socialErrorMessage } from './return-url';

describe('parseAuthReturnUrl', () => {
  test('code', () => {
    expect(parseAuthReturnUrl('stockapp://auth?code=abc123')).toEqual({ type: 'code', code: 'abc123' });
  });
  test('dev 스킴 + URL 인코딩 해제', () => {
    expect(parseAuthReturnUrl('stockapp-dev://auth?code=a%2Bb%3D')).toEqual({ type: 'code', code: 'a+b=' });
  });
  test('error', () => {
    expect(parseAuthReturnUrl('stockapp://auth?error=cancelled')).toEqual({ type: 'error', error: 'cancelled' });
  });
  test('error 가 code 보다 우선', () => {
    expect(parseAuthReturnUrl('stockapp://auth?code=x&error=inactive')).toEqual({ type: 'error', error: 'inactive' });
  });
  test('해시 무시·첫 값 사용', () => {
    expect(parseAuthReturnUrl('stockapp://auth?code=first&code=second#frag')).toEqual({ type: 'code', code: 'first' });
  });
  test('쿼리 없음·빈 값·깨진 인코딩은 null', () => {
    expect(parseAuthReturnUrl('stockapp://auth')).toBeNull();
    expect(parseAuthReturnUrl('stockapp://auth?code=')).toBeNull();
    expect(parseAuthReturnUrl('stockapp://auth?code=%E0%A4%A')).toBeNull();
  });
});

describe('isAuthReturnUrl', () => {
  test('복귀 딥링크', () => {
    expect(isAuthReturnUrl('stockapp://auth?code=x')).toBe(true);
    expect(isAuthReturnUrl('stockapp-dev://auth?error=cancelled')).toBe(true);
    expect(isAuthReturnUrl('stockapp-dev://auth')).toBe(true);
    expect(isAuthReturnUrl('/auth?code=x')).toBe(true);
  });
  test('다른 경로', () => {
    expect(isAuthReturnUrl('stockapp://blog/1')).toBe(false);
    expect(isAuthReturnUrl('stockapp://authors')).toBe(false);
    expect(isAuthReturnUrl('/profile')).toBe(false);
  });
});

describe('socialErrorMessage', () => {
  test('알려진 코드와 기본 문구', () => {
    expect(socialErrorMessage('inactive')).toContain('제한');
    expect(socialErrorMessage('unknown')).toBe('로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/auth`
Expected: FAIL — `Cannot find module './return-url' from 'src/features/auth/return-url.test.ts'`

- [ ] **Step 3: 구현** — `mobile/src/features/auth/return-url.ts`:

```ts
/**
 * 간편 로그인 복귀 URL 파싱(순수 함수 — Expo/RN 의존 없음, jest 대상).
 * auth 콜백은 `stockapp[-dev]://auth?code=…` 또는 `…?error=…` 로 돌려보낸다.
 * RN 의 URL/URLSearchParams 구현은 불완전할 수 있어 직접 파싱한다.
 */

export type AuthReturn = { type: 'code'; code: string } | { type: 'error'; error: string };

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

function parseQuery(url: string): Map<string, string> {
  const params = new Map<string, string>();
  const start = url.indexOf('?');
  if (start < 0) return params;
  const hash = url.indexOf('#', start);
  const query = url.slice(start + 1, hash < 0 ? undefined : hash);
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = safeDecode(eq < 0 ? pair : pair.slice(0, eq));
    const value = safeDecode(eq < 0 ? '' : pair.slice(eq + 1));
    if (key && value !== null && !params.has(key)) params.set(key, value);
  }
  return params;
}

/** 복귀 URL → code 또는 error. 둘 다 없으면 null. error 가 우선한다. */
export function parseAuthReturnUrl(url: string): AuthReturn | null {
  const params = parseQuery(url);
  const error = params.get('error');
  if (error) return { type: 'error', error };
  const code = params.get('code');
  if (code) return { type: 'code', code };
  return null;
}

/** 간편 로그인 복귀 딥링크인지(`<scheme>://auth?...`, `/auth?...`) — expo-router 라우팅 제외용 */
export function isAuthReturnUrl(url: string): boolean {
  const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '');
  return /^auth(?:[/?#]|$)/.test(rest);
}

/** 콜백 ?error= 코드 → 사용자 문구 (출처: backend/apps/auth/routers/social.py) */
export function socialErrorMessage(code: string): string {
  switch (code) {
    case 'cancelled':
      return '로그인을 취소했어요.';
    case 'inactive':
      return '이용이 제한된 계정이에요. 고객센터로 문의해 주세요.';
    case 'state_invalid':
      return '로그인 요청이 만료되었어요. 다시 시도해 주세요.';
    default:
      return '로그인에 실패했어요. 잠시 후 다시 시도해 주세요.';
  }
}
```

Run: `cd mobile && npx jest src/features/auth` → 9 passed

- [ ] **Step 4: `mobile/app.config.js`** — `scheme: 'stockapp',` 줄을 교체:

```js
    // 딥링크 스킴도 dev/prod 분리 — 간편 로그인 복귀(stockapp[-dev]://auth)가 같은 기기의 다른 앱으로 가지 않게
    scheme: isDev ? 'stockapp-dev' : 'stockapp',
```

- [ ] **Step 5: `mobile/src/lib/env.ts`** — `export const ENV = {` **위**에 추가하고, 객체에 `enableGuestLogin,` 를 `gameApiUrl,` 다음 줄로 추가:

```ts
/**
 * 닉네임(게스트) 로그인 노출 — 개발·테스트용.
 * EXPO_PUBLIC_ENABLE_GUEST_LOGIN 'true'/'false' 우선, 미설정이면 production 이 아닐 때만 노출.
 */
const guestFlag = process.env.EXPO_PUBLIC_ENABLE_GUEST_LOGIN;
const enableGuestLogin: boolean = guestFlag ? guestFlag === 'true' : appEnv !== 'production';
```

```ts
  gameApiUrl,
  enableGuestLogin,
} as const;
```

- [ ] **Step 6: `mobile/src/features/auth/api.ts`** — 전체 교체(`guestLogin` 불변 + 소셜 3함수):

```ts
import { authApi } from '@/lib/api';
import { ENV } from '@/lib/env';

import type { User } from './types';

// 서버(FastAPI) 원응답 형태(snake_case) — backend/apps/auth/schemas.py TokenResponse/UserOut
type RawUser = {
  id: number;
  email: string | null;
  nickname: string | null;
  role: string;
};

type RawTokenResponse = {
  access_token: string;
  token_type: string;
  user: RawUser;
};

function toUser(r: RawUser): User {
  return {
    id: r.id,
    email: r.email,
    nickname: r.nickname,
    role: r.role,
  };
}

export type GuestLoginResult = {
  accessToken: string;
  user: User;
};

/** 게스트·간편 로그인 공통 결과(서비스 JWT + 사용자) */
export type LoginResult = GuestLoginResult;

export type SocialProvider = 'kakao' | 'naver';
export type SocialProviders = Record<SocialProvider, boolean>;

/** 게스트(닉네임) 로그인 — 비밀번호 없이 닉네임만으로 발급. POST /api/v1/auth/guest (auth 서비스, 포트 8001) */
export async function guestLogin(nickname: string): Promise<GuestLoginResult> {
  const raw = await authApi.post<RawTokenResponse>('/api/v1/auth/guest', { nickname });
  return { accessToken: raw.access_token, user: toUser(raw.user) };
}

/** 간편 로그인 공급자 활성 여부 — GET /api/v1/auth/social/providers (키 미설정 공급자는 false) */
export async function getSocialProviders(): Promise<SocialProviders> {
  const raw = await authApi.get<Partial<SocialProviders>>('/api/v1/auth/social/providers');
  return { kakao: raw.kakao === true, naver: raw.naver === true };
}

/** 인앱 브라우저로 여는 시작 URL. app=dev|prod 로 서버가 복귀 스킴(stockapp-dev/stockapp)을 고른다. */
export function socialStartUrl(provider: SocialProvider, appVariant: 'dev' | 'prod'): string {
  const base = ENV.authApiUrl.replace(/\/$/, '');
  return `${base}/api/v1/auth/social/${provider}/start?client=app&app=${appVariant}`;
}

/** 일회용 교환 코드 → 서비스 JWT. POST /api/v1/auth/social/exchange */
export async function exchangeSocialCode(code: string): Promise<LoginResult> {
  const raw = await authApi.post<RawTokenResponse>('/api/v1/auth/social/exchange', { code });
  return { accessToken: raw.access_token, user: toUser(raw.user) };
}
```

- [ ] **Step 7: `mobile/src/features/auth/store.ts`** — 전체 교체(`login` 은 `loginWithToken` 경유 — 동작 불변):

```ts
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { registerUnauthorizedHandler, setAuthToken as setHttpAuthToken } from '@/lib/api/auth-token';

import { guestLogin, type LoginResult } from './api';
import type { User } from './types';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

type AuthState = {
  token: string | null;
  user: User | null;
  /** SecureStore에서 최초 로드를 마쳤는지 여부. false인 동안은 로그아웃 상태로 취급한다. */
  hydrated: boolean;
  login: (nickname: string) => Promise<User>;
  /** 이미 발급된 토큰(간편 로그인 교환 결과)을 저장 — login 과 같은 경로(메모리 홀더 + SecureStore) */
  loginWithToken: (result: LoginResult) => User;
  logout: () => void;
  hydrate: () => Promise<void>;
};

async function persist(token: string | null, user: User | null): Promise<void> {
  await Promise.all([
    token ? SecureStore.setItemAsync(TOKEN_KEY, token) : SecureStore.deleteItemAsync(TOKEN_KEY),
    user
      ? SecureStore.setItemAsync(USER_KEY, JSON.stringify(user))
      : SecureStore.deleteItemAsync(USER_KEY),
  ]);
}

// 게스트(닉네임) 로그인 전역 상태. web client의 store/auth.js와 동일한 의미론(token+user, login/logout).
// 토큰은 SecureStore에 영속화하고, http 클라이언트가 동기적으로 읽을 수 있도록 메모리 홀더(auth-token.ts)에도 반영한다.
export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  hydrated: false,

  login: async (nickname: string) => {
    const result = await guestLogin(nickname);
    return get().loginWithToken(result);
  },

  loginWithToken: ({ accessToken, user }) => {
    setHttpAuthToken(accessToken);
    set({ token: accessToken, user });
    // 저장 실패는 무시(메모리 상태가 우선) — logout()과 동일하게 fire-and-forget.
    persist(accessToken, user).catch(() => {});
    return user;
  },

  logout: () => {
    setHttpAuthToken(null);
    set({ token: null, user: null });
    persist(null, null).catch(() => {});
  },

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const [token, rawUser] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ]);

      // hydrate()가 대기하는 동안 사용자가 이미 로그인했다면(닉네임 입력이 SecureStore 읽기보다 빠른 경우),
      // 이전 저장값으로 방금 로그인한 상태를 덮어쓰지 않는다.
      if (get().token) {
        set({ hydrated: true });
        return;
      }

      let user: User | null = null;
      if (rawUser) {
        try {
          user = JSON.parse(rawUser) as User;
        } catch {
          user = null; // 손상된 저장값이어도 토큰 복원은 계속 진행한다.
        }
      }
      setHttpAuthToken(token);
      set({ token, user, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));

// http 클라이언트가 401을 받으면 저장된 인증 정보를 정리한다(재로그인 유도) — web client interceptor와 동일 동작.
registerUnauthorizedHandler(() => {
  useAuthStore.getState().logout();
});
```

- [ ] **Step 8: `mobile/src/features/auth/social.ts`**

```ts
/**
 * 간편 로그인(카카오·네이버) — 인앱 브라우저 세션(웹 리다이렉트, 네이티브 SDK 미사용).
 * start URL 을 열고, auth 콜백이 `stockapp[-dev]://auth?code=…` 로 돌려보내면 세션이 닫힌다.
 */
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { exchangeSocialCode, socialStartUrl, type LoginResult, type SocialProvider } from './api';
import { parseAuthReturnUrl } from './return-url';

export type SocialLoginOutcome =
  | { type: 'success'; result: LoginResult }
  | { type: 'cancel' }
  | { type: 'error'; error: string };

/** 앱 변형 — app.config.js 의 스킴과 같은 출처(APP_ENV → extra.appEnv)로 판단해야 복귀 스킴이 맞는다. */
function appVariant(): 'dev' | 'prod' {
  const appEnv: unknown = Constants.expoConfig?.extra?.appEnv ?? 'development';
  return appEnv === 'development' ? 'dev' : 'prod';
}

export async function startSocialLogin(provider: SocialProvider): Promise<SocialLoginOutcome> {
  const returnUrl = Linking.createURL('auth'); // dev build: stockapp-dev://auth, prod: stockapp://auth
  const session = await WebBrowser.openAuthSessionAsync(socialStartUrl(provider, appVariant()), returnUrl);
  if (session.type !== 'success') return { type: 'cancel' }; // cancel·dismiss 등 — 조용히 무시

  const parsed = parseAuthReturnUrl(session.url);
  if (!parsed) return { type: 'error', error: 'provider_failed' };
  if (parsed.type === 'error') {
    return parsed.error === 'cancelled' ? { type: 'cancel' } : { type: 'error', error: parsed.error };
  }
  return { type: 'success', result: await exchangeSocialCode(parsed.code) };
}
```

- [ ] **Step 9: `mobile/src/features/auth/social-button.tsx`**

```tsx
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { SocialProvider } from './api';

const LABELS: Record<SocialProvider, string> = {
  kakao: '카카오로 시작하기',
  naver: '네이버로 시작하기',
};

type Props = {
  provider: SocialProvider;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

/** 간편 로그인 버튼 — 공급자 가이드 색(카카오 #FEE500/검정, 네이버 #03C75A/흰). 토스 버튼과 같은 높이 56·radius. */
export function SocialButton({ provider, onPress, loading = false, disabled = false }: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={LABELS[provider]}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[provider],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}>
      {loading ? (
        <ActivityIndicator color={provider === 'kakao' ? '#191919' : '#ffffff'} />
      ) : (
        <Text style={[styles.label, provider === 'kakao' ? styles.kakaoLabel : styles.naverLabel]}>
          {LABELS[provider]}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  base: {
    height: 56,
    borderRadius: theme.radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: theme.gap(2),
  },
  kakao: { backgroundColor: '#FEE500' },
  naver: { backgroundColor: '#03C75A' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16, fontWeight: '700' },
  kakaoLabel: { color: '#191919' },
  naverLabel: { color: '#ffffff' },
}));
```

- [ ] **Step 10: `mobile/src/app/+native-intent.tsx`**

```tsx
/**
 * 시스템 딥링크 재작성(expo-router NativeIntent).
 * 간편 로그인 복귀 링크(stockapp[-dev]://auth?code=…)는 openAuthSessionAsync 가 직접 받는다.
 * Android 에서는 같은 링크가 라우터에도 전달돼 없는 /auth 화면(Unmatched)으로 가므로 라우팅에서 제외한다.
 */
import { isAuthReturnUrl } from '@/features/auth/return-url';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    if (isAuthReturnUrl(path)) return initial ? '/profile' : null; // null = 현재 화면 유지
    return path;
  } catch {
    return path;
  }
}
```

- [ ] **Step 11: `mobile/src/app/(tabs)/profile.tsx`** — 전체 교체(로그인 상태 화면은 그대로, 비로그인 화면만 소셜 버튼 + 개발용 게스트 폼):

```tsx
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { getSocialProviders, type SocialProvider, type SocialProviders } from '@/features/auth/api';
import { socialErrorMessage } from '@/features/auth/return-url';
import { startSocialLogin } from '@/features/auth/social';
import { SocialButton } from '@/features/auth/social-button';
import { useAuthStore } from '@/features/auth/store';
import { ENV } from '@/lib/env';
import { Button, Card, ListRow } from '@/ui';

const SOCIAL_PROVIDERS: SocialProvider[] = ['kakao', 'naver'];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const loginWithToken = useAuthStore((s) => s.loginWithToken);
  const logout = useAuthStore((s) => s.logout);

  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<SocialProviders | null>(null);
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
  const [socialError, setSocialError] = useState('');

  // 비로그인일 때 간편 로그인 공급자 활성 여부 조회(키 미설정 공급자는 버튼 숨김)
  useEffect(() => {
    if (user) return;
    let alive = true;
    getSocialProviders()
      .then((p) => {
        if (alive) setProviders(p);
      })
      .catch(() => {
        if (alive) setProviders({ kakao: false, naver: false });
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const handleSocialLogin = async (provider: SocialProvider) => {
    setPendingProvider(provider);
    setSocialError('');
    try {
      const outcome = await startSocialLogin(provider);
      if (outcome.type === 'success') loginWithToken(outcome.result);
      else if (outcome.type === 'error') setSocialError(socialErrorMessage(outcome.error));
      // cancel(사용자가 닫음·취소)은 조용히 무시
    } catch {
      setSocialError('로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPendingProvider(null);
    }
  };

  const handleLogin = async () => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError('닉네임을 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await login(trimmed);
      setNickname('');
    } catch {
      setError('로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const visibleProviders = SOCIAL_PROVIDERS.filter((p) => providers?.[p] === true);

  if (user) {
    return (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.screenTitle}>내정보</Text>
        <Card>
          <Text style={styles.nickname}>{user.nickname}</Text>
          <Text style={styles.role}>{user.role} 등급</Text>
        </Card>

        <Card style={styles.rankCard}>
          <Text style={styles.rankLabel}>🏆 이번 시즌 내 순위</Text>
          <Text style={styles.rankHint}>시즌이 시작되면 순위가 표시돼요</Text>
        </Card>

        <View style={styles.group}>
          <ListRow title="Streak 출석" subtitle="준비 중" left={<Text style={styles.emoji}>🔥</Text>} disabled />
          <ListRow title="Trading MBTI" subtitle="준비 중" left={<Text style={styles.emoji}>🧬</Text>} disabled />
          <ListRow title="아카데미 (5x 해금)" subtitle="준비 중" left={<Text style={styles.emoji}>🎓</Text>} disabled />
          <ListRow title="지난 시즌 기록" subtitle="준비 중" left={<Text style={styles.emoji}>📜</Text>} disabled />
        </View>

        <Button label="로그아웃" variant="secondary" onPress={logout} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.screenTitle}>내정보</Text>
      <Text style={styles.subtitle}>간편 로그인으로 시작해 보세요.</Text>
      {visibleProviders.map((p) => (
        <SocialButton
          key={p}
          provider={p}
          loading={pendingProvider === p}
          disabled={pendingProvider !== null}
          onPress={() => handleSocialLogin(p)}
        />
      ))}
      {providers && visibleProviders.length === 0 && !ENV.enableGuestLogin ? (
        <Text style={styles.subtitle}>로그인을 준비하고 있어요.</Text>
      ) : null}
      {socialError ? <Text style={styles.error}>{socialError}</Text> : null}

      {ENV.enableGuestLogin ? (
        <View style={styles.guest}>
          <Text style={styles.guestLabel}>개발용 닉네임 로그인</Text>
          <TextInput
            style={styles.input}
            placeholder="닉네임"
            placeholderTextColor={theme.colors.textSecondary}
            value={nickname}
            onChangeText={setNickname}
            editable={!submitting}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleLogin}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="시작하기" loading={submitting} onPress={handleLogin} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.gap(2.5), gap: theme.gap(1.5) },
  screenTitle: { fontSize: 24, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: 14, color: theme.colors.textSecondary },
  nickname: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  role: { fontSize: 13, color: theme.colors.textSecondary },
  rankCard: { backgroundColor: theme.colors.primarySoft },
  rankLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  rankHint: { fontSize: 13, color: theme.colors.textSecondary },
  group: { gap: 0 },
  emoji: { fontSize: 18 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingVertical: theme.gap(1.5),
    paddingHorizontal: theme.gap(2),
    fontSize: 16,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  error: { fontSize: 13, color: theme.colors.up },
  guest: {
    gap: theme.gap(1.5),
    marginTop: theme.gap(1.5),
    paddingTop: theme.gap(2),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  guestLabel: { fontSize: 13, color: theme.colors.textSecondary },
}));
```

- [ ] **Step 12: 검증**

```bash
cd mobile
npx tsc --noEmit
npx jest                                   # 기대: 72 passed (기존 63 + 9)
APP_ENV=development npx expo config --type public --json | grep '"scheme"'   # "stockapp-dev"
APP_ENV=production  npx expo config --type public --json | grep '"scheme"'   # "stockapp"
```

- [ ] **Step 13: 커밋**

```bash
git add mobile/app.config.js mobile/src/lib/env.ts mobile/src/features/auth/return-url.ts mobile/src/features/auth/return-url.test.ts mobile/src/features/auth/api.ts mobile/src/features/auth/store.ts mobile/src/features/auth/social.ts mobile/src/features/auth/social-button.tsx "mobile/src/app/+native-intent.tsx" "mobile/src/app/(tabs)/profile.tsx"
git commit -m "feat(mobile): 간편 로그인 — 카카오·네이버 인앱 브라우저 세션(openAuthSessionAsync)·복귀 URL 파서(jest)·dev 스킴 stockapp-dev·개발용 게스트 폼 플래그

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 8: 배포 인자 + 환경변수 키 + 문서

**Files:** Modify `web_client/Dockerfile`, `docker-compose.prod.yml`, `backend/.env.example`, `mobile/.env.example`, `README.md`, `docs/ROADMAP.md`

- [ ] **Step 1: `web_client/Dockerfile`** — `ARG VITE_STOCK_API_URL` 줄부터 `ENV ...` 블록 끝(`VITE_STOCK_API_URL=$VITE_STOCK_API_URL`)까지를 아래로 교체(ARG 1개 + ENV 1줄 추가):

```dockerfile
ARG VITE_STOCK_API_URL
# 닉네임(게스트) 로그인 노출(선택): 'true' 면 표시. 비우면 배포 빌드는 숨김
ARG VITE_ENABLE_GUEST_LOGIN
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_AUTH_BASE_URL=$VITE_AUTH_BASE_URL \
    VITE_GAME_API_URL=$VITE_GAME_API_URL \
    VITE_STOCK_API_URL=$VITE_STOCK_API_URL \
    VITE_ENABLE_GUEST_LOGIN=$VITE_ENABLE_GUEST_LOGIN
```

- [ ] **Step 2: `docker-compose.prod.yml`** — `web_client.build.args` 의 `VITE_STOCK_API_URL: https://api.haezean.com/graphql` 다음 줄에 추가(admin_web 은 건드리지 않음):

```yaml
        # 개발 서버 테스트용 게스트 로그인 노출 — product 도입 시 "false"
        VITE_ENABLE_GUEST_LOGIN: "true"
```

- [ ] **Step 3: `backend/.env.example`** — `# --- 관리자 시드 계정 ---` 블록 **위**에 추가(키 이름만, 값 비움 — 비우면 코드 기본값):

```dotenv
# --- 간편 로그인(카카오·네이버) — 키를 비우면 해당 버튼이 숨겨짐 ---
# 카카오: developers.kakao.com > 앱 > REST API 키 / (보안 > Client Secret 사용 시) 시크릿
KAKAO_REST_API_KEY=
KAKAO_CLIENT_SECRET=
# 네이버: developers.naver.com > 애플리케이션 > Client ID / Client Secret
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
# state 서명 키(미설정 시 JWT_SECRET_KEY 폴백 — 운영은 별도 값 권장)
SOCIAL_STATE_SECRET=
# 공급자 콘솔 Redirect URI = {SOCIAL_REDIRECT_BASE}/{kakao|naver}/callback (기본 http://localhost:8001/api/v1/auth/social)
SOCIAL_REDIRECT_BASE=
# 로그인 후 복귀 주소(기본 http://localhost:3000/auth/complete · stockapp://auth · stockapp-dev://auth)
SOCIAL_WEB_RETURN_URL=
SOCIAL_APP_RETURN_URL_PROD=
SOCIAL_APP_RETURN_URL_DEV=
# true 면 실제 공급자 대신 가짜 공급자(로컬 스모크용). APP_ENV=production 에서는 무시
SOCIAL_FAKE_PROVIDER=
```

- [ ] **Step 4: `mobile/.env.example`** — 파일 끝에 추가:

```dotenv
# 닉네임(게스트) 로그인 노출 — 개발용. 'true'/'false', 미설정이면 production 이 아닐 때만 노출
EXPO_PUBLIC_ENABLE_GUEST_LOGIN=
```

- [ ] **Step 5: README** — 아래 6곳을 수정한다.

(a) `### 4. 일반 유저 웹 (web_client)` 섹션의 인용문 `> 임시 로그인은 auth 서비스의 ...교체 예정. 댓글 작성 테스트에는 auth(8001)도 함께 띄워야 합니다.` 를 교체:

```markdown
> 로그인은 **카카오·네이버 간편 로그인**(auth 서비스, 아래 "간편 로그인" 참조). 닉네임 게스트 로그인(`POST /api/v1/auth/guest`)은 **개발용** — `VITE_ENABLE_GUEST_LOGIN`(미설정 시 dev serve 만 노출, 배포 빌드 숨김). 댓글 작성 테스트에는 auth(8001)도 함께 띄워야 합니다.
```

(b) 같은 섹션 목록 끝(게임 모달(6b) 항목 다음)에 추가:

```markdown
- **간편 로그인(카카오·네이버)**: 로그인 모달 버튼 → auth `GET /api/v1/auth/social/{kakao|naver}/start?client=web` → 공급자 → auth 콜백 → `/auth/complete?code=…` → `POST /api/v1/auth/social/exchange` 로 JWT 저장 후 원래 페이지로 복귀. 키가 없는 공급자 버튼은 숨김(`GET /api/v1/auth/social/providers`). 키 없이 로컬에서 흐름을 보려면 auth 를 `SOCIAL_FAKE_PROVIDER=true` 로 띄운다(공급자 대신 "테스트유저" 로그인, `APP_ENV=production` 에선 무시). 콜백·교환 코드는 Redis 를 쓰므로 Redis(도커)도 필요.
```

(c) `### 5. 모바일 앱` 의 `- **게스트 로그인**: ...` 항목을 교체:

```markdown
- **로그인(카카오·네이버)**: 내정보 탭 버튼 → `expo-web-browser` `openAuthSessionAsync`(인앱 브라우저, 네이티브 SDK 미사용) → auth 콜백이 `stockapp://auth?code=…`(dev 빌드는 `stockapp-dev://auth`)로 복귀 → `POST /auth/social/exchange` → 토큰은 `expo-secure-store`, `src/lib/api`가 Bearer 자동 부착 + 401 시 정리(`src/features/auth`). 닉네임 게스트 로그인은 **개발용** — `EXPO_PUBLIC_ENABLE_GUEST_LOGIN`(미설정 시 production 이 아닐 때만 노출).
  - ⚠️ **dev 앱 스킴이 `stockapp` → `stockapp-dev` 로 바뀌었다**(prod 와 같은 기기 공존 시 복귀 링크 충돌 방지). 기존 dev build 는 **1회 재생성** 필요: `npm run prebuild:dev` 후 `npm run android:dev`/`ios:dev`(또는 EAS dev 빌드). Expo Go 는 Unistyles 로 원래 미지원.
  - 에뮬레이터는 auth 콜백이 브라우저에서 열리므로 `adb reverse tcp:8001 tcp:8001` 이 필요하다(기존 목록에 포함).
```

(d) `### 3. 기능별 "무엇을 띄워야 하나"` 표의 `| 유저 웹 임시 로그인 + 댓글 작성 | 위 + auth(8001) |` 행을 교체:

```markdown
| 유저 웹 로그인(카카오·네이버/개발용 게스트) + 댓글 작성 | 위 + auth(8001) + Redis(도커, 간편 로그인 state·교환 코드). 키 없이 보려면 auth 를 `SOCIAL_FAKE_PROVIDER=true` 로 |
```

(e) `## ⚙️ 주요 환경변수` 표의 `JWT_SECRET_KEY` 행 다음에 추가하고, `VITE_AUTH_BASE_URL | web_client` 행의 설명 `인증 API — 임시 로그인(닉네임)` 을 `인증 API — 간편 로그인·개발용 게스트 로그인` 으로 바꾸고 그 아래에 web·mobile 플래그 행 추가:

```markdown
| `KAKAO_REST_API_KEY` / `KAKAO_CLIENT_SECRET` | auth | (빈값) | 카카오 로그인 키(시크릿은 콘솔에서 사용 설정 시만). 비면 카카오 버튼 숨김 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | auth | (빈값) | 네이버 로그인 키. 비면 네이버 버튼 숨김 |
| `SOCIAL_STATE_SECRET` | auth | (JWT_SECRET_KEY 폴백) | OAuth state 서명 키 — 운영은 별도 값(미설정 시 기동 경고) |
| `SOCIAL_REDIRECT_BASE` | auth | `http://localhost:8001/api/v1/auth/social` | 공급자 Redirect URI 앞부분(`/{kakao\|naver}/callback`). 개발 서버: `https://auth.haezean.com/api/v1/auth/social` |
| `SOCIAL_WEB_RETURN_URL` | auth | `http://localhost:3000/auth/complete` | 웹 복귀 주소. 개발 서버: `https://app.haezean.com/auth/complete` |
| `SOCIAL_APP_RETURN_URL_PROD` / `_DEV` | auth | `stockapp://auth` / `stockapp-dev://auth` | 앱 복귀 딥링크(앱 변형별) |
| `SOCIAL_FAKE_PROVIDER` | auth | `false` | `true` 면 가짜 공급자(로컬 스모크). `APP_ENV=production` 에서는 무시 + 기동 경고 |
```

```markdown
| `VITE_ENABLE_GUEST_LOGIN` | web_client (선택) | dev serve 만 노출 | 닉네임 게스트 로그인 노출(`true`/`false`). 개발 서버 빌드는 `"true"`(테스트용), product 는 `false` |
| `EXPO_PUBLIC_ENABLE_GUEST_LOGIN` | mobile (선택) | production 이 아닐 때 노출 | 닉네임 게스트 로그인 노출(`true`/`false`) |
```

(f) `## 🚀 배포` 섹션의 `- ⚠️ 최초 배포 후 **스키마 부트스트랩 1회** ...` 항목 다음에 추가:

```markdown
- **간편 로그인 배포 체크**: 서버 `backend/.env.production` 에 `KAKAO_REST_API_KEY`(+`KAKAO_CLIENT_SECRET`)·`NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`·`SOCIAL_STATE_SECRET`·`SOCIAL_REDIRECT_BASE=https://auth.haezean.com/api/v1/auth/social`·`SOCIAL_WEB_RETURN_URL=https://app.haezean.com/auth/complete` 설정(파일은 gitignore — 여기가 유일한 기록). 공급자 콘솔에 등록할 **Redirect URI**:
  - 로컬: `http://localhost:8001/api/v1/auth/social/kakao/callback`, `http://localhost:8001/api/v1/auth/social/naver/callback`
  - 개발 서버: `https://auth.haezean.com/api/v1/auth/social/kakao/callback`, `https://auth.haezean.com/api/v1/auth/social/naver/callback`
  - 카카오는 플랫폼 > Web 사이트 도메인(`http://localhost:3000`, `https://app.haezean.com`)도 등록, 동의항목에서 **닉네임** 활성화. 네이버는 서비스 URL·Callback URL 등록, 제공 정보에 **별명** 선택 — **검수 전에는 등록한 테스트 계정만** 로그인 가능.
  - 앱 복귀는 커스텀 스킴(`stockapp://auth`)이라 공급자 콘솔 등록 대상이 아니다(공급자는 항상 auth 콜백으로 돌아오고, auth 가 앱으로 302).
```

- [ ] **Step 6: ROADMAP** — `### Phase 3 — web_client 확장` 의 `- [ ] 소셜 로그인(카카오/구글) 실연동 → 임시 로그인 대체 ...` 줄을 교체:

```markdown
- [x] 간편 로그인(카카오·네이버) — auth 백엔드 콜백 + 일회용 교환 코드, web 버튼·`/auth/complete`, 모바일 인앱 브라우저 세션(dev 스킴 `stockapp-dev`), 게스트 로그인은 개발용 플래그(2026-10-13). 실 공급자 키 발급 후 수동 확인 필요(네이버 검수 전 테스트 계정)
- [ ] 애플 로그인(iOS 출시 직전) · 게스트→소셜 계정 이관 · 회원 탈퇴
```

- [ ] **Step 7: 커밋**

```bash
git add web_client/Dockerfile docker-compose.prod.yml backend/.env.example mobile/.env.example README.md docs/ROADMAP.md
git commit -m "docs: 간편 로그인(카카오·네이버) — README(엔드포인트·환경변수·가짜 모드·Redirect URI·dev 스킴 재빌드)·ROADMAP·env 예시, web 게스트 로그인 빌드 인자

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 9: 마이그레이션 검증 + 가짜 공급자 브라우저 스모크 (컨트롤러 수행)

> 커밋 없음(문제 발견 시 해당 태스크로 돌아가 수정·커밋). **로컬 docker PG(localhost:5432)의 일회용 DB만** 사용 — dev 터널(15432) 금지. `backend/.env.development` 가 터널을 가리켜도 셸 export 가 우선한다(`load_dotenv(override=False)`).

- [ ] **Step 1: 마이그레이션 검증(일회용 DB)**

```bash
cd backend
docker exec stock_postgres psql -U stock_user -d postgres -c "CREATE DATABASE social_mig_tmp"
export ALEMBIC_DATABASE_URL=postgresql+psycopg2://stock_user:stock_password@localhost:5432/social_mig_tmp
uv run alembic upgrade head
docker exec stock_postgres psql -U stock_user -d social_mig_tmp -tc "select enum_range(NULL::auth_provider)"
#   기대: {KAKAO,GOOGLE,APPLE,NAVER}
docker exec stock_postgres psql -U stock_user -d social_mig_tmp -tc "select conname from pg_constraint where conname='uq_users_provider_provider_id'"
#   기대: uq_users_provider_provider_id
docker exec stock_postgres psql -U stock_user -d social_mig_tmp -c "insert into users(email,nickname,role,is_active) values ('a@x','a','FREE',true),('b@x','b','FREE',true)"
#   기대: INSERT 0 2 (provider NULL 끼리 충돌 없음)
docker exec stock_postgres psql -U stock_user -d social_mig_tmp -c "insert into users(nickname,role,is_active,provider,provider_id) values ('n','FREE',true,'NAVER','1'),('n2','FREE',true,'NAVER','1')"
#   기대: ERROR duplicate key value violates unique constraint "uq_users_provider_provider_id"
uv run alembic downgrade -1 && uv run alembic upgrade head   # 기대: 둘 다 성공(ADD VALUE IF NOT EXISTS 재실행 무해)
uv run alembic check                                          # 기대: No new upgrade operations detected.
unset ALEMBIC_DATABASE_URL
docker exec stock_postgres psql -U stock_user -d postgres -c "DROP DATABASE social_mig_tmp"
```

- [ ] **Step 2: 스모크 환경 기동(가짜 공급자 모드)** — 스모크 전용 DB + Redis DB 9:

```bash
cd backend
docker exec stock_postgres psql -U stock_user -d postgres -c "CREATE DATABASE social_smoke"
ALEMBIC_DATABASE_URL=postgresql+psycopg2://stock_user:stock_password@localhost:5432/social_smoke uv run alembic upgrade head
export DATABASE_URL=postgresql+asyncpg://stock_user:stock_password@localhost:5432/social_smoke
export SYNC_DATABASE_URL=postgresql+psycopg2://stock_user:stock_password@localhost:5432/social_smoke
export REDIS_URL=redis://localhost:6379/9
APP_ENV=development SOCIAL_FAKE_PROVIDER=true uv run uvicorn apps.auth.main:app --port 8001   # 터미널 A
uv run uvicorn apps.blog.main:app --port 8000                                                  # 터미널 B(같은 export)
cd ../web_client && npm run dev                                                                # 터미널 C(3000)
```

- [ ] **Step 3: API 스모크(curl)**

```bash
curl -s localhost:8001/api/v1/auth/social/providers                 # {"kakao":true,"naver":true}
curl -si "localhost:8001/api/v1/auth/social/kakao/start?client=web" | grep -i '^location'
#   기대: location: http://localhost:8001/api/v1/auth/social/kakao/callback?code=fake&state=...
curl -si "<위 location>" | grep -i '^location'
#   기대: location: http://localhost:3000/auth/complete?code=...
curl -s -XPOST localhost:8001/api/v1/auth/social/exchange -H 'content-type: application/json' -d '{"code":"<위 code>"}'
#   기대: {"access_token":"…","token_type":"bearer","user":{…,"email":null,"nickname":"테스트유저","role":"FREE"}}
#   같은 code 재요청 → 401
curl -si "localhost:8001/api/v1/auth/social/kakao/start?client=app&app=dev" | grep -i '^location'   # 자기 콜백
#   그 location 을 curl → location: stockapp-dev://auth?code=...
curl -si "localhost:8001/api/v1/auth/social/kakao/callback?code=x&state=forged" | head -1          # HTTP/1.1 400
```

- [ ] **Step 4: 브라우저 스모크(스펙 §6.4)** — `http://localhost:3000`
  1. 게시글 상세(`/posts/<id>`) → 헤더 "로그인" → 모달에 카카오(노랑)·네이버(초록) 버튼 + "개발용 닉네임 로그인" 폼(dev 노출) 확인.
  2. 카카오 클릭 → `/auth/complete` 에서 "로그인 중…" → **원래 게시글 상세로 복귀**, 헤더에 "테스트유저 님". 콘솔에 401 없음(StrictMode 이중 교환 가드 확인).
  3. 로그아웃 → 다시 카카오 로그인 → 같은 계정(`select id, provider, provider_id from users` 행 1개 유지, 네이버로 로그인하면 별도 행).
  4. `http://localhost:3000/auth/complete?error=cancelled` → "로그인을 취소했어요" + 홈으로 / `?error=provider_failed` → "로그인하지 못했어요" / 파라미터 없음 → "잘못된 접근".
  5. 게스트 폼으로 닉네임 로그인 → 기존과 동일 동작(회귀).
  6. auth 를 `SOCIAL_FAKE_PROVIDER` 없이 재기동 → 모달에 버튼 없음 + 게스트 폼만(dev). 
- [ ] **Step 5: 모바일(선택, 기기/에뮬레이터 있을 때)** — `npm run prebuild:dev` 후 dev build 재설치(스킴 변경), `adb reverse tcp:8001 tcp:8001`(+8000/8002/8082), auth 가짜 모드로 내정보 탭 → 카카오 → 인앱 브라우저가 열렸다 자동으로 닫히고 로그인 상태(Android 에서 "Unmatched route" 화면이 뜨지 않는지 확인). 브라우저 닫기 → 조용히 무시.
- [ ] **Step 6: 정리** — 서비스 종료, `docker exec stock_postgres psql -U stock_user -d postgres -c "DROP DATABASE social_smoke"`, `docker exec stock_redis redis-cli -n 9 flushdb`, 셸 export 해제.
- [ ] **Step 7: 실 공급자(사용자 키 발급 후, 수동)** — Task 8 README 의 Redirect URI 를 콘솔에 등록하고 `.env.development` 에 키 입력 → 가짜 모드 끄고 카카오·네이버 각각 신규 로그인/재로그인/취소 확인(네이버는 검수 전 테스트 계정).

---

## 스펙 대비 셀프 리뷰

| 스펙 | 반영 |
|---|---|
| §2 흐름(start/callback/exchange, state 10분·nonce SET NX·교환 코드 60초 GETDEL) | Task 2(state·store) · Task 4(router·service) |
| §2 복귀 주소 서버 선택(web / app-dev / app-prod), 모르면 400 HTML | `SocialSettings.return_url` · `_state_error_page` · `test_return_url_by_client`·`test_invalid_state_returns_400_html_without_redirect` |
| §2 오류 코드 cancelled·provider_failed·inactive·state_invalid | Task 4 판정 순서 + 테스트 각 1개 이상 |
| §3.1 NAVER enum·(provider, provider_id) 유니크, email/password NULL·FREE·닉네임 정규화·social_token 미저장·재로그인 닉네임 유지·이메일 병합 없음 | Task 1 · `find_or_create_user` · `test_callback_creates_user...`·`test_relogin...`·`test_nickname_fallback...` |
| §3.2 모듈 구조(config/state/store/providers/service + routers/social) | Task 2~4 동일 경로 |
| §3.2 공급자 API·5초 타임아웃·ProviderError | Task 3 (MockTransport 로 요청 폼·헤더까지 검증) |
| §3.2 가짜 공급자 모드(운영 무시 + 기동 경고), 키 미설정 503 `PROVIDER_DISABLED`, providers 엔드포인트 | `SocialSettings.fake_mode`·`startup_warnings`·Task 4 테스트 |
| §3.3 환경변수 · `.env.example` 키 이름만 | Task 2 `load_social_settings` · Task 8 |
| §4 web(api 3함수·loginWithToken·LoginModal 버튼/플래그·sessionStorage 복귀·/auth/complete·config·vite-env·Dockerfile/compose 인자) | Task 5·6·8 |
| §5 모바일(스킴 분리·api·social.ts·parseAuthReturnUrl jest·loginWithToken·내정보 버튼·enableGuestLogin·cancel 무시/error 문구) | Task 7 |
| §6 검증(pytest TDD·기존 228 회귀 없음·web tsc/build/localhost·mobile tsc/jest·브라우저 스모크·실 공급자 수동) | 각 태스크 검증 + Task 9 |
| §7 문서(README auth·Redirect URI·dev 스킴 재빌드, env 예시, ROADMAP) | Task 8 |

**스펙에서 열려 있던 부분의 결정**
- 테스트 파일을 스펙의 `test_social_login.py` 하나 대신 태스크별 4개(models·core·providers·login)로 나눴다 — TDD 단계마다 독립 실행·실패 확인이 가능하도록. API 통합 테스트는 `test_social_login.py`.
- 공급자 `error` 매핑: `access_denied` → `cancelled`, 그 외 → `provider_failed`.
- 알 수 없는 공급자·`client` 누락은 422(FastAPI `Literal` 검증). `app` 기본 `prod`, `client=web` 이면 무시.
- 가짜 모드는 실키보다 우선(비운영에서만). state JWT 에 `typ=social_state` 를 넣어 access token 과 혼용 불가(state 키가 JWT 키로 폴백해도 안전).
- `exchange`: 없는/재사용 코드 401, 사용자 없음 401, 비활성 403(기존 `/login` 과 동일 문구).
- 동시 첫 로그인 경합: 유니크 위반(IntegrityError) 시 롤백 후 재조회.
- web 복귀 경로는 내부 경로만(`/` 시작, `//`·`/\`·`/auth/complete` 금지) — 오픈 리다이렉트 방지. 교환 실패(만료) 403 → inactive 문구, 그 외 → 만료 문구.
- 카카오·네이버 고정색은 Tailwind 토큰(`kakao`/`naver`)으로 추가(임의값 클래스 대신).
- 모바일 `app=dev|prod` 는 `Constants.expoConfig.extra.appEnv`(스킴과 같은 출처). Android 복귀 링크의 Unmatched 라우팅은 `+native-intent.tsx` 로 차단.

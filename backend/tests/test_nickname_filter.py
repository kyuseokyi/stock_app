"""닉네임 금칙어(R2) — 판정, 소셜 가입·게스트·심사 계정 생성 시 기본값(유저####)으로 치환.

설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §3
"""
from __future__ import annotations

import re

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth import seed_reviewer
from apps.auth.main import app as auth_app
from apps.auth.social.providers import ProviderProfile
from apps.auth.social.service import find_or_create_user, normalize_nickname
from shared.database import get_db
from shared.models import AuthProvider, Base, User
from shared.nickname_filter import default_nickname, is_blocked_nickname, safe_nickname

DEFAULT_RE = re.compile(r"유저\d{4}")


# ── 판정 ──────────────────────────────────────────────


@pytest.mark.parametrize("name", [
    "관리자", "운영자", "admin", "ADMIN", "Admin_01", "a d m i n", "FunNote", "funnote공식", "fun-note",
    "펀노트", "진짜관리자임", "운 영 자", "씨발", "시1발", "ㅅㅂ", "병신", "개새끼", "섹스", "ａｄｍｉｎ",
])
def test_blocked(name):
    assert is_blocked_nickname(name) is True


@pytest.mark.parametrize("name", ["주린이", "개미투자자", "단타왕", "Kim", "유저1234", "삼성전자러버", "", "   "])
def test_allowed(name):
    assert is_blocked_nickname(name) is False


def test_default_and_safe_nickname():
    assert DEFAULT_RE.fullmatch(default_nickname())
    assert safe_nickname("  주린이 ") == "주린이"
    assert DEFAULT_RE.fullmatch(safe_nickname("운영자"))
    assert DEFAULT_RE.fullmatch(safe_nickname(None))
    assert DEFAULT_RE.fullmatch(safe_nickname("   "))


def test_social_normalize_nickname_replaces_blocked():
    assert DEFAULT_RE.fullmatch(normalize_nickname("FunNote 운영팀"))
    assert normalize_nickname("  닉  ") == "닉"  # 기존 규칙 유지


# ── DB 경로 ───────────────────────────────────────────


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def test_social_signup_blocked_nickname_replaced(maker):
    async with maker() as db:
        user = await find_or_create_user(db, AuthProvider.KAKAO, ProviderProfile(id="k1", nickname="관리자"))
        assert DEFAULT_RE.fullmatch(user.nickname)


async def test_social_existing_user_nickname_untouched(maker):
    """기존 사용자는 로그인마다 닉네임을 덮어쓰지 않는다(기존 동작) — 관리자가 바꾼 닉네임도 유지."""
    async with maker() as db:
        db.add(User(provider=AuthProvider.NAVER, provider_id="n1", nickname="원래닉", is_active=True))
        await db.commit()
    async with maker() as db:
        user = await find_or_create_user(db, AuthProvider.NAVER, ProviderProfile(id="n1", nickname="운영자"))
        assert user.nickname == "원래닉"


@pytest.fixture
async def auth_client(maker, monkeypatch):
    monkeypatch.setenv("AUTH_GUEST_ENABLED", "true")

    async def _db():
        async with maker() as s:
            yield s

    auth_app.dependency_overrides[get_db] = _db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=auth_app), base_url="http://test") as c:
        yield c
    auth_app.dependency_overrides.clear()


async def test_guest_blocked_nickname_replaced_and_stable(auth_client, maker):
    r = await auth_client.post("/api/v1/auth/guest", json={"nickname": "운영자", "platform": "app"})
    assert r.status_code == 200, r.text
    first = r.json()["user"]["nickname"]
    assert DEFAULT_RE.fullmatch(first)
    # 같은 닉네임으로 다시 로그인 — 같은 계정(이메일은 요청 원문 기준), 닉네임이 매번 바뀌지 않는다
    r2 = await auth_client.post("/api/v1/auth/guest", json={"nickname": "운영자", "platform": "app"})
    assert r2.json()["user"]["id"] == r.json()["user"]["id"]
    assert r2.json()["user"]["nickname"] == first
    async with maker() as db:
        assert len((await db.execute(select(User))).scalars().all()) == 1


async def test_guest_normal_nickname_kept(auth_client):
    r = await auth_client.post("/api/v1/auth/guest", json={"nickname": "주린이", "platform": "app"})
    assert r.json()["user"]["nickname"] == "주린이"


async def test_reviewer_seed_nickname_is_safe(maker):
    await seed_reviewer.seed("reviewer@test.local", "x" * 12, session_factory=maker)
    async with maker() as db:
        u = (await db.execute(select(User).where(User.email == "reviewer@test.local"))).scalar_one()
        assert u.nickname == "App Review" and not is_blocked_nickname(u.nickname)


def test_every_blocked_word_survives_normalization():
    """정규화 뒤 빈 문자열이 되는 금칙어가 있으면 모든 닉네임이 걸린다(자모 정규화 회귀 방지)."""
    from shared import nickname_filter as nf

    assert len(nf._NORMALIZED_WORDS) == len(nf.BLOCKED_WORDS)
    assert all(nf.is_blocked_nickname(w) for w in nf.BLOCKED_WORDS)

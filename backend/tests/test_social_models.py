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

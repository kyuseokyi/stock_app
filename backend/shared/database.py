"""공유 비동기 DB 세션 (PostgreSQL / SQLAlchemy async).

FastAPI 앱들이 공통으로 사용하는 async 엔진과 세션 팩토리, 그리고
요청 스코프 세션을 제공하는 `get_db` 의존성을 정의한다.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# 로컬 기본값은 docker-compose.dev.yml 의 Postgres 를 가리킨다.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_db",
)

engine = create_async_engine(DATABASE_URL, echo=False, future=True)
AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """요청 단위 DB 세션 의존성."""
    async with AsyncSessionLocal() as session:
        yield session

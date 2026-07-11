"""공유 비동기 DB 세션 (PostgreSQL / SQLAlchemy async).

FastAPI 앱들이 공통으로 사용하는 async 엔진과 세션 팩토리, 그리고
요청 스코프 세션을 제공하는 `get_db` 의존성을 정의한다.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session, sessionmaker

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
    """요청 단위 DB 세션 의존성 (FastAPI async)."""
    async with AsyncSessionLocal() as session:
        yield session


# --- 동기 세션 (Celery 워커용) ------------------------------------------------ #
# Celery 태스크는 동기 실행 컨텍스트이므로 psycopg2 기반 동기 엔진을 사용한다.
SYNC_DATABASE_URL = os.getenv(
    "SYNC_DATABASE_URL",
    "postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_db",
)

sync_engine = create_engine(SYNC_DATABASE_URL, echo=False, future=True)
SyncSessionLocal = sessionmaker(
    sync_engine, class_=Session, expire_on_commit=False
)

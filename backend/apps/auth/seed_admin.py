"""관리자 시드 스크립트 (인증 서버).

기본 관리자 계정을 멱등하게 생성/갱신한다.

실행:
    cd backend
    uv run python -m apps.auth.seed_admin
환경변수 오버라이드:
    ADMIN_EMAIL (기본 admin@stock.app), ADMIN_PASSWORD (기본 admin1234)
"""

from __future__ import annotations

import asyncio
import os

from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.models import User, UserRole
from shared.security import hash_password

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@stock.app")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin1234")


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == ADMIN_EMAIL))
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                email=ADMIN_EMAIL,
                nickname="관리자",
                role=UserRole.ADMIN,
                is_active=True,
                password_hash=hash_password(ADMIN_PASSWORD),
            )
            db.add(user)
            action = "created"
        else:
            user.role = UserRole.ADMIN
            user.is_active = True
            user.password_hash = hash_password(ADMIN_PASSWORD)
            action = "updated"

        await db.commit()
        print(f"[seed_admin] {action}: {ADMIN_EMAIL} (password={ADMIN_PASSWORD})")


if __name__ == "__main__":
    asyncio.run(seed())

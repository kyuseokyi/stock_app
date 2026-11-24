"""슈퍼 관리자 시드 스크립트 (인증 서버).

슈퍼 관리자 계정을 멱등하게 만든다. 다른 관리자는 이 계정으로 어드민 '관리자 계정' 화면에서 만든다.

실행:
    cd backend
    uv run python -m apps.auth.seed_admin
환경변수:
    ADMIN_EMAIL (기본 admin@stock.app), ADMIN_PASSWORD (기본 admin1234 — 처음 만들 때만 쓴다)
    ADMIN_RESET_PASSWORD=1 이면 이미 있는 계정의 비밀번호도 ADMIN_PASSWORD 로 다시 맞춘다(잊었을 때).

이미 있는 계정은 역할·활성·슈퍼 관리자 표시만 맞추고 비밀번호는 건드리지 않는다 — 어드민에서 바꾼 비밀번호가
시드 재실행으로 기본값으로 돌아가지 않게. 비밀번호는 화면에 찍지 않는다.
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


async def seed(*, session_factory=AsyncSessionLocal, reset_password: bool | None = None) -> str:
    if reset_password is None:
        reset_password = os.getenv("ADMIN_RESET_PASSWORD") == "1"
    async with session_factory() as db:
        result = await db.execute(select(User).where(User.email == ADMIN_EMAIL))
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                email=ADMIN_EMAIL,
                nickname="관리자",
                role=UserRole.ADMIN,
                is_active=True,
                is_super_admin=True,
                password_hash=hash_password(ADMIN_PASSWORD),
            )
            db.add(user)
            action = "생성"
        else:
            user.role = UserRole.ADMIN
            user.is_active = True
            user.is_super_admin = True
            if reset_password:
                user.password_hash = hash_password(ADMIN_PASSWORD)
            action = "비밀번호 재설정" if reset_password else "갱신(비밀번호 유지)"

        await db.commit()
        print(f"[seed_admin] {action}: {ADMIN_EMAIL} (슈퍼 관리자)")
        return action


if __name__ == "__main__":
    asyncio.run(seed())

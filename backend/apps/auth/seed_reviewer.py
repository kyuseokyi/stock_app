"""스토어 심사 전용 계정 시드 (인증 서버).

심사용 일반 회원(FREE, 닉네임 'App Review', 소셜 공급자 없음)을 만들거나, 이미 있으면 비밀번호만 갱신한다.
로그인은 POST /api/v1/auth/review-login 으로만 한다(REVIEW_LOGIN_EMAILS 에 이 이메일이 있어야 함).

실행:
    cd backend
    REVIEW_EMAIL=... REVIEW_PASSWORD=... uv run python -m apps.auth.seed_reviewer
환경변수(필수):
    REVIEW_EMAIL, REVIEW_PASSWORD(12자 이상)
출력에 비밀번호를 찍지 않는다.
"""

from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy import select

from shared.models import User, UserRole
from shared.security import hash_password

NICKNAME = "App Review"
MIN_PASSWORD_LEN = 12


def _fail(message: str) -> None:
    print(f"[seed_reviewer] 오류: {message}", file=sys.stderr)
    raise SystemExit(1)


def read_env() -> tuple[str, str]:
    """REVIEW_EMAIL·REVIEW_PASSWORD 를 읽고 검증한다. 문제가 있으면 종료 코드 1(값은 출력하지 않음)."""
    email = (os.getenv("REVIEW_EMAIL") or "").strip()
    password = os.getenv("REVIEW_PASSWORD") or ""
    if not email:
        _fail("REVIEW_EMAIL 이 비어 있습니다.")
    if not password:
        _fail("REVIEW_PASSWORD 가 비어 있습니다.")
    if len(password) < MIN_PASSWORD_LEN:
        _fail(f"REVIEW_PASSWORD 는 {MIN_PASSWORD_LEN}자 이상이어야 합니다.")
    return email, password


async def seed(email: str, password: str, session_factory=None) -> str:
    """심사 계정 생성/갱신 → 'created' | 'updated'. 같은 이메일이 관리자 계정이면 건드리지 않고 종료."""
    if session_factory is None:
        from shared.database import AsyncSessionLocal

        session_factory = AsyncSessionLocal

    async with session_factory() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()

        if user is None:
            user = User(
                email=email,
                nickname=NICKNAME,
                role=UserRole.FREE,
                is_active=True,
                password_hash=hash_password(password),
            )
            db.add(user)
            action = "created"
        elif user.role == UserRole.ADMIN:
            # 관리자 계정을 심사 계정으로 쓰면 안 된다(review-login 은 관리자를 거부) — 비밀번호도 바꾸지 않는다
            _fail("같은 이메일의 관리자 계정이 있습니다. 다른 이메일을 쓰세요.")
        else:
            user.password_hash = hash_password(password)
            action = "updated"

        await db.commit()
        print(f"[seed_reviewer] {action}: {email}")
        return action


def main() -> None:
    email, password = read_env()
    asyncio.run(seed(email, password))


if __name__ == "__main__":
    main()

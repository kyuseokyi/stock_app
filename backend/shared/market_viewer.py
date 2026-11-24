"""시세 열람 '회원' 판정 — stock_api(시세 스위치)와 trading_game(REAL_MARKET 플래그)이 같이 쓰는 규칙.

설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 2-2·2-5

전체 스위치(서비스마다 다름: stock_api=screener_features.MARKET_DATA, trading_game=game_feature_flags.REAL_MARKET)가
꺼져 있을 때, 토큰 사용자가 관리자이거나 시세 열람 권한(users.market_data_access)이 있으면 허용한다.
토큰이 없거나 만료·무효·세션 종료·DB 오류면 '익명'(차단) — 401 을 내지 않는다(공개 화면에 401 이 새면
앱이 리프레시·로그아웃 흐름을 탄다).
"""
from __future__ import annotations

import logging

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from shared import admin_permissions
from shared.auth import get_current_user
from shared.models import User, UserRole

log = logging.getLogger(__name__)

# 국내 지수 공개 스위치(stock_api screener_features.MARKET_INDEX_KR)로 익명·일반 회원에게 열리는 지수 — 코스피·코스닥만.
# 코스피200·미국 지수·원/달러·개별 종목 시세는 이 스위치와 무관하게 계속 막힌다.
KR_PUBLIC_INDEX_CODES: tuple[str, ...] = ("KR:0001", "KR:1001")


def user_can_view(user: User | None) -> bool:
    """스위치가 꺼져 있을 때 이 사용자가 시세를 볼 수 있는가 — 관리자 또는 열람 권한 보유(등급 무시).

    실제 요청 판정은 관리자 등급까지 보는 can_view(비동기)를 쓴다. 이 함수는 등급을 모를 때의 상한선이다.
    """
    if user is None or not user.is_active:
        return False
    return user.role == UserRole.ADMIN or bool(getattr(user, "market_data_access", False))


async def can_view(user: User | None, db: AsyncSession) -> bool:
    """user_can_view + 관리자 등급 반영 — 관리자는 '스크리너 열람'(SCREENER_VIEW) 권한이 있을 때만 스위치를 우회한다.

    슈퍼 관리자·등급 없는 기존 관리자(=OPERATOR)는 이 권한이 있어 지금과 같다. 에디터처럼 권한이 없는 관리자는
    일반 회원과 똑같이 본다(시세 열람 권한 market_data_access 가 있으면 허용).
    """
    if user is None or not user.is_active:
        return False
    if bool(getattr(user, "market_data_access", False)):
        return True
    if user.role != UserRole.ADMIN:
        return False
    try:
        perms = await admin_permissions.permissions_for(db, user)
    except Exception as exc:  # noqa: BLE001 — 닫힘 쪽
        log.warning("시세 열람 판정 중 관리자 권한 조회 실패: %s", type(exc).__name__)
        return False
    return admin_permissions.SCREENER_VIEW in perms


def kr_index_visible(market_allowed: bool, kr_index_switch_on: bool) -> bool:
    """국내 지수(코스피·코스닥)를 이 요청자에게 보여 줄 수 있는가.

    시세 전체를 볼 수 있으면(스위치 ON·관리자·열람 권한) 당연히 보이고, 아니면 '국내 지수 공개' 스위치가 켜졌을 때만.
    지수 전용 판정이다 — 이 값이 참이어도 개별 종목·업종·테마 시세는 market_allowed 로만 연다.
    """
    return bool(market_allowed) or bool(kr_index_switch_on)


async def load_viewer(creds: HTTPAuthorizationCredentials | None, db: AsyncSession) -> User | None:
    """토큰 → 회원(get_current_user 와 같은 JWT·회원·세션 검증). 어떤 실패든 None(익명)."""
    if creds is None:
        return None
    try:
        return await get_current_user(creds, db)
    except HTTPException:
        return None
    except Exception as exc:  # noqa: BLE001 — DB 장애 등은 닫힘 쪽(익명)으로
        log.warning("시세 열람 판정 중 회원 조회 실패: %s", type(exc).__name__)
        return None

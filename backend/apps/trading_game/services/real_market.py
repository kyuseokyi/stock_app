"""실제 시세 게임 열람 판정 — A안(시세 비노출) trading_game 쪽 서버 차단의 단일 기준.

설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 2-5·3-5

허용 = 게임 기능 플래그 REAL_MARKET ON
       또는 토큰 사용자가 관리자
       또는 그 사용자에게 시세 열람 권한(users.market_data_access) — stock_api 와 같은 규칙(shared.market_viewer).

- 플래그 ON 이면 토큰·DB 를 보지 않고 바로 허용(지금과 100% 같은 동작).
- 플래그 행이 없거나 조회 오류면 OFF(feature_flag_service.DEFAULTS·아래 flag_on).
- 토큰은 선택: 없거나 만료·무효면 익명(차단) — 공개 엔드포인트에 새 401 을 만들지 않는다.
- 정산·랭킹·시즌 배치·틱 수신 같은 서버 내부 작업은 이 판정을 쓰지 않는다(운영자 이용, 설계 8절).
"""
from __future__ import annotations

import logging

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from shared import market_viewer
from shared.auth import bearer_scheme, get_current_user
from shared.database import get_db
from shared.models import User
from apps.trading_game import deps
from apps.trading_game.services import feature_flag_service

log = logging.getLogger("trading_game.real_market")

FLAG = "REAL_MARKET"
DISABLED_DETAIL = "market_data_disabled"


async def flag_on(db: AsyncSession, redis) -> bool:
    """REAL_MARKET 플래그. 행 없음 = OFF, 조회 오류 = OFF(닫힘)."""
    try:
        return await feature_flag_service.is_enabled(db, redis, FLAG)
    except Exception as exc:  # noqa: BLE001 — 기본은 닫힘
        log.warning("REAL_MARKET 플래그 조회 실패 — OFF 로 판정: %s", type(exc).__name__)
        try:
            await db.rollback()  # 실패한 트랜잭션이 같은 요청의 다음 쿼리를 막지 않게
        except Exception:  # noqa: BLE001
            pass
        return False


async def allowed_for_user(db: AsyncSession, redis, user: User | None) -> bool:
    """이미 검증된 회원(또는 None=익명) 기준 허용 여부."""
    if await flag_on(db, redis):
        return True
    return market_viewer.user_can_view(user)


async def allowed_for_creds(db: AsyncSession, redis, creds: HTTPAuthorizationCredentials | None) -> bool:
    """선택 토큰 기준 허용 여부 — 토큰 검증 실패는 익명."""
    if await flag_on(db, redis):
        return True
    if creds is None:
        return False
    return market_viewer.user_can_view(await market_viewer.load_viewer(creds, db))


async def real_market_access(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> bool:
    """FastAPI 의존성 — 판정만(막지 않음). 요청당 한 번(request.state 에 보관)."""
    cached = getattr(request.state, "real_market_allowed", None)
    if isinstance(cached, bool):
        return cached
    allowed = await allowed_for_creds(db, deps.get_redis(), creds)
    request.state.real_market_allowed = allowed
    return allowed


async def require_real_market(allowed: bool = Depends(real_market_access)) -> None:
    """공개 시세 REST 차단 — 볼 수 없으면 403 {"detail": "market_data_disabled"}."""
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DISABLED_DETAIL)


async def require_real_market_user(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """로그인 필수 API(주문·청산) 차단 — 인증(401)은 그대로 먼저, 볼 수 없으면 403."""
    if not await allowed_for_user(db, deps.get_redis(), user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, DISABLED_DETAIL)

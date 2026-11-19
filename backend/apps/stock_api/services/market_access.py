"""시세 열람 판정 — A안(시세 비노출) 서버 차단의 단일 기준.

설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 2-1~2-3

can_view = 전체 스위치(screener_features.MARKET_DATA) ON
           또는 토큰 사용자가 관리자(ADMIN)
           또는 그 사용자에게 시세 열람 권한(users.market_data_access)이 있음.

- 스위치 ON 이면 토큰·DB 를 보지 않고 바로 허용(지금과 100% 같은 동작, 새 401 없음).
- 스위치 OFF 면 토큰을 auth 서비스와 같은 방식(shared.auth.get_current_user — JWT 검증·회원·세션 확인)으로 본다.
  토큰이 없거나 만료·무효·세션 종료면 401 대신 '익명'(차단)으로 처리한다 — 공개 화면에 401 이 새면
  앱이 리프레시·로그아웃 흐름을 타 버린다.
- 판정은 요청마다 한 번(request.state 에 보관). REST 는 의존성, GraphQL 은 context_getter 가 같은 함수를 쓴다.
- 기본은 닫힘: 스위치 행이 없거나 조회 실패면 OFF(screener_features.enabled_map 규칙).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials

from apps.stock_api.services import screener_features
from shared import database, market_viewer
from shared.auth import bearer_scheme
from shared.market_viewer import user_can_view  # 회원 판정은 trading_game 과 공유
from shared.models import User

log = logging.getLogger(__name__)

SWITCH_KEY = "MARKET_DATA"
KR_INDEX_SWITCH_KEY = "MARKET_INDEX_KR"  # 국내 지수(코스피·코스닥)만 공개 — 개별 시세는 SWITCH_KEY 로만
DISABLED_DETAIL = "market_data_disabled"
# 토큰 덕분에(스위치 OFF) 열람이 허용된 응답 — 공유 캐시가 익명 사용자에게 되돌려주지 않게
PRIVATE_CACHE_CONTROL = "private, max-age=30"


@dataclass(frozen=True)
class MarketAccess:
    allowed: bool
    public: bool  # 스위치 ON 으로 모두에게 열린 상태(캐시 헤더를 그대로 둬도 되는가)


def market_data_switch_on() -> bool:
    """전체 스위치(동기·30초 캐시). 행 없음·DB 오류 = OFF."""
    return bool(screener_features.enabled_map().get(SWITCH_KEY, False))


def kr_index_switch_on() -> bool:
    """국내 지수 공개 스위치(동기·30초 캐시). 행 없음·DB 오류 = OFF."""
    return bool(screener_features.enabled_map().get(KR_INDEX_SWITCH_KEY, False))


async def load_viewer(creds: HTTPAuthorizationCredentials) -> User | None:
    """토큰 → 회원(shared.market_viewer — trading_game 과 같은 규칙). 어떤 실패든 None(익명)."""
    try:
        async with database.AsyncSessionLocal() as db:
            return await market_viewer.load_viewer(creds, db)
    except Exception as exc:  # noqa: BLE001 — 세션 열기 실패 등은 닫힘 쪽(익명)으로
        log.warning("시세 열람 판정 중 회원 조회 실패: %s", type(exc).__name__)
        return None


async def resolve(request: Request, creds: HTTPAuthorizationCredentials | None) -> MarketAccess:
    cached = getattr(request.state, "market_access", None)
    if isinstance(cached, MarketAccess):
        return cached
    if await run_in_threadpool(market_data_switch_on):
        result = MarketAccess(allowed=True, public=True)
    elif creds is None:
        result = MarketAccess(allowed=False, public=False)
    else:
        result = MarketAccess(allowed=user_can_view(await load_viewer(creds)), public=False)
    request.state.market_access = result
    return result


async def market_access(
    request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> MarketAccess:
    """FastAPI 의존성 — 판정만(막지 않음). GraphQL context 와 REST 가 함께 쓴다."""
    return await resolve(request, creds)


async def can_view_market(request: Request) -> bool:
    """요청 기준 시세 열람 가능 여부(헤더에서 토큰을 직접 읽는다)."""
    return (await resolve(request, await bearer_scheme(request))).allowed


async def require_market_data(access: MarketAccess = Depends(market_access)) -> MarketAccess:
    """REST 차단 의존성 — 볼 수 없으면 403 {"detail": "market_data_disabled"}."""
    if not access.allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DISABLED_DETAIL)
    return access


def cache_control(access: MarketAccess, public_value: str) -> str:
    """스위치 ON(공개)이면 원래 헤더 그대로, 토큰으로 허용된 응답이면 private."""
    return public_value if access.public else PRIVATE_CACHE_CONTROL


def context_allowed(context: object) -> bool:
    """GraphQL 리졸버용 — 라우터가 넣은 판정을 읽는다. context 가 없으면(직접 schema.execute) 스위치만 본다(익명)."""
    if isinstance(context, dict):
        access = context.get("market_access")
        if isinstance(access, MarketAccess):
            return access.allowed
    return market_data_switch_on()


def context_kr_index_allowed(context: object) -> bool:
    """GraphQL 리졸버용(동기 — 스레드풀에서 부른다) — 국내 지수(코스피·코스닥)를 보여 줄 수 있는가.
    시세 전체 열람이 허용되면 스위치를 보지 않는다."""
    if context_allowed(context):
        return True
    return market_viewer.kr_index_visible(False, kr_index_switch_on())

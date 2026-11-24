"""관리자 등급별 권한(RBAC) — 권한 키·등급 기본값·유효 권한 계산.

명세: docs/admin_rbac_permissions_spec_and_plan.md (2026-11-24 지시로 바뀐 점은 문서 0-1 절)

- 슈퍼 관리자(users.is_super_admin)는 항상 모든 권한. 등급 표(admin_tier_policies)와 무관.
- 나머지 관리자는 등급(admin_tier: OPERATOR·ANALYST·EDITOR) 권한 + 개별 추가 권한(custom_permissions).
  등급이 비어 있으면 OPERATOR 로 본다(등급 도입 전 관리자 = 계정 관리만 빼고 전부 — 그때 동작 그대로).
- 등급 표에 행이 없으면 아래 코드 기본값을 쓴다 → 표가 비거나 깨져도 아무도 잠기지 않는다.
- ADMIN_ROLE_MANAGE(관리자 계정·등급 관리)는 슈퍼 관리자 고정 — 어떤 등급·개별 권한으로도 줄 수 없다.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import AdminTierPolicy, User, UserRole

log = logging.getLogger(__name__)

SCREENER_VIEW = "SCREENER_VIEW"
SCREENER_SETTINGS = "SCREENER_SETTINGS"
DATA_PIPELINE = "DATA_PIPELINE"
APP_UPDATE_MANAGE = "APP_UPDATE_MANAGE"
AD_MANAGE = "AD_MANAGE"
CONTENT_MANAGE = "CONTENT_MANAGE"
GAME_MANAGE = "GAME_MANAGE"
ADMIN_ROLE_MANAGE = "ADMIN_ROLE_MANAGE"

# (키, 표시 이름, 설명) — 순서 = 관리자 웹 권한 표 순서
PERMISSIONS: tuple[tuple[str, str, str], ...] = (
    (SCREENER_VIEW, "스크리너 열람", "주도주·정배열·조건검색·차트 패턴·데이터 검증, 시세가 꺼져 있을 때 시세 열람"),
    (SCREENER_SETTINGS, "시세·스크리너 노출 스위치", "스크리너 탭 설정(전체 시세 스위치 포함), 실시간 게임(REAL_MARKET) 켜기·끄기"),
    (DATA_PIPELINE, "데이터 수집·재계산", "데이터 현황의 수집·재계산 실행, 테마 보정"),
    (APP_UPDATE_MANAGE, "앱 버전·점검", "앱 버전 & 업데이트"),
    (AD_MANAGE, "광고 설정", "광고 설정"),
    (CONTENT_MANAGE, "블로그·신고·회원·알림", "게시판·게시글·신고·차트 글 점검·회원 목록(닉네임·댓글 금지)·펀드 알림"),
    (GAME_MANAGE, "트레이딩 게임", "데일리 코치·아카데미·퀴즈·게임 설정·교육 게임"),
    (ADMIN_ROLE_MANAGE, "관리자 계정·등급 관리", "슈퍼 관리자 고정"),
)
ALL_PERMISSIONS: frozenset[str] = frozenset(k for k, _, _ in PERMISSIONS)
GRANTABLE: frozenset[str] = ALL_PERMISSIONS - {ADMIN_ROLE_MANAGE}

SUPER_ADMIN = "SUPER_ADMIN"  # 응답 표시용(저장하지 않음 — 기준은 is_super_admin)
OPERATOR, ANALYST, EDITOR = "OPERATOR", "ANALYST", "EDITOR"
TIERS: tuple[tuple[str, str], ...] = (
    (OPERATOR, "운영 관리자"),
    (ANALYST, "분석·스크리너 관리자"),
    (EDITOR, "콘텐츠 에디터"),
)
TIER_KEYS: frozenset[str] = frozenset(t for t, _ in TIERS)
DEFAULT_TIER = OPERATOR

DEFAULT_POLICIES: dict[str, frozenset[str]] = {
    OPERATOR: GRANTABLE,
    ANALYST: frozenset({SCREENER_VIEW, CONTENT_MANAGE, GAME_MANAGE}),
    EDITOR: frozenset({CONTENT_MANAGE, GAME_MANAGE}),
}


def parse_keys(raw: str | None) -> frozenset[str]:
    """JSON 배열 문자열 → 줄 수 있는 권한 키 집합(모르는 키·ADMIN_ROLE_MANAGE·형식 오류는 버린다)."""
    if not raw:
        return frozenset()
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return frozenset()
    if not isinstance(data, list):
        return frozenset()
    return frozenset(k for k in data if isinstance(k, str) and k in GRANTABLE)


def dump_keys(keys) -> str:
    """권한 키 → 저장용 JSON(PERMISSIONS 순서로 정렬해 diff 가 흔들리지 않게)."""
    order = [k for k, _, _ in PERMISSIONS]
    return json.dumps([k for k in order if k in set(keys)])


def tier_of(user: User) -> str | None:
    """응답·판정용 등급. 관리자가 아니면 None, 슈퍼 관리자는 SUPER_ADMIN, 비었거나 모르는 값은 OPERATOR."""
    if user.role != UserRole.ADMIN:
        return None
    if getattr(user, "is_super_admin", False):
        return SUPER_ADMIN
    tier = getattr(user, "admin_tier", None)
    return tier if tier in TIER_KEYS else DEFAULT_TIER


async def load_policies(db: AsyncSession) -> dict[str, frozenset[str]]:
    """등급 → 권한(표에 있는 행이 코드 기본값을 덮는다). 조회 실패면 기본값."""
    policies = dict(DEFAULT_POLICIES)
    try:
        rows = (await db.execute(select(AdminTierPolicy))).scalars().all()
    except Exception as exc:  # noqa: BLE001 — 표 조회 실패로 관리자 전체가 막히지 않게
        log.warning("관리자 등급 표 조회 실패 — 기본값 사용: %s", type(exc).__name__)
        return policies
    for row in rows:
        if row.tier in TIER_KEYS:
            policies[row.tier] = parse_keys(row.permissions_json)
    return policies


async def permissions_for(db: AsyncSession, user: User | None) -> frozenset[str]:
    """이 사용자의 최종 관리자 권한. 일반 회원·비활성은 빈 집합."""
    if user is None or not user.is_active or user.role != UserRole.ADMIN:
        return frozenset()
    if getattr(user, "is_super_admin", False):
        return ALL_PERMISSIONS
    policies = await load_policies(db)
    return policies.get(tier_of(user), frozenset()) | parse_keys(getattr(user, "custom_permissions", None))


def ordered(perms) -> list[str]:
    """응답용 — PERMISSIONS 순서 리스트."""
    s = set(perms)
    return [k for k, _, _ in PERMISSIONS if k in s]

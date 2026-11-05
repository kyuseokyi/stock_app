"""광고 원격 설정 — 공개 조회·관리자 조회/저장(명세 docs/ad_monetization_spec_and_plan.md §3).

행이 없으면(시드 누락) 기본값으로 응답한다. 기본값은 모두 꺼짐이라 설정을 못 읽어도 광고가 나오지 않는다.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import AdConfig, User

from ..ad_config_schemas import AdConfigIn, AdConfigOut, AdSlotOut, HouseAdOut, PublicAdConfigOut
from ..repositories import ad_config_repo

GLOBAL_WEB = "GLOBAL_WEB"
GLOBAL_MOBILE = "GLOBAL_MOBILE"
GLOBAL_KEYS = (GLOBAL_WEB, GLOBAL_MOBILE)
PROVIDERS = ("GOOGLE", "HOUSE")
INFEED_INTERVAL_MIN = 4
INFEED_INTERVAL_MAX = 50
HOUSE_TITLE_MAX = 120
HOUSE_DESCRIPTION_MAX = 255
HOUSE_PATH_MAX = 255
# 앱 안 경로만 — 외부 주소(https://…, //host, /\host)로 나가는 링크를 막는다
_INTERNAL_PATH = re.compile(r"/(?![/\\])[^\s\\]*")

_GAME = dict(house_title="실시간 차트 트레이딩 게임", house_description="가상 자금으로 실전 감각을 키워보세요.",
             house_target_path="/game")
_NO_HOUSE = dict(house_title=None, house_description=None, house_target_path=None)
# 마이그레이션 a7d1c3e5f902 시드와 같다. 순서 = 관리자 화면 순서
SLOT_DEFAULTS: dict[str, dict] = {
    GLOBAL_WEB: {"infeed_interval": 7, **_NO_HOUSE},
    GLOBAL_MOBILE: {"infeed_interval": 7, **_NO_HOUSE},
    "WEB_HOME_SIDEBAR": {"infeed_interval": 7, **_GAME},
    "WEB_POST_LIST_INFEED": {"infeed_interval": 5, **_GAME},
    "WEB_POST_DETAIL_BOTTOM": {"infeed_interval": 7, **_GAME},
    "WEB_SCREENER_FOOTER": {"infeed_interval": 7, **_GAME},
    "MOB_HOME_FEED_NATIVE": {"infeed_interval": 7, **_GAME},
    "MOB_COMMUNITY_INFEED": {"infeed_interval": 7, **_GAME},
    "MOB_POST_DETAIL_BOTTOM": {"infeed_interval": 7, **_GAME},
}


class AdConfigError(Exception):
    """라우터가 HTTPException(status, {code, message}) 로 바꾼다."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _default_row(slot_key: str) -> AdConfig:
    return AdConfig(slot_key=slot_key, enabled=False, provider="HOUSE", updated_at=None, updated_by=None,
                    **SLOT_DEFAULTS[slot_key])


async def _rows_by_key(db: AsyncSession) -> dict[str, AdConfig]:
    """아는 슬롯만, SLOT_DEFAULTS 순서로. 없는 행은 기본값으로 채운다."""
    rows = {r.slot_key: r for r in await ad_config_repo.list_all(db)}
    return {key: rows.get(key) or _default_row(key) for key in SLOT_DEFAULTS}


async def public_config(db: AsyncSession) -> PublicAdConfigOut:
    rows = await _rows_by_key(db)
    return PublicAdConfigOut(
        web_enabled=rows[GLOBAL_WEB].enabled,
        mobile_enabled=rows[GLOBAL_MOBILE].enabled,
        slots={
            key: AdSlotOut(
                enabled=r.enabled, provider=r.provider, infeed_interval=r.infeed_interval,
                house=HouseAdOut(title=r.house_title, description=r.house_description,
                                 target_path=r.house_target_path),
            )
            for key, r in rows.items() if key not in GLOBAL_KEYS
        },
    )


async def list_configs(db: AsyncSession) -> list[AdConfigOut]:
    return [AdConfigOut.model_validate(r) for r in (await _rows_by_key(db)).values()]


def _clean(value: str | None) -> str | None:
    """앞뒤 공백 제거, 빈 문자열은 None."""
    return (value or "").strip() or None


def _validate(slot_key: str, payload: AdConfigIn) -> dict:
    """저장할 값으로 정리한다. 전체 스위치(GLOBAL_*)는 enabled 만 의미가 있어 빈 배너를 허용한다."""
    title, description, path = map(_clean, (payload.house_title, payload.house_description, payload.house_target_path))
    if payload.provider not in PROVIDERS:
        raise AdConfigError(422, "invalid_provider", "광고 종류는 GOOGLE 또는 HOUSE 만 가능합니다.")
    if not INFEED_INTERVAL_MIN <= payload.infeed_interval <= INFEED_INTERVAL_MAX:
        raise AdConfigError(422, "invalid_interval",
                            f"인피드 간격은 {INFEED_INTERVAL_MIN}~{INFEED_INTERVAL_MAX} 사이여야 합니다.")
    if title and len(title) > HOUSE_TITLE_MAX:
        raise AdConfigError(422, "invalid_house", f"배너 제목은 {HOUSE_TITLE_MAX}자 이하로 입력하세요.")
    if description and len(description) > HOUSE_DESCRIPTION_MAX:
        raise AdConfigError(422, "invalid_house", f"배너 설명은 {HOUSE_DESCRIPTION_MAX}자 이하로 입력하세요.")
    if path and (len(path) > HOUSE_PATH_MAX or not _INTERNAL_PATH.fullmatch(path)):
        raise AdConfigError(422, "invalid_house", "배너 링크는 /game 처럼 앱 안 경로로 입력하세요.")
    # 켜진 하우스 배너가 빈 카드나 눌러도 안 움직이는 카드로 나가지 않게
    if slot_key not in GLOBAL_KEYS and payload.enabled and payload.provider == "HOUSE" and not (title and path):
        raise AdConfigError(422, "invalid_house", "하우스 배너를 켜려면 제목과 링크를 입력하세요.")
    return dict(enabled=payload.enabled, provider=payload.provider, infeed_interval=payload.infeed_interval,
                house_title=title, house_description=description, house_target_path=path)


async def update_config(db: AsyncSession, *, slot_key: str, payload: AdConfigIn, admin: User) -> AdConfigOut:
    if slot_key not in SLOT_DEFAULTS:
        raise AdConfigError(404, "unknown_slot", "없는 광고 슬롯입니다.")
    values = _validate(slot_key, payload)
    row = await ad_config_repo.get(db, slot_key) or AdConfig(slot_key=slot_key)
    for key, value in values.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = admin.email or admin.nickname
    await ad_config_repo.save(db, row)
    return AdConfigOut.model_validate(row)

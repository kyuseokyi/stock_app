"""앱 업데이트 관리 — SemVer 비교·버전 체크 판별·관리자 설정 조회/저장(명세 docs/app_update_management_spec.md §3).

판별 순서: 점검 모드(maintenance.is_active) → 강제(force 플래그 또는 현재 < 최소) → 권장(현재 < 최신) → NONE.
앱 현재 버전 형식이 틀리면 store.update_type 만 NONE(앱을 막지 않음), 점검·OTA 는 그대로 준다.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import AppVersionConfig, User

from ..app_version_schemas import AppVersionIn, AppVersionOut, VersionCheckOut
from ..repositories import app_version_repo

PLATFORMS = ("android", "ios")
OTA_POLICIES = ("SILENT", "OPTIONAL", "MANDATORY")
VERSION_MAX_LEN = 20
# major.minor.patch, 각 자리는 ASCII 숫자·앞자리 0 금지(0 단독은 허용). 관리자 웹(src/lib/semver.ts)과 같은 규칙.
_SEMVER = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")

# 행이 없을 때(시드 누락) 응답 기본값 — 마이그레이션 f4a5b6c7d8e9 시드와 같다.
_COMMON_DEFAULTS = dict(
    latest_version="1.0.0",
    min_supported_version="1.0.0",
    force_update_enabled=False,
    store_title="업데이트 안내",
    store_message="안정적인 서비스 이용을 위해 최신 버전 업데이트가 필요합니다.",
    ota_policy="SILENT",
    ota_title="새 기능 업데이트",
    ota_message="새로운 기능과 버그 수정이 다운로드되었습니다. 지금 재시작하시겠습니까?",
    is_maintenance=False,
    maintenance_message=None,
)
DEFAULTS: dict[str, dict] = {
    "android": {**_COMMON_DEFAULTS, "store_url": "https://play.google.com/store/apps/details?id=com.stockapp"},
    "ios": {**_COMMON_DEFAULTS, "store_url": "https://apps.apple.com/app/id0000000000"},
}


class AppVersionError(Exception):
    """라우터가 HTTPException(status, {code, message}) 로 바꾼다."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


# ── SemVer ──────────────────────────────────────────────────────────────────
def parse_semver(value: str | None) -> tuple[int, int, int] | None:
    """'1.10.0' → (1, 10, 0). 형식이 틀리거나 20자를 넘으면 None."""
    if not isinstance(value, str) or len(value) > VERSION_MAX_LEN:
        return None
    m = _SEMVER.fullmatch(value)
    if m is None:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def compare_semver(a: str, b: str) -> int:
    """a<b → -1, 같음 → 0, a>b → 1. 둘 다 유효한 형식이어야 한다(아니면 ValueError)."""
    pa, pb = parse_semver(a), parse_semver(b)
    if pa is None or pb is None:
        raise ValueError(f"잘못된 버전 형식: {a!r}, {b!r}")
    return (pa > pb) - (pa < pb)


MESSAGE_MAX = 2000  # 공개 응답으로 그대로 나가는 안내 문구 상한


def _check_platform(platform: str) -> None:
    if platform not in PLATFORMS:
        raise AppVersionError(422, "invalid_platform", "플랫폼은 android 또는 ios 만 가능합니다.")


# ── 판별 ────────────────────────────────────────────────────────────────────
def decide_update_type(*, current: str, latest: str, minimum: str, force: bool) -> str:
    """FORCE | RECOMMENDED | NONE.

    강제 플래그는 버전과 무관하게 FORCE(관리자 화면 약속 — 버전 값이 빠지거나 틀려도 우회되지 않게).
    그 밖에는 current 형식이 틀리면 NONE(정상 앱이 버전을 못 읽었을 때 최소 버전 비교로 막히지 않게)."""
    if force:
        return "FORCE"
    cur = parse_semver(current)
    if cur is None:
        return "NONE"
    min_v, latest_v = parse_semver(minimum), parse_semver(latest)
    if min_v is not None and cur < min_v:
        return "FORCE"
    if latest_v is not None and cur < latest_v:
        return "RECOMMENDED"
    return "NONE"


def _values(row: AppVersionConfig | None, platform: str) -> dict:
    if row is None:
        return dict(DEFAULTS[platform])
    return {k: getattr(row, k) for k in (*_COMMON_DEFAULTS, "store_url")}


async def version_check(db: AsyncSession, *, platform: str, current_version: str) -> VersionCheckOut:
    _check_platform(platform)
    v = _values(await app_version_repo.get_by_platform(db, platform), platform)
    update_type = decide_update_type(
        current=current_version.strip(),
        latest=v["latest_version"],
        minimum=v["min_supported_version"],
        force=v["force_update_enabled"],
    )
    return VersionCheckOut.model_validate({
        "maintenance": {
            "is_active": bool(v["is_maintenance"]),
            "message": v["maintenance_message"] or None,
        },
        "store": {
            "update_type": update_type,
            "latest_version": v["latest_version"],
            "min_supported_version": v["min_supported_version"],
            "title": v["store_title"],
            "message": v["store_message"],
            "store_url": v["store_url"],
        },
        "ota": {
            "policy": v["ota_policy"],
            "title": v["ota_title"] or None,
            "message": v["ota_message"] or None,
        },
    })


# ── 관리자 ──────────────────────────────────────────────────────────────────
def _out(row: AppVersionConfig | None, platform: str) -> AppVersionOut:
    if row is None:
        return AppVersionOut(platform=platform, updated_at=None, updated_by=None, **DEFAULTS[platform])
    return AppVersionOut.model_validate(row)


async def list_configs(db: AsyncSession) -> list[AppVersionOut]:
    """android·ios 를 항상 이 순서로 반환(행이 없으면 기본값)."""
    rows = {r.platform: r for r in await app_version_repo.list_all(db)}
    return [_out(rows.get(p), p) for p in PLATFORMS]


def _err(code: str, message: str) -> AppVersionError:
    return AppVersionError(422, code, message)


def _text(value: str | None, *, field: str, label: str, max_len: int | None, required: bool) -> str | None:
    v = (value or "").strip()
    if not v:
        if required:
            raise _err(f"{field}_required", f"{label}을(를) 입력하세요.")
        return None
    if max_len is not None and len(v) > max_len:
        raise _err(f"{field}_too_long", f"{label}은(는) {max_len}자 이하여야 합니다.")
    return v


def validate_payload(payload: AppVersionIn) -> dict:
    """관리자 입력 검증 → 정리된 값. 실패 시 AppVersionError(422, 한국어 메시지)."""
    latest = payload.latest_version.strip()
    minimum = payload.min_supported_version.strip()
    if parse_semver(latest) is None:
        raise _err("invalid_latest_version", "최신 버전은 1.2.3 형식(숫자.숫자.숫자)이어야 합니다.")
    if parse_semver(minimum) is None:
        raise _err("invalid_min_version", "최소 지원 버전은 1.2.3 형식(숫자.숫자.숫자)이어야 합니다.")
    if compare_semver(minimum, latest) > 0:
        raise _err("min_greater_than_latest", "최소 지원 버전은 최신 버전보다 높을 수 없습니다.")
    if payload.ota_policy not in OTA_POLICIES:
        raise _err("invalid_ota_policy", "OTA 정책은 SILENT, OPTIONAL, MANDATORY 중 하나여야 합니다.")
    store_url = _text(payload.store_url, field="store_url", label="스토어 URL", max_len=255, required=True)
    if not re.match(r"https://[^/\s]+\.[^/\s]+", store_url, flags=re.IGNORECASE):
        raise _err("invalid_store_url", "스토어 URL 은 https:// 로 시작하는 주소여야 합니다.")
    maintenance_message = _text(
        payload.maintenance_message, field="maintenance_message", label="점검 안내 문구", max_len=MESSAGE_MAX,
        required=payload.is_maintenance,  # 점검을 켜면 앱에 빈 안내가 뜨지 않게 문구 필수
    )
    return dict(
        latest_version=latest,
        min_supported_version=minimum,
        force_update_enabled=payload.force_update_enabled,
        store_url=store_url,
        store_title=_text(payload.store_title, field="store_title", label="스토어 안내 제목", max_len=100, required=True),
        store_message=_text(payload.store_message, field="store_message", label="스토어 안내 문구", max_len=MESSAGE_MAX, required=True),
        ota_policy=payload.ota_policy,
        ota_title=_text(payload.ota_title, field="ota_title", label="OTA 안내 제목", max_len=100, required=False),
        ota_message=_text(payload.ota_message, field="ota_message", label="OTA 안내 문구", max_len=MESSAGE_MAX, required=False),
        is_maintenance=payload.is_maintenance,
        maintenance_message=maintenance_message,
    )


def _actor(admin: User) -> str | None:
    name = admin.email or admin.nickname
    return name[:100] if name else None


async def update_config(db: AsyncSession, *, platform: str, payload: AppVersionIn, admin: User) -> AppVersionOut:
    _check_platform(platform)
    values = validate_payload(payload)
    row = await app_version_repo.get_by_platform(db, platform)
    if row is None:  # 시드 누락 — 이번 저장으로 만든다
        row = AppVersionConfig(platform=platform)
    for k, v in values.items():
        setattr(row, k, v)
    # 파이썬 값으로 직접 넣어 커밋 후 서버값 재조회(async 지연 로드)가 필요 없게 한다
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = _actor(admin)
    row = await app_version_repo.save(db, row)
    return AppVersionOut.model_validate(row)

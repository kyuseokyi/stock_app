"""앱 업데이트 관리 — 버전 체크 응답·관리자 설정 입출력 스키마(명세 §3-2·§3-3).

검증(버전 형식·최소 ≤ 최신·OTA 정책 값·플랫폼)은 한국어 422 메시지를 주려고 서비스에서 한다
(pydantic 검증 실패는 detail 이 배열이라 관리자 화면에 "입력값을 확인하세요."만 보인다).
"""
from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, ConfigDict


class MaintenanceOut(BaseModel):
    is_active: bool
    message: str | None


class StoreOut(BaseModel):
    update_type: str  # FORCE | RECOMMENDED | NONE
    latest_version: str
    min_supported_version: str
    title: str
    message: str
    store_url: str


class OtaOut(BaseModel):
    policy: str  # SILENT | OPTIONAL | MANDATORY
    title: str | None
    message: str | None


class VersionCheckOut(BaseModel):
    maintenance: MaintenanceOut
    store: StoreOut
    ota: OtaOut


class AppVersionIn(BaseModel):
    latest_version: str
    min_supported_version: str
    force_update_enabled: bool = False
    store_url: str
    store_title: str
    store_message: str
    ota_policy: str = "SILENT"
    ota_title: str | None = None
    ota_message: str | None = None
    is_maintenance: bool = False
    maintenance_message: str | None = None


class AppVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    platform: str
    latest_version: str
    min_supported_version: str
    force_update_enabled: bool
    store_url: str
    store_title: str
    store_message: str
    ota_policy: str
    ota_title: str | None
    ota_message: str | None
    is_maintenance: bool
    maintenance_message: str | None
    updated_at: dt.datetime | None  # 행이 없어 기본값으로 응답할 때 null
    updated_by: str | None

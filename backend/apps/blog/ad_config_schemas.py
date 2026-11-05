"""광고 원격 설정 — 공개 응답·관리자 입출력 스키마(명세 docs/ad_monetization_spec_and_plan.md §3-2).

검증은 한국어 422 메시지를 주려고 서비스에서 한다(app_version_schemas 와 같은 이유).
"""
from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, ConfigDict


class HouseAdOut(BaseModel):
    title: str | None
    description: str | None
    target_path: str | None


class AdSlotOut(BaseModel):
    enabled: bool
    provider: str  # GOOGLE | HOUSE
    infeed_interval: int
    house: HouseAdOut


class PublicAdConfigOut(BaseModel):
    web_enabled: bool
    mobile_enabled: bool
    slots: dict[str, AdSlotOut]


class AdConfigIn(BaseModel):
    enabled: bool
    provider: str = "HOUSE"
    infeed_interval: int = 7
    house_title: str | None = None
    house_description: str | None = None
    house_target_path: str | None = None


class AdConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slot_key: str
    enabled: bool
    provider: str
    infeed_interval: int
    house_title: str | None
    house_description: str | None
    house_target_path: str | None
    updated_at: dt.datetime | None  # 행이 없어 기본값으로 응답할 때 null
    updated_by: str | None

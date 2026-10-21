"""펀드 리포트 알림 — 기기 토큰·발송·템플릿 스키마(snake_case, blog 관례)."""
from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

EXPO_TOKEN_PATTERN = r"^Expo(nent)?PushToken\[[A-Za-z0-9_\-]+\]$"  # pydantic(Rust regex)의 $ 는 개행 앞에서 매치하지 않음(\Z 미지원)


class PushDeviceIn(BaseModel):
    token: str = Field(min_length=1, max_length=255, pattern=EXPO_TOKEN_PATTERN)
    platform: Literal["android", "ios"]
    fund_notice: bool = True
    # 새 글 알림. 생략 시 true — 구버전 앱(펀드 기기만 등록, 이 필드 없음) 호환(설계 §6)
    post_notice: bool = True


class FundNoticeIn(BaseModel):
    date: dt.date
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=500)
    mode: Literal["now", "test", "scheduled"]
    scheduled_at: dt.datetime | None = None
    template_id: int | None = None
    force: bool = False

    @field_validator("title", "body")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("공백만 입력할 수 없습니다.")
        return v


class PushSendOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    mode: str
    ref_date: dt.date
    title: str
    body: str
    status: str
    scheduled_at: dt.datetime | None
    started_at: dt.datetime | None
    finished_at: dt.datetime | None
    target_count: int
    success_count: int
    failure_count: int
    template_id: int | None
    created_by: int | None
    created_by_nickname: str | None = None
    created_at: dt.datetime


class PushSendListOut(BaseModel):
    items: list[PushSendOut]
    total: int


class FundNoticePreviewOut(BaseModel):
    target_count: int
    my_device_count: int
    already_sent: bool
    last_send: PushSendOut | None


class PushTemplateIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1, max_length=500)

    @field_validator("title", "body")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("공백만 입력할 수 없습니다.")
        return v


class PushTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: str
    last_sent_at: dt.datetime | None
    created_at: dt.datetime
    updated_at: dt.datetime

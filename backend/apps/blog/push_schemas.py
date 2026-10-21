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

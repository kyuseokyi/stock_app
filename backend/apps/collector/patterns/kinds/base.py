"""감지기 공통 — 내부 후보(PatternMatch)와 추상 감지기."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional

import pandas as pd


@dataclass
class PatternMatch:
    """창 하나에서 찾은 패턴 후보. 엔진이 broke_out·breakout_idx·end_idx 를 고치므로 가변."""

    pattern_type: str  # cup | cup_with_handle | double_bottom | flat_base | consolidation | high_tight_flag
    h_idx: int  # 왼쪽 림(베이스 시작)
    trough_idx: int  # 저점
    end_idx: int  # 오른쪽 끝(돌파 전 봉, 형성 중이면 창 끝)
    pivot_price: float  # 돌파 기준가
    broke_out: bool
    depth: float  # 조정 깊이 %
    confidence: float  # 0.0~1.0
    points: list[dict[str, Any]] = field(default_factory=list)
    breakout_idx: Optional[int] = None


class BaseDetector(ABC):
    def __init__(self, pattern_type: str):
        self.pattern_type = pattern_type

    @abstractmethod
    def detect_window(
        self, df: pd.DataFrame, dates: list[str], start_idx: int, end_idx: int
    ) -> Optional[PatternMatch]:
        """창 [start_idx, end_idx] 가 이 패턴인지 판정."""

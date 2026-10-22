"""차트 패턴(베이스·피벗·돌파·단계) 감지 — 순수 로직(DB·네트워크 없음).

사용: detect(bars) -> list[Base]  (bars = [(date, open, high, low, close, volume)] 오름차순 일봉)
"""
from .detector import Base, detect

__all__ = ["Base", "detect"]

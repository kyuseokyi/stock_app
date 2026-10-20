"""시장 그룹용 업종 그룹 코드 규칙(순수) — KIS 마스터의 대분류(sector_l)·중분류(sector_m)에서 하나를 고른다.

KIS 업종 분류는 제조업만 대분류가 "제조"이고 실제 업종이 중분류에 있다. 비제조업(금융·유통·건설·IT 서비스 등)은
대분류가 곧 실제 업종이고 중분류는 "0000"(없음)이다. 그래서 중분류만 보면 비제조업 약 900종목이 "0000" 하나로 묶인다.
"""
from __future__ import annotations

NO_SECTOR = "0000"  # KIS 마스터의 '분류 없음' 값
# 대분류 "제조" — 코스피 0027, 코스닥 1009. 제조업 묶음 전체라 업종 하나로 보기엔 너무 넓다.
# 중분류(실제 업종)가 비어 있는 제조 종목은 업종 없음으로 둔다.
MANUFACTURING_SECTOR_L = frozenset({"0027", "1009"})


def _code(value: str | None) -> str:
    v = (value or "").strip()
    return "" if v == NO_SECTOR else v


def sector_group_code(sector_l: str | None, sector_m: str | None) -> str:
    """중분류가 있으면 중분류, 없으면 대분류. 대분류도 없거나 '제조'뿐이면 빈 문자열(업종 없음)."""
    m = _code(sector_m)
    if m:
        return m
    l_code = _code(sector_l)
    return "" if l_code in MANUFACTURING_SECTOR_L else l_code

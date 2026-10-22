"""차트 패턴 테스트 공용 헬퍼(여러 테스트 파일이 공유)."""
from __future__ import annotations

import numpy as np


def htf_prices(pole_top=24.0):
    n = 100
    p = [10.0] * 30
    p += np.linspace(10.0, pole_top, 29).tolist()  # 깃대 → 고점 idx 58
    p += np.linspace(pole_top - 0.5, pole_top - 3.0, 8).tolist()  # 깃발로 하락(59..66)
    p += [pole_top - 2.0]  # 두 번째 고점(피벗) idx 67
    p += [21.0, 21.2, 21.4, 21.3, 21.5, 21.4, 21.5, 21.4, 21.3, 21.2, 21.4, 21.5]  # 68..79
    p = [x if i < 68 else x - (24.0 - pole_top) for i, x in enumerate(p)]
    p += [p[67] + 0.5] * (n - len(p))  # 돌파 idx 80
    return p

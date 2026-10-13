"""주간 랭킹 — 순수 함수·랭킹 갱신·마감·API 테스트."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from apps.trading_game.services import weekly_ranking as wr

KST = timezone(timedelta(hours=9))
S_START = datetime(2026, 10, 1, 9, 0, tzinfo=KST)   # 목요일
S_END = datetime(2026, 10, 31, 20, 0, tzinfo=KST)   # 토요일


def k(d, h, m=0):
    return datetime(2026, 10, d, h, m, tzinfo=KST)


@pytest.mark.parametrize("now, week_id, start, end", [
    (k(14, 12), date(2026, 10, 12), k(12, 9), k(19, 9)),        # 수요일
    (k(12, 9), date(2026, 10, 12), k(12, 9), k(19, 9)),         # 월 09:00 정각 = 새 주
    (k(12, 8, 59), date(2026, 10, 5), k(5, 9), k(12, 9)),       # 월 08:59 = 지난주
    (k(2, 10), date(2026, 9, 28), S_START, k(5, 9)),            # 시즌 시작으로 잘림
    (k(30, 15), date(2026, 10, 26), k(26, 9), S_END),           # 시즌 종료로 잘림
])
def test_week_bounds(now, week_id, start, end):
    assert wr.week_bounds(now, S_START, S_END) == (week_id, start, end)


def test_week_bounds_naive_season_is_utc_and_open_end():
    naive_start = datetime(2026, 10, 1, 0, 0)  # SQLite 는 naive 로 돌려줌 → UTC 로 해석
    wid, s, e = wr.week_bounds(k(14, 12), naive_start, None)
    assert wid == date(2026, 10, 12) and s == k(12, 9) and e == k(19, 9)


@pytest.mark.parametrize("roi, base, expected", [
    (Decimal("10"), Decimal("0"), Decimal("10.0000")),
    (Decimal("21"), Decimal("10"), Decimal("10.0000")),      # 1.21/1.10
    (Decimal("-10"), Decimal("20"), Decimal("-25.0000")),    # 0.9/1.2
    (Decimal("5"), Decimal("-100"), Decimal("0")),           # 분모 0 방어
])
def test_weekly_roi(roi, base, expected):
    assert wr.weekly_roi(roi, base) == expected


def test_keys_and_constants():
    assert wr.week_key(3, date(2026, 10, 12)) == "game:season:3:week:2026-10-12:ranking"
    assert wr.base_key(3, date(2026, 10, 12)) == "game:season:3:week:2026-10-12:base"
    assert wr.REWARDS == {1: Decimal("500000"), 2: Decimal("300000"), 3: Decimal("200000")}
    assert wr.ARCHIVE_TOP == 10
    assert wr.WEEK_TTL_SEC == 21 * 24 * 3600

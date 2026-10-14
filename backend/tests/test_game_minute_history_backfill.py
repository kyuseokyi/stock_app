"""과거 거래일 KIS 분봉 보충(inquire-time-dailychartprice) — HTTP 대역만 사용(실 KIS 호출 없음)."""
from __future__ import annotations

from datetime import date, timedelta, timezone

import pytest

from apps.collector.game_ws import kis_backfill as kb
from apps.collector.kis.client import KISClient
from apps.trading_game.services.market_clock import parse_windows

KST = timezone(timedelta(hours=9))
WINDOWS = parse_windows("09:00-15:30,16:00-20:00")
TODAY = date(2026, 10, 14)  # 수요일


def _row(day: date, hhmm: str, price=100):
    return {"stck_bsop_date": day.strftime("%Y%m%d"), "stck_cntg_hour": hhmm + "00", "stck_prpr": str(price),
            "stck_oprc": str(price), "stck_hgpr": str(price + 1), "stck_lwpr": str(price - 1), "cntg_vol": "5"}


class FakeDaily:
    """KIS 일별분봉 대역 — (날짜, hour 이하) 최신 120건을 역순으로. days 에 없는 날짜는 빈 응답(휴장)."""

    def __init__(self, days: set[date], markets=("UN",), start=(8, 0), end=(15, 30)):
        self.days, self.markets, self.start, self.end = days, markets, start, end
        self.calls: list[tuple[date, str, str]] = []

    def __call__(self, day: date, hour: str, market: str) -> list[dict]:
        self.calls.append((day, hour, market))
        if day not in self.days or market not in self.markets:
            return []
        lim = (int(hour[:2]), int(hour[2:4]))
        out, (h, m) = [], self.end
        while (h, m) >= self.start:
            if (h, m) <= lim:
                out.append(_row(day, f"{h:02d}{m:02d}"))
            h, m = (h, m - 1) if m > 0 else (h - 1, 59)
        return out[:120]


def test_past_weekdays_skips_weekend_newest_first():
    days = kb.past_weekdays(TODAY, 4)
    assert days == [date(2026, 10, 13), date(2026, 10, 12), date(2026, 10, 9), date(2026, 10, 8)]


def _run(kis, existing=frozenset(), days=3):
    inserted = []
    n = kb.backfill_history(
        "005930", fetch_day_page=kis, insert=lambda bars, source: inserted.append((bars, source)),
        existing_dates=lambda ticker, since: set(existing), today=TODAY, windows=WINDOWS, days=days, pause=0,
    )
    return n, inserted


def test_history_fills_missing_days_0900_to_1530_kis_source():
    kis = FakeDaily({date(2026, 10, 13), date(2026, 10, 12), date(2026, 10, 9)})
    n, inserted = _run(kis)
    assert n == 3 * 391  # 09:00~15:30
    assert all(src == "kis" for _, src in inserted)
    bars = [b for chunk, _ in inserted for b in chunk]
    assert all(b.ticker == "005930" for b in bars)
    assert min(b.ts for b in bars).time().isoformat() == "09:00:00"
    assert max(b.ts for b in bars).time().isoformat() == "15:30:00"
    assert kis.calls[0][1] == "153000"


def test_history_skips_days_already_in_ch_and_holidays():
    kis = FakeDaily({date(2026, 10, 12)})  # 10/9 는 휴장(빈 응답)
    n, _ = _run(kis, existing={date(2026, 10, 13)})
    assert n == 391
    assert date(2026, 10, 13) not in {d for d, _, _ in kis.calls}


def test_history_falls_back_to_j_per_day():
    kis = FakeDaily({date(2026, 10, 13)}, markets=("J",))
    n, _ = _run(kis, days=1)
    assert n == 391
    assert [m for _, _, m in kis.calls][:2] == ["UN", "J"]


def test_history_stops_on_first_error():
    calls = []

    def boom(day, hour, market):
        calls.append(day)
        raise RuntimeError("KIS rt_cd=1 모의투자 미지원")

    with pytest.raises(RuntimeError):
        _run(boom)
    assert len(calls) == 1


def test_run_history_backfill_never_raises(monkeypatch):
    def boom(*a, **kw):
        raise RuntimeError("KIS down")

    monkeypatch.setattr(kb, "backfill_history", boom)
    assert kb.run_history_backfill("005930") == 0


def test_client_daily_minute_request_params():
    seen = {}
    c = KISClient.__new__(KISClient)
    c.cfg = type("Cfg", (), {"base_url": "https://kis.test"})()

    def fake_req(method, url, tr_id, params):
        seen.update(url=url, tr_id=tr_id, params=params)
        return {"rt_cd": "0", "output2": [_row(TODAY, "0930")]}

    c._request_with_retry = fake_req
    rows = c.get_daily_minute_bars("005930", "20261013", "153000", "UN")
    assert rows and seen["tr_id"] == "FHKST03010230"
    assert seen["url"].endswith("/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice")
    assert seen["params"] == {
        "FID_COND_MRKT_DIV_CODE": "UN", "FID_INPUT_ISCD": "005930", "FID_INPUT_HOUR_1": "153000",
        "FID_INPUT_DATE_1": "20261013", "FID_PW_DATA_INCU_YN": "N", "FID_FAKE_TICK_INCU_YN": "",
    }

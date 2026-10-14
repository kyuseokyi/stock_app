"""당일 KIS 분봉 보충(inquire-time-itemchartprice) — HTTP 대역만 사용(실 KIS 호출 없음)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apps.collector.game_ws import kis_backfill as kb
from apps.collector.kis.client import KISClient
from apps.trading_game.services.market_clock import parse_windows

KST = timezone(timedelta(hours=9))
DAY = "20261014"  # 수요일
WINDOWS = parse_windows("09:00-15:30,16:00-20:00")


def at(h, m, s=0, d=14):
    return datetime(2026, 10, d, h, m, s, tzinfo=KST)


def _row(hhmm: str, price=100, vol=10, day=DAY):
    return {"stck_bsop_date": day, "stck_cntg_hour": hhmm + "00", "stck_prpr": str(price),
            "stck_oprc": str(price - 1), "stck_hgpr": str(price + 2), "stck_lwpr": str(price - 3),
            "cntg_vol": str(vol)}


def _minutes(start: datetime, end: datetime) -> list[datetime]:
    out, t = [], start
    while t <= end:
        out.append(t)
        t += timedelta(minutes=1)
    return out


class FakeKIS:
    """KIS 당일분봉 대역 — hour 이하 최신 30건을 역순으로. market 별 데이터."""

    def __init__(self, by_market: dict[str, list[datetime]]):
        self.by_market = by_market
        self.calls: list[tuple[str, str]] = []

    def __call__(self, hour: str, market: str) -> list[dict]:
        self.calls.append((hour, market))
        lim = at(int(hour[:2]), int(hour[2:4]))
        mins = [m for m in self.by_market.get(market, []) if m <= lim]
        mins.sort(reverse=True)
        return [_row(m.strftime("%H%M"), price=1000 + m.minute) for m in mins[:30]]


def test_parse_rows_filters_other_days_and_maps_fields():
    rows = [_row("0930", price=100, vol=7), _row("0929", day="20261013"), {"stck_cntg_hour": ""}]
    bars = kb.parse_rows(rows, at(10, 0).date())
    assert len(bars) == 1
    b = bars[0]
    assert b.ts == at(9, 30)
    assert (b.open, b.high, b.low, b.close, b.volume) == (99, 102, 97, 100, 7)


def test_fetch_paginates_backwards_to_0900_with_un():
    kis = FakeKIS({"UN": _minutes(at(8, 0), at(10, 30))})  # UN 은 NXT 프리마켓 포함
    bars = kb.fetch_today_bars(kis, at(10, 30, 15), pause=0)
    hours = [h for h, _ in kis.calls]
    assert hours[0] == "103015"
    assert hours[1] == "100000"           # 직전 페이지 가장 이른 분 - 1분
    assert {m for _, m in kis.calls} == {"UN"}
    assert min(b.ts for b in bars) <= at(9, 0)
    assert len({b.ts for b in bars}) == len(bars)


def test_fetch_falls_back_to_j_when_un_empty():
    kis = FakeKIS({"J": _minutes(at(9, 0), at(9, 40))})
    bars = kb.fetch_today_bars(kis, at(9, 40, 30), pause=0)
    assert kis.calls[0][1] == "UN" and kis.calls[1][1] == "J"
    assert all(m == "J" for _, m in kis.calls[1:])
    assert len(bars) == 41


def test_fetch_stops_without_progress():
    class Same:
        n = 0

        def __call__(self, hour, market):
            self.n += 1
            return [_row("1000")]  # 같은 페이지 반복

    f = Same()
    kb.fetch_today_bars(f, at(10, 0, 30), pause=0)
    assert f.n <= 3


def test_select_only_before_first_tick_and_without_tick_rows():
    bars = kb.parse_rows([_row(m.strftime("%H%M")) for m in _minutes(at(8, 58), at(9, 10))], at(9, 0).date())
    sel = kb.select_backfill(bars, now=at(9, 10, 30), first_tick_minute=at(9, 7),
                             tick_minutes={at(9, 3)}, windows=WINDOWS)
    assert [b.ts.minute for b in sel] == [0, 1, 2, 4, 5, 6]  # 09:00 이후·첫 틱 분 미만·tick 행 제외


def test_select_without_ticks_excludes_current_minute_and_out_of_window():
    bars = kb.parse_rows([_row(m.strftime("%H%M")) for m in _minutes(at(15, 28), at(16, 2))], at(16, 0).date())
    sel = kb.select_backfill(bars, now=at(16, 2, 10), first_tick_minute=None, tick_minutes=set(), windows=WINDOWS)
    assert [b.ts.strftime("%H%M") for b in sel] == ["1528", "1529", "1530", "1600", "1601"]


def test_select_ignores_first_tick_from_other_day():
    bars = kb.parse_rows([_row("0905")], at(9, 0).date())
    sel = kb.select_backfill(bars, now=at(9, 10), first_tick_minute=at(9, 1, d=13), tick_minutes=set(),
                             windows=WINDOWS)
    assert len(sel) == 1


def _run(now, kis, first=None, ticks=frozenset()):
    inserted = []
    n = kb.backfill_today(
        "005930", fetch_page=kis, insert=lambda bars, source: inserted.append((bars, source)),
        tick_minutes=lambda ticker, day: set(ticks), first_tick_minute=lambda: first,
        now=now, windows=WINDOWS, pause=0,
    )
    return n, inserted


def test_backfill_inserts_kis_source():
    kis = FakeKIS({"UN": _minutes(at(9, 0), at(9, 20))})
    n, inserted = _run(at(9, 20, 30), kis, first=at(9, 15), ticks={at(9, 2)})
    assert n == 14 and inserted[0][1] == "kis"
    assert max(b.ts for b in inserted[0][0]) == at(9, 14)


def test_backfill_skips_weekend_and_before_open():
    kis = FakeKIS({"UN": _minutes(at(9, 0), at(9, 20))})
    assert _run(datetime(2026, 10, 17, 11, 0, tzinfo=KST), kis) == (0, [])  # 토요일
    assert _run(at(8, 59), kis) == (0, [])
    assert kis.calls == []


def test_backfill_holiday_rows_of_previous_day_ignored():
    def prev_day(hour, market):
        return [_row("1500", day="20261013")]

    assert _run(at(11, 0), prev_day) == (0, [])


def test_run_backfill_never_raises(monkeypatch):
    def boom(*a, **kw):
        raise RuntimeError("KIS down")

    monkeypatch.setattr(kb, "backfill_today", boom)
    assert kb.run_backfill("005930", lambda: None) == 0


def test_client_minute_request_params():
    """KISClient.get_today_minute_bars — 경로·tr_id·파라미터(실 호출 없음)."""
    seen = {}
    c = KISClient.__new__(KISClient)
    c.cfg = type("Cfg", (), {"base_url": "https://kis.test"})()

    def fake_req(method, url, tr_id, params):
        seen.update(method=method, url=url, tr_id=tr_id, params=params)
        return {"rt_cd": "0", "output2": [_row("0930")]}

    c._request_with_retry = fake_req
    rows = c.get_today_minute_bars("005930", "093000", "UN")
    assert rows and seen["tr_id"] == "FHKST03010200"
    assert seen["url"].endswith("/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice")
    assert seen["params"] == {
        "FID_ETC_CLS_CODE": "", "FID_COND_MRKT_DIV_CODE": "UN", "FID_INPUT_ISCD": "005930",
        "FID_INPUT_HOUR_1": "093000", "FID_PW_DATA_INCU_YN": "N",
    }


def test_claim_backfill_once_per_ticker_and_day():
    from apps.collector import run_game_ws

    done: set = set()
    assert run_game_ws._claim_backfill(done, "005930", at(9, 30)) is True
    assert run_game_ws._claim_backfill(done, "005930", at(14, 0)) is False  # 크래시 재시작
    assert run_game_ws._claim_backfill(done, "000660", at(14, 0)) is True   # 종목 전환
    assert run_game_ws._claim_backfill(done, "005930", at(9, 30, d=15)) is True

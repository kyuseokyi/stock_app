"""오늘 특징주 — 52주 신고가·신저가(순수 계산). 마켓 탭 '오늘 특징주' 카드가 쓴다.

정의(스크리너 is_new_high 와 같은 기준 — indicators.prev_high/prev_low, HIGH_LOOKBACK=251):
- 신고가: 당일 고가 > 직전 251거래일 최고가.  신저가: 당일 저가 < 직전 251거래일 최저가(0 이하 저가 제외).
- 대상: 분석 유니버스(보통주 — ETF·스팩·우선주 제외, market_repo.analysis_universe) 중 봉이 252개 이상이고
  기준일 봉이 있는 종목(상장 252거래일 미만·거래정지로 기준일 봉 없음은 제외).
- 정렬: 신고가는 당일 등락률 내림차순, 신저가는 오름차순. 각 상위 top_n + 전체 개수.
설계 docs/superpowers/specs/2026-11-17-featured-stocks-design.md
"""
from __future__ import annotations

from datetime import date

from apps.collector.screener import indicators as ind

TOP_N = 20
_MIN_BARS = ind.HIGH_LOOKBACK + 1  # 직전 251거래일 + 당일


def _item(ticker: str, name: str, market: str, bar: tuple, chg: float | None, ph: float, pl: float) -> dict:
    _d, high, low, close, _vol = bar
    return {"ticker": ticker, "name": name, "market": market, "close": close,
            "change_rate": None if chg is None else round(chg, 2), "high": high, "low": low,
            "prev_high_52w": ph, "prev_low_52w": pl}


def _sorted(items: list[dict], *, desc: bool) -> list[dict]:
    """등락률 기준 정렬 — 등락률이 없는 종목(전일 종가 0 등)은 맨 뒤, 같은 값은 종목코드 순."""
    known = [x for x in items if x["change_rate"] is not None]
    unknown = [x for x in items if x["change_rate"] is None]
    known.sort(key=lambda x: (-x["change_rate"] if desc else x["change_rate"], x["ticker"]))
    return known + sorted(unknown, key=lambda x: x["ticker"])


def compute(as_of: date, universe: list[tuple], bars: dict, top_n: int = TOP_N) -> dict:
    """universe: [(ticker, name, market)], bars: {ticker: [(date, high, low, close, volume)]} 오름차순.
    반환: {date, eligible, highs: {count, items}, lows: {count, items}}."""
    highs: list[dict] = []
    lows: list[dict] = []
    eligible = 0
    for ticker, name, market in universe:
        b = bars.get(ticker)
        if not b or len(b) < _MIN_BARS or b[-1][0] != as_of:
            continue
        ph = ind.prev_high([x[1] for x in b])
        pl = ind.prev_low([x[2] for x in b])
        if ph is None or pl is None:
            continue
        eligible += 1
        today = b[-1]
        chg = ind.chg_pct([x[3] for x in b])
        if today[1] > ph:
            highs.append(_item(ticker, name, market, today, chg, ph, pl))
        if 0 < today[2] < pl:
            lows.append(_item(ticker, name, market, today, chg, ph, pl))
    n = max(0, int(top_n))
    return {"date": as_of.isoformat(), "eligible": eligible,
            "highs": {"count": len(highs), "items": _sorted(highs, desc=True)[:n]},
            "lows": {"count": len(lows), "items": _sorted(lows, desc=False)[:n]}}

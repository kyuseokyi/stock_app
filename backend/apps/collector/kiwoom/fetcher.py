"""키움 일봉(ka10081) → KIS 일봉과 같은 모양의 OHLCV 리스트 (일봉 폴백 ③단계).

- 종목코드는 항상 `{ticker}_AL`(SOR 통합). 실측(docs/kiwoom_setup_and_dev_spec.md "실측 결과"):
  `_AL` = KRX+NXT 합산 = KIS UN, NXT 미상장 종목도 `_AL` 로 KRX 값 → `nxtEnable` 판정(stock_suffix) 불필요.
- `upd_stkpc_tp="1"`(수정주가), `base_dt`=기간 끝. 응답은 base_dt 부터 과거로(최신→과거).
  기간 시작보다 이른 행이 나올 때까지 연속조회하고(상한 `MAX_PAGES`), 기간으로 자른다.
- 결과 행은 `apps/collector/kis/fetcher._to_ohlcv` 와 같은 키·타입(date·open·high·low·close·volume),
  날짜 오름차순. 거래대금은 CH `daily_prices` 에 컬럼이 없어 뺀다.
설계: docs/superpowers/specs/2026-11-16-kiwoom-daily-fallback-design.md
"""

from __future__ import annotations

import logging
from datetime import date

from apps.collector import trading_day
from apps.collector.kiwoom.client import DAILY_CHART_LIST_KEY, PATH_CHART, TR_DAILY_CHART
from apps.collector.kiwoom.normalize import SUFFIX_SOR, daily_row

logger = logging.getLogger(__name__)

# 연속조회 상한. 일봉 겹침창(32일)·14개월 백필 모두 보통 1~2쪽이면 끝난다 — 끝없는 연속조회 방지용.
MAX_PAGES = 10


def _parse(s: str) -> date:
    s = str(s).strip()
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def _valid(raw: dict) -> bool:
    return bool(str(raw.get("dt") or "").strip()) and bool(str(raw.get("cur_prc") or "").strip())


def fetch_daily_ohlcv(ticker: str, start_yyyymmdd: str, end_yyyymmdd: str, *, client,
                      max_pages: int = MAX_PAGES, today: date | None = None) -> list[dict]:
    """키움 일봉을 [start, end] 로 잘라 날짜 오름차순 OHLCV 로 반환. client: KiwoomClient(또는 같은 post)."""
    start = _parse(start_yyyymmdd)
    end = _parse(end_yyyymmdd)
    # 일봉 겹침창 끝은 오늘+2일(미래). 미래 base_dt 에 키움이 어떻게 답하는지 실측이 없어 오늘(KST)로 자른다.
    base = min(end, today or trading_day.now_kst().date())
    body = {"stk_cd": f"{ticker}{SUFFIX_SOR}", "base_dt": base.strftime("%Y%m%d"), "upd_stkpc_tp": "1"}

    raw_rows: list[dict] = []
    cont_key: str | None = None
    for _ in range(max(1, max_pages)):
        r = client.post(TR_DAILY_CHART, PATH_CHART, body, cont_key=cont_key)
        page = [row for row in (r.data.get(DAILY_CHART_LIST_KEY) or []) if _valid(row)]
        raw_rows.extend(page)
        if not page or min(_parse(row["dt"]) for row in page) < start:
            break  # 시작보다 이른 행까지 받았음(또는 빈 쪽)
        if not r.cont_yn or not r.next_key:
            break  # 더 받을 쪽이 없음(상장 이후 전부)
        cont_key = r.next_key
    else:
        logger.warning("[키움 일봉] %s 연속조회 상한 %d쪽 도달 — 받은 만큼만 적재", ticker, max_pages)

    merged: dict[date, dict] = {}
    for raw in raw_rows:
        row = daily_row(raw)
        if row["close"] <= 0 or not (start <= row["date"] <= end):
            continue
        row.pop("trading_value", None)
        merged.setdefault(row["date"], row)  # 같은 날짜는 먼저(최신 쪽) 받은 행
    return [merged[d] for d in sorted(merged)]

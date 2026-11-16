"""종목별 세부 투자자(연기금·사모·투신·은행·보험·기타금융) 순매수 수집 — KIS FHPTJ04160001.

설계: docs/superpowers/specs/2026-11-16-pension-buy-preset-design.md
- 시장코드는 CLAUDE.md 'KIS 데이터 수집 규칙' 대로 UN(통합) 먼저 → 비거나 거부(HTTPError)면 J(KRX).
  연결계열 실패(KISConnectionError)는 그대로 올려 상위 루프의 쿨다운·2차 재시도를 탄다(_investor_one 과 같다).
- 연속조회: 공식 예제는 응답 헤더 tr_cont 로 다음 페이지를 받지만, 공용 _request_with_retry 는 헤더를 돌려주지 않는다.
  대신 FID_INPUT_DATE_1 을 '받은 가장 이른 날짜 − 1일' 로 옮겨 다시 부른다(시장코드는 첫 페이지에서 정한 것 유지).
  0행·더 이른 날짜가 없음·MAX_PAGES 에서 멈춘다.
"""
from __future__ import annotations

from datetime import date, timedelta

import requests

from apps.collector.kis.client import DOMESTIC_MARKET_CODE, KRX_MARKET_CODE
from apps.collector.market_parsers import _d, parse_investor_detail

# ⚠️ 명세 확인 필요: *_ntby_tr_pbmn(순매수 거래대금) 단위. investor_flow.KIS_AMT_TO_WON 과 같게 백만원으로 본다.
# 저장은 KIS 원값 그대로(변환하지 않음) — 금액을 원으로 쓰는 쪽이 이 상수를 곱한다. 프리셋은 수량으로 판정해 무관.
# 검증: 같은 날짜 비율 = |pension_amt| × 1e6 / |pension_qty| / daily_prices 종가 — 1 근처면 백만원(유지),
#      1e3 근처면 천원(→ 1_000), 1e6 근처면 원(→ 1). 수량이 작은 행은 반올림 오차가 커서 |qty| > 1000 행만 본다.
DETAIL_AMT_TO_WON = 1_000_000
MAX_PAGES = 40  # 한 종목 연속조회 상한 — 한 호출이 1거래일씩만 줘도 30거래일 백필이 끝나게


def _ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


def to_date(v: date | str | None, default: date) -> date:
    """date 그대로, 'YYYYMMDD'·'YYYY-MM-DD' 문자열은 날짜로(Celery 인자는 JSON 문자열), 없으면 default."""
    if v is None or v == "":
        return default
    if isinstance(v, date):
        return v
    d = _d(v)
    if d is None:
        raise ValueError(f"날짜 형식 오류: {v!r}")
    return d


def _page(client, ticker: str, before: date, market: str) -> list[dict]:
    return [r for r in parse_investor_detail(client.get_investor_trade_daily(ticker, _ymd(before), market_code=market))
            if r["date"] <= before]


def fetch_investor_detail(client, ticker: str, end: date, days: int = 1) -> list[dict]:
    """end 이하 최근 거래일 행(날짜 오름차순). days 거래일을 모을 때까지 날짜를 앞으로 옮겨 다시 부른다.
    한 호출이 여러 날을 주면 받은 행은 모두 돌려준다(겹쳐 적재해도 ReplacingMergeTree 라 멱등)."""
    try:
        rows = _page(client, ticker, end, DOMESTIC_MARKET_CODE)
        market = DOMESTIC_MARKET_CODE
    except requests.HTTPError:  # UN 미지원(rt_cd·4xx) — 연결계열은 그대로 올린다
        rows = []
    if not rows:  # NXT 미상장 종목 등 — KRX(J) 폴백
        market = KRX_MARKET_CODE
        rows = _page(client, ticker, end, market)
    by_date = {r["date"]: r for r in rows}
    pages = 1
    while by_date and len(by_date) < days and pages < MAX_PAGES:
        oldest = min(by_date)
        older = [r for r in _page(client, ticker, oldest - timedelta(days=1), market) if r["date"] < oldest]
        pages += 1
        if not older:
            break
        for r in older:
            by_date[r["date"]] = r
    return [by_date[d] for d in sorted(by_date)]

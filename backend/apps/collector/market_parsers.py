"""KIS 응답 행 → 저장용 dict (순수 함수). 필드명은 KIS open-trading-api 공식 예제 COLUMN_MAPPING 기준."""
from __future__ import annotations

import re
from datetime import date

_DATE_RE = re.compile(r"(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})")


def _f(v) -> float | None:
    s = str(v if v is not None else "").replace(",", "").strip()
    if s in ("", "."):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _i(v) -> int:
    x = _f(v)
    return int(x) if x is not None else 0


def _d(v) -> date | None:
    """YYYYMMDD 또는 YYYY.MM.DD 등 — 처음 나오는 날짜(청약기간 'A~B' 면 A)."""
    m = _DATE_RE.search(str(v or ""))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _ohlc(rows, o: str, h: str, l: str, c: str) -> list[dict]:
    by_date: dict[date, dict] = {}
    for r in rows:
        d, close = _d(r.get("stck_bsop_date")), _f(r.get(c))
        if d is None or close is None:
            continue
        by_date[d] = {"date": d, "open": _f(r.get(o)) or close, "high": _f(r.get(h)) or close,
                      "low": _f(r.get(l)) or close, "close": close, "volume": _f(r.get("acml_vol"))}
    return [by_date[d] for d in sorted(by_date)]


def parse_domestic_index(rows) -> list[dict]:
    return _ohlc(rows, "bstp_nmix_oprc", "bstp_nmix_hgpr", "bstp_nmix_lwpr", "bstp_nmix_prpr")


def parse_overseas_daily(rows) -> list[dict]:
    return _ohlc(rows, "ovrs_nmix_oprc", "ovrs_nmix_hgpr", "ovrs_nmix_lwpr", "ovrs_nmix_prpr")


def parse_investor(rows) -> list[dict]:
    out: dict[date, dict] = {}
    for r in rows:
        d = _d(r.get("stck_bsop_date"))
        if d is None:
            continue
        out[d] = {"date": d, "prsn_qty": _i(r.get("prsn_ntby_qty")), "frgn_qty": _i(r.get("frgn_ntby_qty")),
                  "orgn_qty": _i(r.get("orgn_ntby_qty")), "prsn_amt": _i(r.get("prsn_ntby_tr_pbmn")),
                  "frgn_amt": _i(r.get("frgn_ntby_tr_pbmn")), "orgn_amt": _i(r.get("orgn_ntby_tr_pbmn"))}
    return [out[d] for d in sorted(out)]


# 종목별 투자자매매동향(일별, FHPTJ04160001) 순매수 필드 → 저장 컬럼. 공식 예제 chk_investor_trade_by_stock_daily.py
# COLUMN_MAPPING 기준(순매수 = KIS 가 준 *_ntby_* 를 그대로, 매수−매도를 직접 계산하지 않는다).
# 사모만 수량 필드 접미사가 _vol(pe_fund_ntby_vol, '사모 펀드 순매수 거래량')이다.
# ⚠️ 명세 확인 필요: 예제에 '기타금융' 필드는 없다. KRX 기관 분류의 기타금융(옛 종금)과 가장 가까운
#    mrbn(종금) 을 other_fin 으로 쓴다(etc=기타, etc_corp=기타법인, etc_orgt=기타단체는 쓰지 않음).
INVESTOR_DETAIL_FIELDS = {
    "pension_qty": "fund_ntby_qty", "pension_amt": "fund_ntby_tr_pbmn",          # 기금(연기금)
    "private_eq_qty": "pe_fund_ntby_vol", "private_eq_amt": "pe_fund_ntby_tr_pbmn",  # 사모 펀드
    "invtrust_qty": "ivtr_ntby_qty", "invtrust_amt": "ivtr_ntby_tr_pbmn",         # 투자신탁
    "bank_qty": "bank_ntby_qty", "bank_amt": "bank_ntby_tr_pbmn",                 # 은행
    "insurance_qty": "insu_ntby_qty", "insurance_amt": "insu_ntby_tr_pbmn",       # 보험
    "other_fin_qty": "mrbn_ntby_qty", "other_fin_amt": "mrbn_ntby_tr_pbmn",       # 종금(기타금융 추정)
}


def parse_investor_detail(rows) -> list[dict]:
    """FHPTJ04160001 output2 → 날짜 오름차순 [{date, pension_qty, ...}]. 날짜 없는 행(빈 응답 자리표시)은 버리고,
    값이 비면 0, 부호(순매도 음수)는 그대로. 같은 날짜가 겹치면 뒤 행이 남는다."""
    out: dict[date, dict] = {}
    for r in rows or []:
        d = _d(r.get("stck_bsop_date"))
        if d is None:
            continue
        out[d] = {"date": d, **{col: _i(r.get(key)) for col, key in INVESTOR_DETAIL_FIELDS.items()}}
    return [out[d] for d in sorted(out)]


def parse_financial_ratio(rows) -> list[dict]:
    out: dict[str, dict] = {}
    for r in rows:
        ym = str(r.get("stac_yymm") or "").strip()
        if len(ym) != 6 or not ym.isdigit():
            continue
        out[ym] = {"stac_yymm": ym, "eps": _f(r.get("eps")), "bps": _f(r.get("bps")), "sps": _f(r.get("sps")),
                   "roe": _f(r.get("roe_val")), "sales_growth": _f(r.get("grs")),
                   "op_growth": _f(r.get("bsop_prfi_inrt")), "ni_growth": _f(r.get("ntin_inrt")),
                   "debt_ratio": _f(r.get("lblt_rate"))}
    return [out[k] for k in sorted(out)]


def parse_ipo(rows) -> list[dict]:
    """청약 시작일·상장일을 각각 일정으로. 날짜 형식은 구분자 유무와 무관하게 YYYY MM DD 를 찾는다."""
    events = []
    for r in rows:
        ticker = str(r.get("sht_cd") or "").strip()
        if not ticker:
            continue
        payload = {k: str(v) for k, v in r.items()}
        # 종목명(isin_name) — 상장 전이라 종목 마스터에 없으므로 응답의 이름을 쓴다
        name = str(r.get("isin_name") or "").strip()
        subscr, listing = _d(r.get("subscr_dt")), _d(r.get("list_dt"))
        if subscr:
            events.append({"kind": "subscr", "event_date": subscr, "ticker": ticker, "name": name, "payload": payload})
        if listing:
            events.append({"kind": "listing", "event_date": listing, "ticker": ticker, "name": name, "payload": payload})
    return events


def parse_fluctuation(rows) -> list[dict]:
    """등락률 순위(FHPST01700000) 행 → {ticker,name,price,change_rate,volume,rank}. 숫자 변환 실패 행은 건너뜀."""
    out: list[dict] = []
    for r in rows or []:
        ticker = str(r.get("stck_shrn_iscd") or "").strip()
        price, rate, vol, rank = _f(r.get("stck_prpr")), _f(r.get("prdy_ctrt")), _f(r.get("acml_vol")), _f(r.get("data_rank"))
        if not ticker or price is None or rate is None or vol is None or rank is None:
            continue
        out.append({"ticker": ticker, "name": str(r.get("hts_kor_isnm") or "").strip(), "price": price,
                    "change_rate": rate, "volume": int(vol), "rank": int(rank)})
    return out

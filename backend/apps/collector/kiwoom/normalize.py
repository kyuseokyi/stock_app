"""키움 원시 응답(문자열 필드) → 도메인 값 변환 (순수 함수).

- 키움 숫자 필드는 문자열이고 부호(+/-)·쉼표·0 채움이 붙을 수 있다(명세 예: "+600", "0000000123759593").
- 일봉 행은 KIS `apps/collector/kis/fetcher._to_ohlcv` 와 같은 키·타입으로 맞춘다
  (date=datetime.date, 가격=float, volume=int) + `trading_value`(원).
  ⚠️ CH `daily_prices` 에는 아직 거래대금 컬럼이 없다 — ③단계(일봉 폴백) 적재 때는 빠진다.
"""

from __future__ import annotations

from datetime import date

# 통합(SOR) 조회 접미사 — 명세 ka10081 stk_cd: "KRX:039490, NXT:039490_NX, SOR:039490_AL"
SUFFIX_NXT = "_NX"
SUFFIX_SOR = "_AL"

_MILLION = 1_000_000


def to_int(value) -> int:
    """부호를 살려 정수로. 쉼표·공백 제거, 소수점 이하 버림, 빈 값·부호만 있는 값은 0."""
    if value is None:
        return 0
    s = str(value).replace(",", "").strip()
    if s in ("", "+", "-"):
        return 0
    try:
        return int(s)
    except ValueError:
        return int(float(s))


def to_price(value) -> int:
    """가격 — 키움은 등락 방향을 부호로 붙이므로 절댓값."""
    return abs(to_int(value))


def _parse_dt(s: str) -> date:
    s = str(s).strip()
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def daily_row(raw: dict) -> dict:
    """ka10081 `stk_dt_pole_chart_qry` 한 행 → OHLCV dict. 거래대금은 백만원 → 원."""
    return {
        "date": _parse_dt(raw["dt"]),
        "open": float(to_price(raw.get("open_pric"))),
        "high": float(to_price(raw.get("high_pric"))),
        "low": float(to_price(raw.get("low_pric"))),
        "close": float(to_price(raw.get("cur_prc"))),
        "volume": abs(to_int(raw.get("trde_qty"))),
        "trading_value": abs(to_int(raw.get("trde_prica"))) * _MILLION,
    }


def stock_suffix(code: str, nxt_enable: str | None) -> str:
    """통합 조회용 종목코드. NXT 거래 가능(Y)이면 `_AL`(SOR), 아니면 그대로(KRX).

    KIS 의 UN→J 폴백과 같은 취지. `_AL` 거래량이 KRX+NXT 합산인지는 실측(probe) 뒤 ③단계에서 확정한다.
    """
    return f"{code}{SUFFIX_SOR}" if (nxt_enable or "").strip().upper() == "Y" else code


def lending_row(raw: dict) -> dict | None:
    """ka20068 `dbrt_trde_trnsn` 한 행 → 대차 dict. 일자가 비거나 형식이 틀리면 None.

    명세 단위: 체결·상환·증감·잔고주수 = 1주, 잔고금액 = 백만원 → 원으로 환산.
    증감(net_qty)만 부호를 살리고(상환이 많으면 음수), 나머지는 절댓값.
    다섯 값이 모두 0 인 행은 None — 키움은 아직 확정되지 않은 오늘 날짜를 0 으로 채워 준다(2026-11-17 상용 실측).
    그대로 저장하면 그래프가 0 으로 꺼지고 lending_chg5 가 -100% 가 되어 '대차잔고 급감'에 모두 걸린다.
    """
    dt = str(raw.get("dt") or "").strip()
    if len(dt) < 8 or not dt[:8].isdigit():
        return None
    try:
        d = _parse_dt(dt)
    except ValueError:
        return None
    row = {
        "date": d,
        "new_qty": abs(to_int(raw.get("dbrt_trde_cntrcnt"))),
        "repay_qty": abs(to_int(raw.get("dbrt_trde_rpy"))),
        "net_qty": to_int(raw.get("dbrt_trde_irds")),
        "balance_qty": abs(to_int(raw.get("rmnd"))),
        "balance_amt": abs(to_int(raw.get("remn_amt"))) * _MILLION,
    }
    if not any(row[k] for k in ("new_qty", "repay_qty", "net_qty", "balance_qty", "balance_amt")):
        return None
    return row

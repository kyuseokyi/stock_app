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


# ------------------------------------------------------------------ 테마(ka90001·ka90002)
_THEME_CODE_MAX = 8  # themes.kis_code 는 String(10) — 접두사(2자)를 붙여도 넘치지 않는 길이만


def theme_group(raw: dict) -> dict | None:
    """ka90001 `thema_grp` 한 행 → {raw_code, code(KW 접두사), name}. 코드·이름이 비거나 너무 길면 None.

    키움 테마 코드는 KIS 테마 코드(3자리 숫자)와 겹칠 수 있어 저장용 코드에 접두사를 붙인다.
    등락률·기간수익률(flu_rt·dt_prft_rt)은 쓰지 않는다 — 순위·등락은 우리 일봉으로 계산.
    """
    from shared.market_repo import KIWOOM_THEME_PREFIX  # shared 는 apps 를 모르므로 여기서 가져온다

    code = str(raw.get("thema_grp_cd") or "").strip()
    name = str(raw.get("thema_nm") or "").strip()
    if not code or not name or len(code) > _THEME_CODE_MAX:
        return None
    return {"raw_code": code, "code": f"{KIWOOM_THEME_PREFIX}{code}", "name": name[:100]}


def plain_ticker(stk_cd) -> str | None:
    """키움 응답 stk_cd(길이 20) → 6자리 종목코드. `_AL`·`_NX` 접미사와 앞의 `A` 를 떼어 낸다.
    6자리 영숫자가 아니면 None."""
    code = str(stk_cd or "").strip().upper().split("_", 1)[0]
    if len(code) == 7 and code.startswith("A"):
        code = code[1:]
    return code if len(code) == 6 and code.isalnum() else None


def theme_member_ticker(raw: dict) -> str | None:
    """ka90002 `thema_comp_stk` 한 행의 stk_cd → 6자리 종목코드(`plain_ticker`)."""
    return plain_ticker(raw.get("stk_cd"))


# ------------------------------------------------------------------ 투자자별 순매수(ka10058)
# ⚠️ netslmt_amt 단위 — 명세 설명은 "단위: 원"인데, 명세 response_example 세 행은 모두
#   순매도수량 × 추정평균가 ≈ netslmt_amt × 10,000 이다(4464주×57056≈2.547억 vs 25467, 12×86658 vs 106,
#   46×16320 vs 75). 예시 산술을 따라 만원 → 원(×10,000)으로 본다. 상용 `probe --investors` 의
#   '단위 추정'(implied_amt_unit) 값이 10,000 이 아니면 이 상수를 그 값으로 고칠 것.
KIWOOM_FLOW_AMT_TO_WON = 10_000


def investor_flow_row(raw: dict) -> dict | None:
    """ka10058 `invsr_daly_trde_stk` 한 행 → {ticker,name,net_amount(원), raw_amt,qty,avg_price}.

    trde_tp=2(순매수) 조회라 이름은 '순매도' 필드지만 값은 순매수 — 부호는 그대로 살린다.
    종목코드가 6자리로 안 풀리면 None.
    """
    ticker = plain_ticker(raw.get("stk_cd"))
    if ticker is None:
        return None
    amt = to_int(raw.get("netslmt_amt"))
    return {
        "ticker": ticker,
        "name": str(raw.get("stk_nm") or "").strip() or ticker,
        "net_amount": float(amt * KIWOOM_FLOW_AMT_TO_WON),
        "raw_amt": amt,
        "qty": to_int(raw.get("netslmt_qty")),
        "avg_price": to_price(raw.get("prsm_avg_pric")),
    }


def implied_amt_unit(rows: list[dict]) -> int | None:
    """|수량 × 추정평균가 / 원시 금액| 의 중앙값을 10의 거듭제곱으로 반올림 — 금액 단위(원 환산 배수) 추정.
    계산할 수 있는 행이 없으면 None. (예시 기준 10,000 = 만원)"""
    import math

    ratios = sorted(abs(r["qty"] * r["avg_price"] / r["raw_amt"]) for r in rows
                    if r.get("raw_amt") and r.get("qty") and r.get("avg_price"))
    if not ratios:
        return None
    mid = ratios[len(ratios) // 2]
    return 10 ** max(0, round(math.log10(mid)))

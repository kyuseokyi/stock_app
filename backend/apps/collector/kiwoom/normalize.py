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


def theme_member_ticker(raw: dict) -> str | None:
    """ka90002 `thema_comp_stk` 한 행의 stk_cd → 6자리 종목코드. 응답 길이가 20 이라 `_AL`·`_NX` 접미사나
    앞의 `A` 가 붙어 올 수 있어 떼어 낸다. 6자리 영숫자가 아니면 None."""
    code = str(raw.get("stk_cd") or "").strip().upper().split("_", 1)[0]
    if len(code) == 7 and code.startswith("A"):
        code = code[1:]
    return code if len(code) == 6 and code.isalnum() else None

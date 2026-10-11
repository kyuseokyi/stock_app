"""KIS 실시간 체결(H0STCNT0) 수신 문자열 파서.

데이터 프레임 형식: `{암호화flag}|{tr_id}|{건수}|{필드^필드^...}` (평문 flag='0').
건수>1 이면 46필드 레코드가 연속되므로 레코드 단위로 분해한다.
제어 프레임(PINGPONG·구독응답)은 JSON('{' 시작)이라 None 을 반환한다.
"""
from __future__ import annotations

# H0STCNT0 필드 인덱스(0-based). 공식 TR 출력 순서 기준.
IDX_TICKER = 0
IDX_TIME = 1
IDX_PRICE = 2
IDX_SIGN = 3      # 1상한 2상승 3보합 4하한 5하락
IDX_CHANGE = 4    # 전일대비(부호 없는 크기)
IDX_RATE = 5      # 전일대비율(부호 없는 크기)
IDX_ACML_VOL = 13 # 누적 거래량
_MIN_FIELDS = IDX_ACML_VOL + 1
_DOWN_SIGNS = {"4", "5"}


def _record_to_tick(f: list[str]) -> dict:
    neg = f[IDX_SIGN] in _DOWN_SIGNS
    change = int(f[IDX_CHANGE] or 0)
    rate = float(f[IDX_RATE] or 0)
    if neg:
        change = -abs(change)
        rate = -abs(rate)
    return {
        "ticker": f[IDX_TICKER],
        "time": f[IDX_TIME],
        "price": int(f[IDX_PRICE] or 0),
        "change_price": change,
        "change_rate": rate,
        "volume": int(f[IDX_ACML_VOL] or 0),
    }


def parse_message(raw: str) -> list[dict] | None:
    """H0STCNT0 데이터 프레임이면 tick dict 리스트, 그 외(제어/깨짐)는 None."""
    if raw is None:
        return None
    raw = raw.strip()
    if not raw or raw.startswith("{"):  # 빈 값 또는 제어 프레임(JSON)
        return None
    parts = raw.split("|")
    if len(parts) < 4:
        return None
    _flag, tr_id, count_str, payload = parts[0], parts[1], parts[2], parts[3]
    if tr_id != "H0STCNT0":
        return None
    try:
        count = int(count_str)
    except ValueError:
        return None
    if count <= 0:
        return None
    fields = payload.split("^")
    if len(fields) % count != 0:
        return None
    per = len(fields) // count
    if per < _MIN_FIELDS:
        return None
    try:
        return [_record_to_tick(fields[i * per:(i + 1) * per]) for i in range(count)]
    except (ValueError, IndexError):
        return None

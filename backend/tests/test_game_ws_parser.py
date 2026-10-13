"""KIS H0STCNT0 실시간 체결 파서 단위 테스트.

H0STCNT0 출력 필드 순서(0-based, 공식 TR 기준, 총 46필드):
 0 종목코드 | 1 체결시간(HHMMSS) | 2 현재가 | 3 전일대비부호(1·2=상승,4·5=하락) |
 4 전일대비(크기) | 5 전일대비율(크기) | 6 가중평균가 | 7 시가 | 8 고가 | 9 저가 |
 10 매도호가1 | 11 매수호가1 | 12 체결거래량 | 13 누적거래량(ACML_VOL) | ...
"""
from __future__ import annotations

from apps.collector.kis.ws_parser import parse_message

FIELD_COUNT = 46


def _record(**over) -> list[str]:
    """46필드 레코드를 기본값으로 만들고 일부만 덮어쓴다."""
    f = ["0"] * FIELD_COUNT
    f[0] = "005930"   # 종목코드
    f[1] = "090005"   # 체결시간
    f[2] = "71500"    # 현재가
    f[3] = "2"        # 전일대비부호(상승)
    f[4] = "500"      # 전일대비(크기)
    f[5] = "0.70"     # 전일대비율(크기)
    f[13] = "1245000" # 누적거래량
    for k, v in over.items():
        f[int(k[1:])] = v  # 'f3' -> index 3
    return f


def _frame(records: list[list[str]]) -> str:
    payload = "^".join(x for rec in records for x in rec)
    return f"0|H0STCNT0|{len(records):03d}|{payload}"


def test_parse_single_tick_up():
    ticks = parse_message(_frame([_record()]))
    assert ticks == [
        {
            "ticker": "005930",
            "time": "090005",
            "price": 71500,
            "change_price": 500,
            "change_rate": 0.70,
            "volume": 1245000,
        }
    ]


def test_parse_down_tick_signs_negative():
    # 부호 5(하락) → change_price/rate 음수화
    ticks = parse_message(_frame([_record(f3="5")]))
    assert ticks[0]["change_price"] == -500
    assert ticks[0]["change_rate"] == -0.70


def test_parse_multi_tick():
    ticks = parse_message(_frame([_record(f2="71500"), _record(f2="71600")]))
    assert [t["price"] for t in ticks] == [71500, 71600]


def test_control_frame_returns_none():
    assert parse_message('{"header":{"tr_id":"PINGPONG"}}') is None
    assert parse_message('{"body":{"msg1":"SUBSCRIBE SUCCESS"}}') is None


def test_garbage_returns_none():
    assert parse_message("") is None
    assert parse_message("   ") is None
    assert parse_message("abc") is None
    assert parse_message("0|H0STCNT0|bad|x^y") is None  # count 비정수
    assert parse_message("0|H0XXXXX0|001|" + "^".join(["0"] * 46)) is None  # 다른 TR


# --- 통합(UN) H0UNCNT0 / NXT H0NXCNT0 ---------------------------------------
# 공식 예제(koreainvestment/open-trading-api examples_llm/domestic_stock/ccnl_total·ccnl_nxt·ccnl_krx)
# 기준 세 TR 모두 47필드·동일 순서(21번 이름만 CCLD_DVSN↔CNTG_CLS_CODE 차이). 파서 인덱스(0~5,13) 동일.
OFFICIAL_FIELD_COUNT = 47


def _record47(**over) -> list[str]:
    f = _record(**over) + ["0"] * (OFFICIAL_FIELD_COUNT - FIELD_COUNT)
    return f


def _frame_tr(tr_id: str, records: list[list[str]]) -> str:
    payload = "^".join(x for rec in records for x in rec)
    return f"0|{tr_id}|{len(records):03d}|{payload}"


def test_parse_unified_tr_h0uncnt0():
    ticks = parse_message(_frame_tr("H0UNCNT0", [_record47(f2="242000", f13="43300000")]))
    assert ticks == [
        {
            "ticker": "005930",
            "time": "090005",
            "price": 242000,
            "change_price": 500,
            "change_rate": 0.70,
            "volume": 43300000,
        }
    ]


def test_parse_unified_tr_multi_record_47_fields():
    ticks = parse_message(_frame_tr("H0UNCNT0", [_record47(f2="1"), _record47(f2="2", f3="5")]))
    assert [t["price"] for t in ticks] == [1, 2]
    assert ticks[1]["change_price"] == -500


def test_parse_nxt_tr_h0nxcnt0():
    ticks = parse_message(_frame_tr("H0NXCNT0", [_record47(f1="173000")]))
    assert ticks[0]["time"] == "173000"

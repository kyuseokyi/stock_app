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

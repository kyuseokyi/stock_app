"""장운영정보 — 프레임 파서·상태 전이(VI·거래정지·서킷브레이크·시장임시정지·사이드카)·저장/발행."""
from __future__ import annotations

import json
from datetime import datetime

import pytest
from fakeredis import aioredis as fake_aioredis

from apps.collector.kis.ws_parser import frame_tr_id, parse_status_message
from apps.trading_game.services import market_status as ms

T0 = datetime(2026, 10, 16, 10, 0, tzinfo=ms.KST).timestamp()  # 금 10:00 KST


def _frame(ticker="005930", trht="N", reason="", mkop="", vi="N", ovtm="N", stat="00", with_ticker=True):
    fields = [trht, reason, mkop, "", "", "", stat, vi, ovtm, "K"]
    if with_ticker:
        fields = [ticker] + fields
    return "0|H0STMKO0|001|" + "^".join(fields)


def _ev(**kw):
    return parse_status_message(_frame(**kw), "005930")[0]


# ---------------------------------------------------------------- 파서
def test_parser_11_fields_with_ticker():
    ev = parse_status_message(_frame(trht="Y", reason="상장폐지 사유", mkop="164", vi="Y"), "005930")[0]
    assert ev["ticker"] == "005930" and ev["trht_yn"] == "Y" and ev["tr_susp_reas_cntt"] == "상장폐지 사유"
    assert ev["mkop_cls_code"] == "164" and ev["vi_cls_code"] == "Y" and ev["exch_cls_code"] == "K"


def test_parser_10_fields_without_ticker_fills_subscribed():
    ev = parse_status_message(_frame(with_ticker=False, vi="Y"), "005930")[0]
    assert ev["ticker"] == "005930" and ev["vi_cls_code"] == "Y"


def test_parser_rejects_mismatch_and_other_frames():
    assert parse_status_message(_frame(ticker="000660"), "005930") is None  # 순서가 다르면 버림
    assert parse_status_message("0|H0UNCNT0|001|a^b", "005930") is None
    assert parse_status_message('{"header":{}}', "005930") is None
    assert parse_status_message("0|H0STMKO0|001|a^b^c", "005930") is None
    assert frame_tr_id("0|H0STMKO0|001|x") == "H0STMKO0" and frame_tr_id("{}") is None


# ---------------------------------------------------------------- 상태 전이
def test_vi_on_off_and_expiry():
    s = ms.apply_event(None, _ev(vi="Y"), T0)
    d = ms.derive(s, T0 + 10)
    assert d["state"] == ms.VI and d["blocking"] and "VI" in d["message"] and d["since"].startswith("2026-10-16T10:00")
    assert ms.derive(ms.apply_event(s, _ev(vi="N"), T0 + 120), T0 + 121)["state"] == ms.NORMAL
    assert ms.derive(s, T0 + ms.VI_MAX_SEC + 1)["state"] == ms.NORMAL  # 해제 이벤트를 놓쳐도 풀림


def test_overtime_vi_counts_as_vi():
    assert ms.derive(ms.apply_event(None, _ev(ovtm="Y"), T0), T0)["state"] == ms.VI


def test_halt_with_reason_until_released_or_next_day():
    s = ms.apply_event(None, _ev(trht="Y", reason="불성실공시"), T0)
    d = ms.derive(s, T0 + 3600)
    assert d["state"] == ms.HALTED and d["blocking"] and "불성실공시" in d["message"]
    assert ms.derive(s, T0 + 86400)["state"] == ms.NORMAL  # 날짜가 바뀌면 풀림(다음 이벤트 대기)
    assert ms.derive(ms.apply_event(s, _ev(trht="N"), T0 + 60), T0 + 61)["state"] == ms.NORMAL
    assert ms.derive(ms.apply_event(None, _ev(stat="58"), T0), T0)["state"] == ms.HALTED


@pytest.mark.parametrize("on, off", [("174", "175"), ("184", "185"), ("182", "175")])
def test_circuit_breaker(on, off):
    s = ms.apply_event(None, _ev(mkop=on), T0)
    assert ms.derive(s, T0)["state"] == ms.CIRCUIT_BREAKER and ms.derive(s, T0)["blocking"]
    assert ms.derive(ms.apply_event(s, _ev(mkop=off), T0 + 1200), T0 + 1200)["state"] == ms.NORMAL
    assert ms.derive(s, T0 + ms.CB_MAX_SEC + 1)["state"] == ms.NORMAL


def test_market_pause_cleared_by_open():
    s = ms.apply_event(None, _ev(mkop="164"), T0)
    assert ms.derive(s, T0)["state"] == ms.MARKET_PAUSED
    assert ms.derive(ms.apply_event(s, _ev(mkop="112"), T0 + 60), T0 + 60)["state"] == ms.NORMAL


@pytest.mark.parametrize("on, off", [("387", "388"), ("397", "398")])
def test_sidecar_is_info_only(on, off):
    s = ms.apply_event(None, _ev(mkop=on), T0)
    d = ms.derive(s, T0)
    assert d["state"] == ms.SIDECAR and d["blocking"] is False and "일반 주문은 그대로" in d["message"]
    assert ms.derive(ms.apply_event(s, _ev(mkop=off), T0 + 300), T0 + 300)["state"] == ms.NORMAL


def test_priority_and_close_resets():
    s = ms.apply_event(None, _ev(vi="Y", mkop="397"), T0)
    assert ms.derive(s, T0)["state"] == ms.VI  # VI(차단) > 사이드카(안내)
    s = ms.apply_event(s, _ev(trht="Y", vi="Y"), T0 + 5)
    assert ms.derive(s, T0 + 5)["state"] == ms.HALTED
    closed = ms.apply_event(ms.apply_event(None, _ev(mkop="174", vi="Y"), T0), _ev(mkop="129"), T0 + 60)
    assert ms.derive(closed, T0 + 60)["state"] == ms.NORMAL


def test_no_user_facing_jargon():
    for msg in ms.MESSAGES.values():
        assert "MKOP" not in msg and "코드" not in msg and "Redis" not in msg


# ---------------------------------------------------------------- 저장·발행·조회
async def test_save_publishes_only_on_visible_change_and_read_fail_open():
    r = fake_aioredis.FakeRedis(decode_responses=True)
    ps = r.pubsub()
    await ps.subscribe(ms.status_key("005930"))
    await ps.get_message(timeout=0.1)  # subscribe ack
    first = await ms.save_event(r, "005930", _ev(vi="Y"), T0)
    assert first and first["type"] == "market_status" and first["state"] == ms.VI
    assert await ms.save_event(r, "005930", _ev(vi="Y"), T0 + 5) is None  # 같은 상태 → 발행 안 함
    msg = await ps.get_message(timeout=1)
    assert json.loads(msg["data"])["state"] == ms.VI
    assert (await ms.read_status(r, "005930", T0 + 10))["state"] == ms.VI
    assert (await ms.read_status(r, "000660", T0))["state"] == ms.NORMAL  # 키 없음
    await ps.aclose()

    class Broken:
        async def get(self, k):
            raise ConnectionError("down")

    assert (await ms.read_status(Broken(), "005930", T0))["state"] == ms.NORMAL

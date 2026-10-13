"""게임 실시간 체결 TR 선택(UN 통합 우선 → NXT 미상장이면 KRX) 단위 테스트(네트워크 없음)."""
from __future__ import annotations

from datetime import date

from apps.collector.game_ws import tr_select
from apps.collector.game_ws.tr_select import TR_KRX, TR_UNIFIED, choose_tr_id, probe_nxt_listed


def test_choose_override_wins():
    assert choose_tr_id("H0STCNT0", nxt_listed=True) == TR_KRX
    assert choose_tr_id("h0uncnt0", nxt_listed=False) == TR_UNIFIED
    assert choose_tr_id("H0NXCNT0", nxt_listed=None) == "H0NXCNT0"


def test_choose_auto_by_probe():
    assert choose_tr_id("auto", nxt_listed=True) == TR_UNIFIED
    assert choose_tr_id("", nxt_listed=False) == TR_KRX
    assert choose_tr_id(None, nxt_listed=False) == TR_KRX


def test_choose_auto_unknown_defaults_to_unified():
    # 프로브 실패(None) → UN 시도. 구독 거부 시 WS 클라이언트가 KRX 로 런타임 폴백한다.
    assert choose_tr_id("auto", nxt_listed=None) == TR_UNIFIED


def test_choose_invalid_override_falls_back_to_auto():
    assert choose_tr_id("BOGUS", nxt_listed=False) == TR_KRX


class _FakeClient:
    def __init__(self, rows=None, exc=None):
        self.rows, self.exc, self.calls = rows or [], exc, []

    def get_daily_ohlcv(self, ticker, start, end, market_code):
        self.calls.append((ticker, start, end, market_code))
        if self.exc:
            raise self.exc
        return self.rows


def test_probe_listed_when_un_returns_rows():
    c = _FakeClient(rows=[{"stck_bsop_date": "20261012", "stck_clpr": "242000"}])
    assert probe_nxt_listed("005930", c, today=date(2026, 10, 13)) is True
    ticker, start, end, mkt = c.calls[0]
    assert (ticker, end, mkt) == ("005930", "20261013", "UN")
    assert start < end


def test_probe_unlisted_when_un_empty():
    # 실측: 293490 은 UN 0행 / J 13행 (NXT 미상장)
    assert probe_nxt_listed("293490", _FakeClient(rows=[]), today=date(2026, 10, 13)) is False
    blank = [{"stck_bsop_date": "", "stck_clpr": ""}]
    assert probe_nxt_listed("293490", _FakeClient(rows=blank), today=date(2026, 10, 13)) is False


def test_probe_error_returns_none():
    assert probe_nxt_listed("005930", _FakeClient(exc=RuntimeError("x")), today=date(2026, 10, 13)) is None


async def test_select_tr_id_uses_env_and_probe(monkeypatch):
    monkeypatch.setenv("GAME_WS_TR_ID", "auto")
    got = await tr_select.select_tr_id("293490", probe=lambda t: False)
    assert got == TR_KRX
    monkeypatch.setenv("GAME_WS_TR_ID", "H0STCNT0")
    called = []
    got = await tr_select.select_tr_id("005930", probe=lambda t: called.append(t) or True)
    assert got == TR_KRX and called == []  # 명시 override 면 프로브 생략

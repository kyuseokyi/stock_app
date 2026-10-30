"""KIS 등락률 순위 — 파서·UN→J 폴백·요청 파라미터(실제 KIS 호출 없음)."""
from __future__ import annotations

import pytest

from apps.collector.kis.client import TR_FLUCTUATION, KISClient
from apps.collector.kis.ranking import fetch_fluctuation
from apps.collector.market_parsers import parse_fluctuation

_ROW = {"stck_shrn_iscd": "005930", "hts_kor_isnm": "삼성전자", "stck_prpr": "71,000", "prdy_ctrt": "29.95",
        "acml_vol": "12345678", "data_rank": "1"}


def test_parse_fluctuation():
    rows = [_ROW, {**_ROW, "stck_shrn_iscd": "000660", "prdy_ctrt": "-"},  # 숫자 아님 → 제외
            {**_ROW, "stck_shrn_iscd": ""}, {**_ROW, "stck_shrn_iscd": "035720", "data_rank": "2",
                                               "prdy_ctrt": "-5.1"}]
    out = parse_fluctuation(rows)
    assert out == [
        {"ticker": "005930", "name": "삼성전자", "price": 71000.0, "change_rate": 29.95, "volume": 12345678, "rank": 1},
        {"ticker": "035720", "name": "삼성전자", "price": 71000.0, "change_rate": -5.1, "volume": 12345678, "rank": 2},
    ]
    assert parse_fluctuation(None) == []


class _Fake:
    def __init__(self, by_market):
        self.by_market = by_market
        self.calls: list[tuple[bool, str]] = []

    def get_fluctuation_ranking(self, *, descending, market_code):
        self.calls.append((descending, market_code))
        r = self.by_market.get(market_code, [])
        if isinstance(r, Exception):
            raise r
        return r


def test_un_first_no_fallback_when_present():
    f = _Fake({"UN": [_ROW], "J": [{**_ROW, "stck_shrn_iscd": "000001"}]})
    assert [r["ticker"] for r in fetch_fluctuation(f, True)] == ["005930"]
    assert f.calls == [(True, "UN")]


def test_un_empty_falls_back_to_j():
    f = _Fake({"UN": [], "J": [_ROW]})
    assert [r["ticker"] for r in fetch_fluctuation(f, False)] == ["005930"]
    assert f.calls == [(False, "UN"), (False, "J")]


def test_un_error_falls_back_to_j():
    f = _Fake({"UN": RuntimeError("rt_cd=1"), "J": [_ROW]})
    assert len(fetch_fluctuation(f, True)) == 1
    assert f.calls == [(True, "UN"), (True, "J")]


class _Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, method, url, tr_id, params):
        self.calls.append((method, url, tr_id, params))
        return {"rt_cd": "0", "output": [_ROW]}


@pytest.mark.parametrize("descending,code", [(True, "0"), (False, "1")])
def test_request_params(descending, code):
    c = KISClient.__new__(KISClient)  # __init__(redis/config) 우회
    c.cfg = type("Cfg", (), {"base_url": "https://kis.test"})()
    rec = _Recorder()
    c._request_with_retry = rec
    assert c.get_fluctuation_ranking(descending=descending, market_code="UN") == [_ROW]
    method, url, tr_id, params = rec.calls[0]
    assert method == "get"
    assert url == "https://kis.test/uapi/domestic-stock/v1/ranking/fluctuation"
    assert tr_id == TR_FLUCTUATION == "FHPST01700000"
    assert params["fid_rank_sort_cls_code"] == code
    assert params["fid_cond_mrkt_div_code"] == "UN"
    assert params["fid_cond_scr_div_code"] == "20170"
    assert params["fid_input_iscd"] == "0000"
    assert params["fid_input_cnt_1"] == "0"
    assert params["fid_trgt_cls_code"] == "0" and params["fid_trgt_exls_cls_code"] == "0"
    assert params["fid_rsfl_rate1"] == "" and params["fid_rsfl_rate2"] == ""

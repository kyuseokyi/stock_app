"""KIS 응답 → 저장용 dict 파서 + 클라이언트 요청 인자(공식 예제 필드명)."""
from datetime import date

from apps.collector import market_parsers as mp
from apps.collector.kis import client as kc


def test_domestic_index_rows():
    rows = [{"stck_bsop_date": "20261016", "bstp_nmix_oprc": "2,600.10", "bstp_nmix_hgpr": "2610.5",
             "bstp_nmix_lwpr": "2590", "bstp_nmix_prpr": "2605.3", "acml_vol": "450000"},
            {"stck_bsop_date": "", "bstp_nmix_prpr": "1"}]
    assert mp.parse_domestic_index(rows) == [
        {"date": date(2026, 10, 16), "open": 2600.10, "high": 2610.5, "low": 2590.0, "close": 2605.3,
         "volume": 450000.0}
    ]


def test_overseas_rows_sorted_and_missing_volume():
    rows = [{"stck_bsop_date": "20261015", "ovrs_nmix_oprc": "6000", "ovrs_nmix_hgpr": "6050",
             "ovrs_nmix_lwpr": "5990", "ovrs_nmix_prpr": "6040", "acml_vol": ""},
            {"stck_bsop_date": "20261014", "ovrs_nmix_prpr": "5900"}]
    out = mp.parse_overseas_daily(rows)
    assert [r["date"] for r in out] == [date(2026, 10, 14), date(2026, 10, 15)]
    assert out[1] == {"date": date(2026, 10, 15), "open": 6000.0, "high": 6050.0, "low": 5990.0,
                      "close": 6040.0, "volume": None}
    assert out[0]["open"] == 5900.0  # 시가 없으면 종가로


def test_investor_rows():
    rows = [{"stck_bsop_date": "20261016", "prsn_ntby_qty": "-1200", "frgn_ntby_qty": "800",
             "orgn_ntby_qty": "400", "prsn_ntby_tr_pbmn": "-90", "frgn_ntby_tr_pbmn": "60",
             "orgn_ntby_tr_pbmn": "30"}]
    assert mp.parse_investor(rows) == [{"date": date(2026, 10, 16), "prsn_qty": -1200, "frgn_qty": 800,
                                        "orgn_qty": 400, "prsn_amt": -90, "frgn_amt": 60, "orgn_amt": 30}]


def test_financial_ratio_rows():
    rows = [{"stac_yymm": "202606", "eps": "1,234", "bps": "50000", "sps": "40000", "roe_val": "12.5",
             "grs": "10.1", "bsop_prfi_inrt": "-3.2", "ntin_inrt": "", "lblt_rate": "30.0"},
            {"stac_yymm": "bad"}]
    assert mp.parse_financial_ratio(rows) == [{"stac_yymm": "202606", "eps": 1234.0, "bps": 50000.0,
                                               "sps": 40000.0, "roe": 12.5, "sales_growth": 10.1,
                                               "op_growth": -3.2, "ni_growth": None, "debt_ratio": 30.0}]


def test_ipo_rows_to_events():
    rows = [{"sht_cd": "123450", "subscr_dt": "2026.10.27~2026.10.28", "list_dt": "2026.11.05",
             "fix_subscr_pri": "15000", "lead_mgr": "한국투자증권", "record_date": "20261020"},
            {"sht_cd": "", "subscr_dt": "2026.10.27~2026.10.28"},
            {"sht_cd": "777770", "subscr_dt": "20261102~20261103", "list_dt": ""}]
    evs = mp.parse_ipo(rows)
    assert [(e["kind"], e["event_date"], e["ticker"]) for e in evs] == [
        ("subscr", date(2026, 10, 27), "123450"), ("listing", date(2026, 11, 5), "123450"),
        ("subscr", date(2026, 11, 2), "777770")]
    assert evs[0]["payload"]["lead_mgr"] == "한국투자증권"


def test_as_list_normalizes_output():
    assert kc._as_list({"a": 1}) == [{"a": 1}] and kc._as_list(None) == [] and kc._as_list([1]) == [1]


class _FakeClient(kc.KISClient):
    def __init__(self):
        self.calls = []
        self.cfg = type("C", (), {"base_url": "https://kis"})()

    def _request_with_retry(self, method, url, tr_id, params):
        self.calls.append((url.replace("https://kis", ""), tr_id, params))
        return {"output1": [{"x": 1}], "output2": [{"y": 2}], "output": [{"z": 3}]}


def test_client_request_shapes():
    c = _FakeClient()
    assert c.get_domestic_index_daily("0001", "20260101", "20260410") == [{"y": 2}]
    assert c.get_overseas_daily("N", "SOX", "20260101", "20260410") == [{"y": 2}]
    assert c.get_investor_daily("005930", market_code="UN") == [{"z": 3}]
    assert c.get_financial_ratio("005930", "1") == [{"z": 3}]
    assert c.get_ipo_schedule("20261011", "20261217") == [{"x": 1}]
    assert [(u, t) for u, t, _ in c.calls] == [
        ("/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice", "FHKUP03500100"),
        ("/uapi/overseas-price/v1/quotations/inquire-daily-chartprice", "FHKST03030100"),
        ("/uapi/domestic-stock/v1/quotations/inquire-investor", "FHKST01010900"),
        ("/uapi/domestic-stock/v1/finance/financial-ratio", "FHKST66430300"),
        ("/uapi/domestic-stock/v1/ksdinfo/pub-offer", "HHKDB669108C0"),
    ]
    assert c.calls[0][2] == {"FID_COND_MRKT_DIV_CODE": "U", "FID_INPUT_ISCD": "0001", "FID_INPUT_DATE_1": "20260101",
                             "FID_INPUT_DATE_2": "20260410", "FID_PERIOD_DIV_CODE": "D"}
    assert c.calls[1][2]["FID_COND_MRKT_DIV_CODE"] == "N" and c.calls[1][2]["FID_INPUT_ISCD"] == "SOX"
    assert c.calls[2][2] == {"FID_COND_MRKT_DIV_CODE": "UN", "FID_INPUT_ISCD": "005930"}
    assert c.calls[3][2] == {"FID_DIV_CLS_CODE": "1", "fid_cond_mrkt_div_code": "J", "fid_input_iscd": "005930"}
    assert c.calls[4][2] == {"SHT_CD": "", "CTS": "", "F_DT": "20261011", "T_DT": "20261217"}

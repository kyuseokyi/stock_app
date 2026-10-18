"""KIS 마스터 파일 파서 — .mst 뒤쪽 필드(프로필)·idxcode(업종)·theme_code(테마)."""
from datetime import date

from apps.collector.kis import reference_master as rm


def _line(market: str, ticker: str, name: str, fields: dict[str, str]) -> str:
    n = rm.PART2_LEN[market]
    p2 = [" "] * n
    for key, value in fields.items():
        a, b = rm.SPANS[market][key]
        assert len(value) == b - a, key
        p2[a:b] = value
    front = f"{ticker:<9}KR7{ticker}000{name}"
    return front + "".join(p2)


KOSPI_SAMSUNG = {
    "mcap_size": "1", "sector_l": "0027", "sector_m": "0013", "sector_s": "0000",
    "etp": " ", "spac": "N", "halted": "N", "managed": "N", "warning": "00",
    "listed_date": "19750611", "listed_shares": "000000005846278", "settle_month": "12",
    "preferred": "0", "market_cap": "012277185",
}


def test_parse_kospi_profile():
    p = rm.parse_profile(_line("KOSPI", "005930", "삼성전자", KOSPI_SAMSUNG), "KOSPI")
    assert p.ticker == "005930" and p.market == "KOSPI"
    assert (p.sector_l, p.sector_m, p.sector_s) == ("0027", "0013", "0000")
    assert p.listed_date == date(1975, 6, 11)
    assert p.listed_shares_k == 5846278 and p.market_cap_100m == 12277185
    assert p.settle_month == 12
    assert not (p.is_etp or p.is_spac or p.is_preferred or p.is_halted or p.is_managed)
    assert p.is_common_stock


def test_parse_kosdaq_flags_and_spans():
    fields = {
        "mcap_size": "3", "sector_l": "1009", "sector_m": "1028", "sector_s": "0000",
        "etp": " ", "spac": "Y", "halted": "Y", "managed": "Y", "warning": "01",
        "listed_date": "20190305", "listed_shares": "000000000097830", "settle_month": "12",
        "preferred": "0", "market_cap": "000103602",
    }
    p = rm.parse_profile(_line("KOSDAQ", "247540", "에코프로비엠", fields), "KOSDAQ")
    assert p.ticker == "247540" and p.is_spac and p.is_halted and p.is_managed
    assert p.warning_code == "01" and not p.is_common_stock
    assert p.listed_shares_k == 97830 and p.market_cap_100m == 103602


def test_etf_and_preferred_are_not_common():
    etf = rm.parse_profile(_line("KOSPI", "069500", "KODEX 200", {**KOSPI_SAMSUNG, "etp": "2"}), "KOSPI")
    pref = rm.parse_profile(_line("KOSPI", "005935", "삼성전자우", {**KOSPI_SAMSUNG, "preferred": "1"}), "KOSPI")
    assert etf.is_etp and not etf.is_common_stock
    assert pref.is_preferred and not pref.is_common_stock


def test_bad_numbers_become_none_and_short_line_skipped():
    p = rm.parse_profile(
        _line("KOSPI", "000001", "깨짐", {**KOSPI_SAMSUNG, "listed_date": "00000000", "market_cap": "         "}),
        "KOSPI",
    )
    assert p.listed_date is None and p.market_cap_100m is None
    assert rm.parse_profile("짧은줄", "KOSPI") is None
    assert len(rm.parse_profiles(["짧은줄", _line("KOSPI", "005930", "삼성전자", KOSPI_SAMSUNG)], "KOSPI")) == 1


def test_master_stock_name_not_truncated_when_name_fills_field():
    """긴 ETF 이름이 뒤쪽 필드와 붙어 있어도 마지막 글자가 잘리지 않음(예전 228 고정 자르기 버그)."""
    from apps.collector.kis import master

    name = "TIGER 엔비디아미국채커버드콜밸런스(합성)"
    stocks = master.parse_master_lines({"KOSPI": [_line("KOSPI", "123456", name, KOSPI_SAMSUNG)], "KOSDAQ": []})
    assert [(s.ticker, s.name, s.market) for s in stocks] == [("123456", name, "KOSPI")]


def test_parse_sectors_uses_name_after_code():
    lines = ["00027제조" + " " * 36, "11009제조" + " " * 36, "00001종합" + " " * 36]
    assert rm.parse_sectors(lines) == {"0027": "제조", "1009": "제조", "0001": "종합"}


def test_parse_themes_groups_tickers():
    lines = [
        "004반도체/반도체장비" + " " * 20 + "005930    ",
        "004반도체/반도체장비" + " " * 20 + "000660    ",
        "385제약" + " " * 33 + "068270    ",
    ]
    themes = {t.code: t for t in rm.parse_themes(lines)}
    assert themes["004"].name == "반도체/반도체장비"
    assert themes["004"].tickers == ("005930", "000660")
    assert themes["385"].tickers == ("068270",)

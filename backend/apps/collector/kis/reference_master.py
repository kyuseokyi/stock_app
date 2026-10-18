"""KIS 마스터 파일(키 없이 받는 공개 파일) 파서 — 종목 프로필·업종·테마.

- .mst 뒤쪽 고정폭 필드: KIS open-trading-api stocks_info/kis_kospi_code_mst.py·kis_kosdaq_code_mst.py
  의 field_specs 기준. 예제는 줄바꿈이 붙은 줄에서 row[-228:]/row[-222:] 를 자르므로 실제 데이터 길이는
  KOSPI 227 / KOSDAQ 221 이다(2026-10-18 실파일로 오프셋 검증).
- idxcode.mst: [1:5] 업종코드, [5:45] 업종명(예제의 [3:43] 은 코드 뒷자리가 섞인다).
- theme_code.mst: [0:3] 테마코드, [3:-10] 테마명, [-10:] 종목코드.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

PART2_LEN = {"KOSPI": 227, "KOSDAQ": 221}

# 필드 → [시작, 끝) (뒤쪽 필드 기준 오프셋)
SPANS: dict[str, dict[str, tuple[int, int]]] = {
    "KOSPI": {
        "mcap_size": (2, 3), "sector_l": (3, 7), "sector_m": (7, 11), "sector_s": (11, 15),
        "etp": (22, 23), "spac": (29, 30), "halted": (60, 61), "managed": (62, 63), "warning": (63, 65),
        "listed_date": (105, 113), "listed_shares": (113, 128), "settle_month": (149, 151),
        "preferred": (158, 159), "market_cap": (212, 221),
    },
    "KOSDAQ": {
        "mcap_size": (2, 3), "sector_l": (3, 7), "sector_m": (7, 11), "sector_s": (11, 15),
        "etp": (18, 19), "spac": (24, 25), "halted": (55, 56), "managed": (57, 58), "warning": (58, 60),
        "listed_date": (100, 108), "listed_shares": (108, 123), "settle_month": (144, 146),
        "preferred": (153, 154), "market_cap": (206, 215),
    },
}


@dataclass(frozen=True)
class StockProfileRow:
    ticker: str
    market: str
    mcap_size: str
    sector_l: str
    sector_m: str
    sector_s: str
    is_etp: bool
    is_spac: bool
    is_preferred: bool
    is_halted: bool
    is_managed: bool
    warning_code: str
    listed_date: date | None
    listed_shares_k: int | None   # 천 주
    market_cap_100m: int | None   # 억 원(전일 기준)
    settle_month: int | None

    @property
    def is_common_stock(self) -> bool:
        """분석 대상(보통주) — ETP·SPAC·우선주 제외. 관리종목·거래정지는 포함(표시만)."""
        return not (self.is_etp or self.is_spac or self.is_preferred)


@dataclass(frozen=True)
class ThemeRow:
    code: str
    name: str
    tickers: tuple[str, ...]


def _int(s: str) -> int | None:
    s = s.strip()
    return int(s) if s.isdigit() and int(s) > 0 else None


def _date(s: str) -> date | None:
    s = s.strip()
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:]))
    except ValueError:
        return None


def parse_profile(line: str, market: str) -> StockProfileRow | None:
    n = PART2_LEN[market]
    line = line.rstrip("\r\n")
    if len(line) <= n + 21:
        return None
    front, p2 = line[:-n], line[-n:]
    ticker = front[0:9].strip()[-6:]
    if not ticker:
        return None
    f = {k: p2[a:b] for k, (a, b) in SPANS[market].items()}
    return StockProfileRow(
        ticker=ticker, market=market, mcap_size=f["mcap_size"].strip(),
        sector_l=f["sector_l"].strip(), sector_m=f["sector_m"].strip(), sector_s=f["sector_s"].strip(),
        is_etp=f["etp"].strip() != "", is_spac=f["spac"] == "Y",
        is_preferred=f["preferred"].strip() not in ("", "0"),
        is_halted=f["halted"] == "Y", is_managed=f["managed"] == "Y", warning_code=f["warning"].strip(),
        listed_date=_date(f["listed_date"]), listed_shares_k=_int(f["listed_shares"]),
        market_cap_100m=_int(f["market_cap"]), settle_month=_int(f["settle_month"]),
    )


def parse_profiles(lines: list[str], market: str) -> list[StockProfileRow]:
    out = []
    for line in lines:
        p = parse_profile(line, market)
        if p is not None:
            out.append(p)
    return out


def parse_sectors(lines: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in lines:
        line = line.rstrip("\r\n")
        code, name = line[1:5].strip(), line[5:45].strip()
        if len(code) == 4 and name:
            out[code] = name
    return out


def parse_themes(lines: list[str]) -> list[ThemeRow]:
    names: dict[str, str] = {}
    tickers: dict[str, list[str]] = {}
    for line in lines:
        line = line.rstrip("\r\n")
        if len(line) < 14:
            continue
        code, name, ticker = line[0:3], line[3:-10].strip(), line[-10:].strip()
        if not code.strip() or not ticker:
            continue
        names[code] = name
        bucket = tickers.setdefault(code, [])
        if ticker not in bucket:
            bucket.append(ticker)
    return [ThemeRow(code=c, name=names[c], tickers=tuple(tickers[c])) for c in names]

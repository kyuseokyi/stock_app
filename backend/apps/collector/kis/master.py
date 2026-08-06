"""KRX 전종목 마스터(.mst) 다운로드/파싱.

KIS 다운로드 서버에서 kospi/kosdaq 코드 마스터(zip)를 받아 (종목코드, 종목명, 시장)
튜플로 파싱한다. KIS 공식 open-trading-api 샘플 포맷을 따른다(고정폭·CP949).

다운로드 호스트: new.real.download.dws.co.kr (KIS 종목 마스터 CDN).
다운로드/파싱 실패 시 stock_master.load_domestic_tickers() 가 fallback 정적 리스트로
자동 전환한다. KOSPI ~2,560 / KOSDAQ ~1,700 instrument(주식+ETF/ETN/펀드/스팩 포함).

참조: KIS open-trading-api / stocks_info (kis_kospi_code_mst.py, kis_kosdaq_code_mst.py)
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass

import requests

_KOSPI_URL = "https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip"
_KOSDAQ_URL = "https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip"
_TIMEOUT = 30


@dataclass(frozen=True)
class MasterStock:
    ticker: str  # 6자리 단축코드
    name: str  # 한글 종목명
    market: str  # KOSPI / KOSDAQ


def _download_mst_text(url: str) -> list[str]:
    """zip 다운로드 → 압축해제 → CP949 라인 리스트."""
    resp = requests.get(url, timeout=_TIMEOUT)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        raw = zf.read(zf.namelist()[0])
    return raw.decode("cp949", errors="replace").splitlines()


def _parse_front(line: str) -> tuple[str, str] | None:
    """마스터 라인 앞부분에서 (단축코드, 한글명) 추출.

    KIS 포맷: 앞부분(가변) + 뒤 228바이트(수치 필드). 앞부분은
      [0:9]=단축코드, [9:21]=표준코드, [21:]=한글명.
    ETF/ETN/스팩/우선주 포함(전종목). 필터링이 필요하면 상위에서 처리.
    """
    if len(line) <= 228:
        return None
    front = line[: len(line) - 228]
    short_code = front[0:9].strip()
    name = front[21:].strip()
    if not short_code or not name:
        return None
    # 단축코드는 보통 6자리 숫자. 앞의 시장식별 문자(A 등)가 붙는 경우 뒤 6자리만 취함.
    ticker = short_code[-6:]
    return ticker, name


def _parse_market(lines: list[str], market: str) -> list[MasterStock]:
    out: list[MasterStock] = []
    for line in lines:
        parsed = _parse_front(line)
        if parsed:
            out.append(MasterStock(ticker=parsed[0], name=parsed[1], market=market))
    return out


def download_and_parse_master() -> list[MasterStock]:
    """KOSPI+KOSDAQ 전종목 마스터를 받아 파싱해 반환."""
    kospi = _parse_market(_download_mst_text(_KOSPI_URL), "KOSPI")
    kosdaq = _parse_market(_download_mst_text(_KOSDAQ_URL), "KOSDAQ")
    return kospi + kosdaq

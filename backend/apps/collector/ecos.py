"""한국은행 경제통계시스템(ECOS) — 원/달러 매매기준율(일별). 키: ECOS_API_KEY(없으면 수집 건너뜀).

API: https://ecos.bok.or.kr/api/StatisticSearch/{KEY}/json/kr/{시작행}/{끝행}/{통계표}/{주기}/{시작일}/{종료일}/{항목}
  - 통계표 731Y001(주요국 통화의 대원화 환율), 항목 0000001(원/미국달러 매매기준율), 주기 D(YYYYMMDD).
  - 정상: {"StatisticSearch": {"list_total_count": n, "row": [{"TIME": "20261119", "DATA_VALUE": "1,385.2", ...}]}}
  - 오류: {"RESULT": {"CODE": "INFO-200", "MESSAGE": "해당하는 데이터가 없습니다."}} — 데이터 없음 외 코드는 오류로 올린다.
키 발급: ecos.bok.or.kr → 개발 명세서 → 인증키 신청(무료).

⚠️ 키가 URL 경로에 들어간다 → 예외 메시지·로그에 URL 이나 requests 예외 원문을 남기지 않는다(EcosError 는 키 없는 문장만).
"""
from __future__ import annotations

import os
from datetime import date

import requests

BASE = "https://ecos.bok.or.kr/api/StatisticSearch"
_TIMEOUT = 20
STAT_CODE = "731Y001"
ITEM_CODE = "0000001"
CYCLE = "D"
# macro_series 의 series_id — FRED id(대문자 영숫자)와 겹치지 않게 출처 접두어를 붙인다
SERIES_ID = "ECOS:USDKRW"
NO_DATA_CODE = "INFO-200"


class EcosError(Exception):
    """ECOS 호출 실패 — 메시지에 키·URL 을 넣지 않는다(로그·Celery 결과에 그대로 남으므로)."""


def api_key() -> str | None:
    k = (os.getenv("ECOS_API_KEY") or "").strip()
    return k or None


def _value(raw) -> float | None:
    s = str(raw if raw is not None else "").replace(",", "").strip()
    if s in ("", "-", "."):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _day(raw) -> date | None:
    s = str(raw or "").strip()
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:]))
    except ValueError:
        return None


def parse_rows(data) -> list[tuple[date, float | None]]:
    """StatisticSearch 응답 → [(날짜, 값)] 날짜순. 데이터 없음(INFO-200)은 빈 목록, 그 밖의 RESULT 코드는 EcosError."""
    if not isinstance(data, dict):
        raise EcosError("ECOS 응답 형식이 달라요")
    body = data.get("StatisticSearch")
    if body is None:
        result = data.get("RESULT") or {}
        code = str(result.get("CODE") or "")
        if code == NO_DATA_CODE:
            return []
        msg = str(result.get("MESSAGE") or "")[:120]
        raise EcosError(f"ECOS 오류 {code or '코드 없음'}: {msg}")
    out = []
    for row in body.get("row") or []:
        d = _day(row.get("TIME"))
        if d is not None:
            out.append((d, _value(row.get("DATA_VALUE"))))
    return sorted(out)


class EcosClient:
    def __init__(self, key: str, session=None):
        self.key = key
        self.session = session or requests.Session()

    def usdkrw_daily(self, start: date, end: date) -> list[tuple[date, float | None]]:
        """start~end(포함) 원/달러 매매기준율. 끝 행 번호는 달력 일수(영업일보다 항상 많다)."""
        rows = max(1, (end - start).days + 1)
        url = (f"{BASE}/{self.key}/json/kr/1/{rows}/{STAT_CODE}/{CYCLE}/"
               f"{start.strftime('%Y%m%d')}/{end.strftime('%Y%m%d')}/{ITEM_CODE}")
        try:
            resp = self.session.get(url, timeout=_TIMEOUT)
        except requests.RequestException as e:
            # requests 예외 문장에는 URL(=키)이 들어간다 → 종류 이름만
            raise EcosError(f"ECOS 요청 실패({type(e).__name__})") from None
        if resp.status_code != 200:
            raise EcosError(f"ECOS HTTP {resp.status_code}")  # raise_for_status 문장도 URL 을 담아 쓰지 않는다
        try:
            data = resp.json()
        except ValueError:
            raise EcosError("ECOS 응답이 JSON 이 아니에요") from None
        return parse_rows(data)

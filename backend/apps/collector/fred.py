"""FRED(미 세인트루이스 연준) 거시 지표 — 관측값·발표 예정일. 키: FRED_API_KEY(없으면 수집 건너뜀).

API: https://api.stlouisfed.org/fred/ — series/observations, series/release, release/dates (file_type=json).
결측값은 '.' 로 온다. 키 발급: fred.stlouisfed.org → My Account → API Keys(무료).
"""
from __future__ import annotations

import os
from datetime import date

import requests

BASE = "https://api.stlouisfed.org/fred"
_TIMEOUT = 20

DEFAULT_SERIES = ("CPIAUCSL", "CPILFESL", "PCEPILFE", "UNRATE", "PAYEMS", "FEDFUNDS", "DGS10", "DGS2", "T10Y2Y")
# 발표 예정일을 캘린더(stock_events)에 넣을 시리즈 — 월 1회 발표만. CPI(근원 CPI 같은 발표),
# 고용보고서(실업률·비농업 고용 같은 발표), 개인소득·지출(PCE). 금리·국채(H.15)·스프레드는 매 영업일이라 제외.
CALENDAR_SERIES = frozenset({"CPIAUCSL", "UNRATE", "PCEPILFE"})
LABELS = {
    "CPIAUCSL": "미국 CPI", "CPILFESL": "미국 근원 CPI", "PCEPILFE": "미국 근원 PCE", "UNRATE": "미국 실업률",
    "PAYEMS": "미국 비농업 고용", "FEDFUNDS": "미국 기준금리(실효)", "DGS10": "미 국채 10년",
    "DGS2": "미 국채 2년", "T10Y2Y": "미 국채 10년-2년",
}


def api_key() -> str | None:
    k = (os.getenv("FRED_API_KEY") or "").strip()
    return k or None


def series_ids() -> list[str]:
    out = list(DEFAULT_SERIES)
    for s in (os.getenv("MACRO_SERIES_EXTRA") or "").split(","):
        s = s.strip().upper()
        if s and s not in out:
            out.append(s)
    return out


def _d(s: str) -> date:
    return date.fromisoformat(str(s)[:10])


class FredError(RuntimeError):
    """FRED 호출 실패 — 문장에 API 키·URL 을 담지 않는다."""


def redact(text: str, key: str | None) -> str:
    """로그·결과에 남기기 전 마지막 안전장치 — 문장 안의 키를 *** 로 바꾼다(FredError 밖에서 난 예외 대비)."""
    return text.replace(key, "***") if key else text


class FredClient:
    def __init__(self, key: str, session=None):
        self.key = key
        self.session = session or requests.Session()

    def _get(self, path: str, **params) -> dict:
        # 키가 쿼리스트링(api_key=)에 들어가므로 requests 예외·raise_for_status 문장에는 전체 URL(=키)이 담긴다.
        # → 그 문장을 쓰지 않고 종류 이름·상태 코드만 남긴 FredError 로 바꾼다(from None: 원래 예외를 연결하지 않음).
        try:
            resp = self.session.get(f"{BASE}/{path}", params={**params, "api_key": self.key, "file_type": "json"},
                                    timeout=_TIMEOUT)
        except requests.RequestException as e:
            raise FredError(f"FRED 요청 실패({type(e).__name__}) {path}") from None
        if resp.status_code != 200:
            raise FredError(f"FRED HTTP {resp.status_code} {path}")
        try:
            return resp.json()
        except ValueError:
            raise FredError(f"FRED 응답이 JSON 이 아니에요 {path}") from None

    def observations(self, series_id: str, start: date) -> list[tuple[date, float | None]]:
        data = self._get("series/observations", series_id=series_id, observation_start=start.isoformat())
        out = []
        for o in data.get("observations", []):
            v = str(o.get("value", "")).strip()
            out.append((_d(o["date"]), None if v in ("", ".") else float(v)))
        return out

    def release_of(self, series_id: str) -> tuple[int, str] | None:
        rels = self._get("series/release", series_id=series_id).get("releases") or []
        return (int(rels[0]["id"]), str(rels[0].get("name", ""))) if rels else None

    def release_dates(self, release_id: int, start: date, end: date) -> list[date]:
        data = self._get("release/dates", release_id=release_id, realtime_start=start.isoformat(),
                         realtime_end=end.isoformat(), include_release_dates_with_no_data="true",
                         sort_order="asc")
        days = {_d(r["date"]) for r in data.get("release_dates", [])}
        return sorted(d for d in days if start <= d <= end)


def release_events(releases: dict[int, tuple[str, str]], dates: dict[int, list[date]]) -> list[dict]:
    """releases: {release_id: (FRED 발표명, 대표 series_id)} → stock_events 행(category=경제지표)."""
    out = []
    for rid, (name, series_id) in releases.items():
        label = LABELS.get(series_id, name)
        for d in dates.get(rid, []):
            out.append({"event_date": d, "title": f"{label} 발표", "category": "경제지표", "ticker": None,
                        "source": "fred", "source_key": f"fred:{rid}:{d.isoformat()}",
                        "payload": {"release_id": rid, "release_name": name, "series_id": series_id}})
    return out

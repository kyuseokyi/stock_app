"""금융감독원 OpenDART — 종목코드→고유번호(corp_code) 매핑, 공시 목록, 지뢰 공시 힌트.

- corpCode.xml: 전체 회사 고유번호 zip(XML). 수 MB 라 **하루 1회만** 받아 프로세스 메모리에 캐시(날짜 키).
- list.json: 기간 내 공시 목록. status != "000" 이면 빈 결과(013 = 조회된 데이터 없음 포함).
- 네트워크·파싱 실패는 빈 결과/None + warning. 인증키는 로그에 남기지 않는다.
"""
from __future__ import annotations

import io
import logging
import threading
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Callable, Iterable
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

import httpx

from shared import config

log = logging.getLogger(__name__)

BASE = "https://opendart.fss.or.kr/api"
CORP_CODE_URL = f"{BASE}/corpCode.xml"
LIST_URL = f"{BASE}/list.json"
VIEWER_URL = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo="
_TIMEOUT = 20.0
_KST = ZoneInfo("Asia/Seoul")

# 하루 캐시(프로세스 공유): {"day": date|None, "map": {stock_code: corp_code}}
_corp_cache: dict = {"day": None, "map": {}}
_corp_lock = threading.Lock()


def clear_corp_code_cache() -> None:
    """테스트·수동 갱신용 — 다음 corp_code() 호출 때 다시 내려받는다."""
    with _corp_lock:
        _corp_cache["day"] = None
        _corp_cache["map"] = {}


def _today_kst() -> date:
    return datetime.now(_KST).date()


@dataclass(frozen=True)
class Disclosure:
    report_nm: str  # 보고서명
    rcept_no: str  # 접수번호
    rcept_dt: str  # 접수일자 YYYYMMDD
    flr_nm: str  # 공시 제출인
    corp_name: str

    @property
    def url(self) -> str:
        return f"{VIEWER_URL}{self.rcept_no}"


def parse_corp_code_zip(content: bytes) -> dict[str, str]:
    """corpCode.xml zip → {stock_code(6자리): corp_code(8자리)}. 비상장(종목코드 공백)은 제외."""
    out: dict[str, str] = {}
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".xml")]
        if not names:
            return out
        with zf.open(names[0]) as f:
            for _, el in ElementTree.iterparse(f, events=("end",)):
                if el.tag != "list":
                    continue
                stock = (el.findtext("stock_code") or "").strip()
                corp = (el.findtext("corp_code") or "").strip()
                if stock and corp:
                    out[stock] = corp
                el.clear()
    return out


# 보고서명 키워드 → 힌트(순서 = 출력 우선순위). 같은 힌트는 한 번만.
_RED_FLAGS: tuple[tuple[str, str], ...] = (
    ("전환사채", "전환사채(CB) 발행 — 주식 전환 시 지분 희석 가능"),
    ("신주인수권부사채", "신주인수권부사채(BW) 발행 — 지분 희석 가능"),
    ("교환사채", "교환사채(EB) 발행 — 보유 주식 매물 출회 가능"),
    ("유상증자", "유상증자 — 신주 발행에 따른 지분 희석"),
    ("감자", "감자 결정 — 자본 잠식·재무 악화 신호일 수 있음"),
    ("최대주주변경", "최대주주 변경 — 경영권 변동"),
    ("최대주주 변경", "최대주주 변경 — 경영권 변동"),
    ("횡령", "횡령 혐의 공시 — 거래정지·상장적격성 심사 위험"),
    ("배임", "배임 혐의 공시 — 거래정지·상장적격성 심사 위험"),
    ("관리종목", "관리종목 지정 관련 공시"),
    ("불성실공시", "불성실공시법인 지정 관련 공시"),
    ("상장적격성", "상장적격성 실질심사 관련 공시"),
    ("감사의견", "감사의견 관련 공시 — 비적정 여부 확인 필요"),
    ("회생절차", "회생절차 관련 공시"),
)


def red_flag_hints(disclosures: Iterable[Disclosure]) -> list[str]:
    """보고서명에 위험 키워드가 있으면 한국어 힌트 목록(중복 제거, 발견 순서 유지)."""
    hints: list[str] = []
    for d in disclosures:
        name = (d.report_nm or "").replace(" ", "")
        for kw, hint in _RED_FLAGS:
            if kw.replace(" ", "") in name and hint not in hints:
                hints.append(hint)
    return hints


class OpenDartClient:
    def __init__(self, api_key: str, transport: httpx.BaseTransport | None = None,
                 *, today: Callable[[], date] | None = None):
        self._key = api_key
        self._transport = transport
        self._today = today or _today_kst

    def _get(self, url: str, params: dict) -> httpx.Response:
        with httpx.Client(transport=self._transport, timeout=_TIMEOUT) as c:
            resp = c.get(url, params={**params, "crtfc_key": self._key})
        resp.raise_for_status()
        return resp

    def _corp_map(self) -> dict[str, str]:
        day = self._today()
        with _corp_lock:
            if _corp_cache["day"] == day and _corp_cache["map"]:
                return _corp_cache["map"]
            try:
                mapping = parse_corp_code_zip(self._get(CORP_CODE_URL, {}).content)
            except Exception as e:  # noqa: BLE001 — 네트워크·zip·XML 오류
                log.warning("DART 고유번호 목록 수신 실패 (%s)", type(e).__name__)
                return _corp_cache["map"]  # 어제 캐시라도 있으면 그대로 사용(실패는 캐시하지 않음)
            if mapping:
                _corp_cache["day"] = day
                _corp_cache["map"] = mapping
            return mapping

    def corp_code(self, stock_code: str) -> str | None:
        return self._corp_map().get(str(stock_code).strip())

    def disclosures(self, stock_code: str, *, days: int = 90) -> list[Disclosure]:
        corp = self.corp_code(stock_code)
        if not corp:
            return []
        end = self._today()
        bgn = end - timedelta(days=days)
        params = {"corp_code": corp, "bgn_de": bgn.strftime("%Y%m%d"), "end_de": end.strftime("%Y%m%d"),
                  "page_count": 100}
        try:
            body = self._get(LIST_URL, params).json()
        except Exception as e:  # noqa: BLE001
            log.warning("DART 공시 목록 조회 실패 (%s)", type(e).__name__)
            return []
        status = str(body.get("status", ""))
        if status != "000":
            if status != "013":  # 013 = 조회된 데이터 없음(정상적인 빈 결과)
                log.warning("DART 공시 목록 상태 코드 %s", status)
            return []
        out: list[Disclosure] = []
        for r in body.get("list") or []:
            if not isinstance(r, dict):
                continue
            out.append(Disclosure(
                report_nm=str(r.get("report_nm") or "").strip(),
                rcept_no=str(r.get("rcept_no") or ""),
                rcept_dt=str(r.get("rcept_dt") or ""),
                flr_nm=str(r.get("flr_nm") or ""),
                corp_name=str(r.get("corp_name") or ""),
            ))
        return out


def get_opendart_client() -> OpenDartClient | None:
    key = config.opendart_api_key()
    if not key:
        return None
    return OpenDartClient(key)

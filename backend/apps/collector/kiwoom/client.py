"""키움증권 REST API 저수준 클라이언트 (동기, requests 기반). KIS `apps/collector/kis/client.py` 와 같은 패턴.

- 모든 조회는 `POST` + JSON body, TR 은 헤더 `api-id`, 인증은 `authorization: Bearer <token>`.
- 토큰(au10001 `POST /oauth2/token`): Redis 공유 캐시 `kiwoom:token:prod:{app_key[:10]}` — 값은
  `{"token", "expires_dt"}` JSON(캐시에서 읽어도 만료 시각을 알 수 있게). TTL = 만료(KST) − 지금 − 600초, 최소 60초.
- 연속조회: 응답 헤더 `cont-yn=Y`·`next-key` → 다음 요청 헤더에 그대로.
- 재시도: HTTP 5xx·타임아웃·연결 오류, 한도 초과(1700·1701·1702)만 백오프(최대 3회, `1.5**n` 초).
  8005(토큰 무효)는 캐시 삭제·재발급 후 1회, 8010(발급 IP≠요청 IP)은 즉시 실패, 그 밖은 즉시 실패.
- 키움이 오류를 HTTP 200 으로 주는지 4xx 로 주는지 명세에 없으므로, 상태 코드보다 body `return_code` 를 먼저 본다.
- 예외 메시지·로그에 앱키·시크릿·토큰을 절대 넣지 않는다.

공식 명세: GitHub Kiwoom-Securities/Kiwoom-REST-API `kiwoom/_data/kiwoom_api_spec.json`(c7a3d25)
  - apis["접근토큰 발급(au10001)"], apis["주식일봉차트조회요청(ka10081)"], apis["종목정보 리스트(ka10099)"],
    apis["대차거래추이요청(종목별)(ka20068)"], apis["테마그룹별요청(ka90001)"], apis["테마구성종목요청(ka90002)"],
    apis["투자자별일별매매종목요청(ka10058)"], apis["변동성완화장치발동종목요청(ka10054)"], error_codes
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import redis
import requests
from requests.adapters import HTTPAdapter

from apps.collector.rate_limit import RateLimiter
from shared.kiwoom_config import KiwoomConfig, get_kiwoom_config

KST = ZoneInfo("Asia/Seoul")

# --- 명세에서 확인한 이름 (kiwoom_api_spec.json c7a3d25) ---
TOKEN_PATH = "/oauth2/token"          # au10001 meta.URL
TR_TOKEN = "au10001"
TR_DAILY_CHART = "ka10081"            # 주식일봉차트조회요청
PATH_CHART = "/api/dostk/chart"       # ka10081 meta.URL
DAILY_CHART_LIST_KEY = "stk_dt_pole_chart_qry"  # ka10081 response.body LIST
TR_STOCK_LIST = "ka10099"             # 종목정보 리스트
PATH_STOCK_INFO = "/api/dostk/stkinfo"  # ka10099 meta.URL
STOCK_LIST_KEY = "list"               # ka10099 response.body LIST
TR_LENDING = "ka20068"                # 대차거래추이요청(종목별)
PATH_SLB = "/api/dostk/slb"           # ka20068 meta.URL
LENDING_LIST_KEY = "dbrt_trde_trnsn"  # ka20068 response.body LIST(대차거래추이)
TR_THEME_GROUPS = "ka90001"           # 테마그룹별요청
TR_THEME_MEMBERS = "ka90002"          # 테마구성종목요청
PATH_THEME = "/api/dostk/thme"        # ka90001·ka90002 meta.URL(둘 다 같은 경로, api-id 로 구분)
THEME_GROUPS_LIST_KEY = "thema_grp"   # ka90001 response.body LIST(thema_grp_cd·thema_nm·stk_num …)
THEME_MEMBERS_LIST_KEY = "thema_comp_stk"  # ka90002 response.body LIST(stk_cd·stk_nm …)
TR_INVESTOR_DAILY = "ka10058"         # 투자자별일별매매종목요청 — meta.URL 은 ka10099 와 같은 PATH_STOCK_INFO
INVESTOR_DAILY_LIST_KEY = "invsr_daly_trde_stk"  # ka10058 response.body LIST(stk_cd·stk_nm·netslmt_amt …)
# ka10058 invsr_tp(명세): 8000 개인, 9000 외국인, 1000 금융투자, 3000 투신, 3100 사모펀드, 5000 기타금융,
# 4000 은행, 2000 보험, 6000 연기금, 7000 국가, 7100 기타법인, 9999 기관계 — 전광판에 쓰는 셋만 매핑
INVESTOR_CODES = {"foreign": "9000", "institution": "9999", "pension": "6000"}
# ka10058 mrkt_tp(명세): 001 코스피, 101 코스닥 — ka10099 의 "0"/"10" 과 다르다
INVESTOR_MARKETS = {"kospi": "001", "kosdaq": "101"}
TRDE_NET_BUY = "2"                    # ka10058 trde_tp — 1:순매도, 2:순매수
STEX_UNIFIED = "3"                    # stex_tp — 1:KRX, 2:NXT, 3:통합(우리 일봉 UN 과 같은 기준)
TR_VI = "ka10054"                     # 변동성완화장치발동종목요청 — meta.URL 은 PATH_STOCK_INFO
VI_LIST_KEY = "motn_stk"              # ka10054 response.body LIST(stk_cd·stk_nm·motn_pric·trde_cntr_proc_time …)
# ka10054 skip_stk(명세): 9자리, 순서 = 우선주·관리종목·투자경고/위험·투자주의·환기종목·단기과열·증거금100%·ETF·ETN,
#   0=포함 1=제외. 우선주·ETF·ETN 만 뺀다(특징주 카드는 보통주 기준 — 신고저가 유니버스와 맞춤).
VI_SKIP_STK = "100000011"
VI_MAX_PAGES = 10                     # 하루 발동 목록 연속조회 안전 상한

# 오류 코드(명세 error_codes)
CODE_TOKEN_INVALID = 8005  # Token이 유효하지 않습니다
CODE_IP_MISMATCH = 8010    # Token을 발급받은 IP와 서비스를 요청한 IP가 동일하지 않습니다
RATE_LIMIT_CODES = frozenset({1700, 1701, 1702})  # API별·전체·그룹 요청 개수 초과

_MAX_RETRIES = 3            # 첫 시도 뒤 재시도 횟수
_TIMEOUT = 15
_POOL_SIZE = 4
_TOKEN_MARGIN_SEC = 600     # 만료 10분 전에 캐시를 비워 재발급
_MIN_TTL = 60
_FALLBACK_TTL = 23 * 3600   # expires_dt 를 못 읽을 때(토큰 유효 24시간)
_MAX_LIST_PAGES = 200       # "끝까지" 받는 연속조회의 안전 상한


class KiwoomError(RuntimeError):
    """키움 연동 오류의 공통 부모."""


class KiwoomNotConfigured(KiwoomError):
    """KIWOOM_APP_KEY / KIWOOM_APP_SECRET 미설정."""


class KiwoomApiError(KiwoomError):
    """키움 논리 오류(`return_code`≠0) 또는 재시도 대상이 아닌 HTTP 4xx."""

    def __init__(self, code: int | None, msg: str):
        self.code = code
        self.msg = msg
        super().__init__(f"키움 오류 code={code} msg={msg}")


class KiwoomTokenInvalid(KiwoomApiError):
    """8005 — 캐시 삭제·재발급 후 1회 재시도 대상."""


class KiwoomIpError(KiwoomApiError):
    """8010 — 등록된 IP(상용 서버) 밖에서 호출."""

    def __init__(self, code: int | None, msg: str):
        super().__init__(code, msg)
        self.args = (f"키움은 등록된 IP(상용 서버)에서만 호출할 수 있어요 (code={code} msg={msg})",)


class KiwoomConnectionError(KiwoomError):
    """5xx·타임아웃·연결 오류로 재시도를 모두 소진(KIS `KISConnectionError` 와 같은 역할)."""


@dataclass(frozen=True)
class KiwoomResponse:
    data: dict
    cont_yn: bool
    next_key: str


@dataclass(frozen=True)
class TokenInfo:
    token: str
    expires_at: datetime | None  # KST aware
    cached: bool


def _now() -> datetime:
    return datetime.now(KST)


def _parse_expires(expires_dt: str | None) -> datetime | None:
    try:
        return datetime.strptime(str(expires_dt).strip(), "%Y%m%d%H%M%S").replace(tzinfo=KST)
    except (TypeError, ValueError):
        return None


def token_ttl(expires_dt: str | None, now: datetime) -> int:
    """캐시 TTL(초). expires_dt 는 KST(YYYYMMDDHHmmss) — now 는 aware(어느 시간대든) 여야 한다."""
    exp = _parse_expires(expires_dt)
    if exp is None:
        return _FALLBACK_TTL
    return max(_MIN_TTL, int((exp - now).total_seconds()) - _TOKEN_MARGIN_SEC)


def _return_code(data) -> int | None:
    if not isinstance(data, dict) or "return_code" not in data:
        return None
    try:
        return int(str(data["return_code"]).strip())
    except ValueError:
        return None


def _api_error(code: int, msg: str) -> KiwoomApiError:
    if code == CODE_TOKEN_INVALID:
        return KiwoomTokenInvalid(code, msg)
    if code == CODE_IP_MISMATCH:
        return KiwoomIpError(code, msg)
    return KiwoomApiError(code, msg)


def theme_groups_body(*, date_tp: str = "1", stex_tp: str = STEX_UNIFIED) -> dict:
    """ka90001 body(명세 request.body 그대로). qry_tp=0 전체검색, flu_pl_amt_tp=1 상위기간수익률(필수값이라 넣을 뿐
    순위·등락은 쓰지 않는다), date_tp 는 길이 2(1~99일)."""
    return {"qry_tp": "0", "stk_cd": "", "date_tp": date_tp, "thema_nm": "", "flu_pl_amt_tp": "1", "stex_tp": stex_tp}


def investor_daily_body(investor: str, strt_dt: str, end_dt: str, market: str, *,
                        stex_tp: str = STEX_UNIFIED) -> dict:
    """ka10058 body(명세 request.body 6개 모두 필수). investor: foreign|institution|pension, market: kospi|kosdaq."""
    if investor not in INVESTOR_CODES:
        raise ValueError(f"알 수 없는 투자자 구분: {investor}")
    if market not in INVESTOR_MARKETS:
        raise ValueError(f"알 수 없는 시장 구분: {market}")
    return {"strt_dt": strt_dt, "end_dt": end_dt, "trde_tp": TRDE_NET_BUY, "mrkt_tp": INVESTOR_MARKETS[market],
            "invsr_tp": INVESTOR_CODES[investor], "stex_tp": stex_tp}


def vi_body(*, stex_tp: str = STEX_UNIFIED, skip_stk: str = VI_SKIP_STK) -> dict:
    """ka10054 body(명세 request.body 13개 모두 필수, request_example 기준). 전체 시장(000)·장전구분 전체(0)·
    발동구분 전체(0)·발동방향 전체(0), 거래량·거래대금 조건 사용 안 함."""
    return {"mrkt_tp": "000", "bf_mkrt_tp": "0", "stk_cd": "", "motn_tp": "0", "skip_stk": skip_stk,
            "trde_qty_tp": "0", "min_trde_qty": "0", "max_trde_qty": "0", "trde_prica_tp": "0",
            "min_trde_prica": "0", "max_trde_prica": "0", "motn_drc": "0", "stex_tp": stex_tp}


class KiwoomClient:
    def __init__(self, config: KiwoomConfig | None = None, limiter=None, *, session=None, redis_client=None):
        """limiter: 공유 RateLimiter — HTTP 요청(토큰·재시도 포함)마다 acquire. 없으면 설정 속도로 만든다.

        session·redis_client 는 테스트 주입용(기본은 requests.Session·REDIS_URL).
        """
        self.cfg = config or get_kiwoom_config()
        if not self.cfg.is_configured:
            raise KiwoomNotConfigured("키움 키(KIWOOM_APP_KEY/KIWOOM_APP_SECRET)가 설정되지 않았어요.")
        self._limiter = limiter if limiter is not None else RateLimiter(self.cfg.rate_per_sec)
        self._redis = redis_client if redis_client is not None else redis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
        )
        self._token_key = f"kiwoom:token:prod:{self.cfg.app_key[:10]}"
        if session is None:
            session = requests.Session()
            adapter = HTTPAdapter(pool_connections=_POOL_SIZE, pool_maxsize=_POOL_SIZE, max_retries=0)
            session.mount("https://", adapter)
        self._session = session

    def close(self) -> None:
        self._session.close()

    # ------------------------------------------------------------------ 토큰
    def _issue_token(self) -> TokenInfo:
        body = {"grant_type": "client_credentials", "appkey": self.cfg.app_key, "secretkey": self.cfg.app_secret}
        headers = {"content-type": "application/json;charset=UTF-8", "api-id": TR_TOKEN}
        data, _ = self._send(f"{self.cfg.base_url}{TOKEN_PATH}", body, headers)
        token = data.get("token")
        if not token:
            raise KiwoomApiError(_return_code(data), "토큰 발급 응답에 token 이 없어요")
        expires_dt = str(data.get("expires_dt") or "")
        self._redis.set(self._token_key, json.dumps({"token": token, "expires_dt": expires_dt}),
                        ex=token_ttl(expires_dt, _now()))
        return TokenInfo(token=token, expires_at=_parse_expires(expires_dt), cached=False)

    def get_token_info(self) -> TokenInfo:
        raw = self._redis.get(self._token_key)
        if raw:
            try:
                cached = json.loads(raw)
                if cached.get("token"):
                    return TokenInfo(cached["token"], _parse_expires(cached.get("expires_dt")), cached=True)
            except (ValueError, AttributeError):
                pass  # 깨진 캐시는 무시하고 새로 발급
        return self._issue_token()

    def get_token(self) -> str:
        return self.get_token_info().token

    def _invalidate_token(self) -> None:
        self._redis.delete(self._token_key)

    # ------------------------------------------------------------------ 요청
    def _send(self, url: str, body: dict, headers: dict) -> tuple[dict, dict]:
        """POST 1건(재시도 포함). (body dict, 소문자 응답 헤더) 반환."""
        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES + 1):
            if attempt:
                time.sleep(1.5 ** (attempt - 1))
            self._limiter.acquire()  # 재시도도 키움 호출 — 초당 상한에 포함
            try:
                resp = self._session.post(url, json=body, headers=headers, timeout=_TIMEOUT)
            except (requests.ConnectionError, requests.Timeout) as e:
                last_exc = KiwoomConnectionError(f"키움 연결 실패: {type(e).__name__}")
                continue
            try:
                data = resp.json()
            except ValueError:
                data = None
            resp_headers = {str(k).lower(): v for k, v in (resp.headers or {}).items()}

            code = _return_code(data)
            if code is not None and code != 0:
                msg = str(data.get("return_msg", ""))[:200]
                if code in RATE_LIMIT_CODES:
                    last_exc = KiwoomApiError(code, msg)
                    continue
                raise _api_error(code, msg)
            if resp.status_code >= 500:
                last_exc = KiwoomConnectionError(f"키움 HTTP {resp.status_code}")
                continue
            if resp.status_code >= 400:
                raise KiwoomApiError(None, f"HTTP {resp.status_code}")
            return (data if isinstance(data, dict) else {}), resp_headers
        if isinstance(last_exc, KiwoomApiError):
            raise last_exc
        raise KiwoomConnectionError(f"키움 요청 실패(재시도 소진): {last_exc}")

    def _headers(self, api_id: str, token: str, cont_key: str | None) -> dict:
        h = {"content-type": "application/json;charset=UTF-8", "api-id": api_id, "authorization": f"Bearer {token}"}
        if cont_key:
            h["cont-yn"] = "Y"
            h["next-key"] = cont_key
        return h

    def post(self, api_id: str, path: str, body: dict, *, cont_key: str | None = None) -> KiwoomResponse:
        url = f"{self.cfg.base_url}{path}"
        for attempt in range(2):
            token = self.get_token()
            try:
                data, headers = self._send(url, body, self._headers(api_id, token, cont_key))
            except KiwoomTokenInvalid:
                if attempt:
                    raise  # 재발급한 토큰도 무효 — 무한 반복 금지
                self._invalidate_token()
                continue
            return KiwoomResponse(
                data=data,
                cont_yn=str(headers.get("cont-yn", "")).strip().upper() == "Y",
                next_key=str(headers.get("next-key", "") or "").strip(),
            )
        raise AssertionError("unreachable")  # pragma: no cover

    def paginate(self, api_id: str, path: str, body: dict, list_key: str, max_pages: int) -> list[dict]:
        """cont-yn=Y 동안(최대 max_pages) 이어 받아 list_key 배열을 합친다."""
        rows: list[dict] = []
        cont_key: str | None = None
        for _ in range(max(1, max_pages)):
            r = self.post(api_id, path, body, cont_key=cont_key)
            rows.extend(r.data.get(list_key) or [])
            if not r.cont_yn or not r.next_key:
                break
            cont_key = r.next_key
        return rows

    # ------------------------------------------------------------------ TR
    def get_daily_chart(self, stk_cd: str, base_dt: str, *, adjusted: bool = True, max_pages: int = 1) -> list[dict]:
        """ka10081 주식일봉차트 원시 행 — base_dt(YYYYMMDD)부터 과거로, 최신→과거 순.

        stk_cd 접미사: 없음=KRX, `_NX`=NXT, `_AL`=SOR(통합).
        """
        body = {"stk_cd": stk_cd, "base_dt": base_dt, "upd_stkpc_tp": "1" if adjusted else "0"}
        return self.paginate(TR_DAILY_CHART, PATH_CHART, body, DAILY_CHART_LIST_KEY, max_pages)

    def list_stocks(self, mrkt_tp: str) -> list[dict]:
        """ka10099 종목정보 리스트(끝까지). mrkt_tp: "0" 코스피, "10" 코스닥."""
        return self.paginate(TR_STOCK_LIST, PATH_STOCK_INFO, {"mrkt_tp": mrkt_tp}, STOCK_LIST_KEY, _MAX_LIST_PAGES)

    def get_lending_trend(self, stk_cd: str, strt_dt: str, end_dt: str, *, max_pages: int = 1) -> list[dict]:
        """ka20068 대차거래추이(종목별) 원시 행 — [strt_dt, end_dt](YYYYMMDD). 응답 예시는 최신→과거 순.

        stk_cd 는 6자리 그대로(명세 length 6, 예시 "005930") — ka10081 과 달리 `_NX`·`_AL` 접미사를 쓰지 않는다.
        all_tp="0": 종목코드 입력 종목만 표시(명세).
        """
        body = {"strt_dt": strt_dt, "end_dt": end_dt, "all_tp": "0", "stk_cd": stk_cd}
        return self.paginate(TR_LENDING, PATH_SLB, body, LENDING_LIST_KEY, max_pages)

    def list_themes(self, *, stex_tp: str = STEX_UNIFIED, max_pages: int = _MAX_LIST_PAGES) -> list[dict]:
        """ka90001 테마그룹별요청 — 전체 테마(끝까지 연속조회) 원시 행."""
        return self.paginate(TR_THEME_GROUPS, PATH_THEME, theme_groups_body(stex_tp=stex_tp),
                             THEME_GROUPS_LIST_KEY, max_pages)

    def theme_members(self, thema_grp_cd: str, *, stex_tp: str = STEX_UNIFIED, max_pages: int = 10) -> list[dict]:
        """ka90002 테마구성종목요청 — 한 테마의 구성 종목 원시 행. thema_grp_cd 는 키움 원 코드(접두사 없이).

        date_tp 는 명세상 선택·길이 1(ka90001 은 길이 2) — 기간수익률용이라 구성 종목에는 영향 없어 "1".
        """
        body = {"date_tp": "1", "thema_grp_cd": thema_grp_cd, "stex_tp": stex_tp}
        return self.paginate(TR_THEME_MEMBERS, PATH_THEME, body, THEME_MEMBERS_LIST_KEY, max_pages)

    def investor_daily_top(self, investor: str, strt_dt: str, end_dt: str, market: str, *,
                           stex_tp: str = STEX_UNIFIED, max_pages: int = 2) -> list[dict]:
        """ka10058 투자자별일별매매종목(순매수) 원시 행 — [strt_dt, end_dt] 기간 합계, 한 시장·한 투자자.

        정렬 순서·쪽당 행 수는 명세에 없다(probe --investors 로 확인). 정렬은 호출하는 쪽에서 다시 한다.
        """
        return self.paginate(TR_INVESTOR_DAILY, PATH_STOCK_INFO,
                             investor_daily_body(investor, strt_dt, end_dt, market, stex_tp=stex_tp),
                             INVESTOR_DAILY_LIST_KEY, max_pages)

    def vi_stocks(self, *, stex_tp: str = STEX_UNIFIED, max_pages: int = VI_MAX_PAGES) -> list[dict]:
        """ka10054 변동성완화장치(VI) 발동 종목 원시 행 — 오늘 발동 목록(연속조회 최대 max_pages).
        한 종목이 여러 행(발동마다·거래소별 KRX/NXT)으로 올 수 있다(명세 예시) — 종목별 집계는 kiwoom.vi."""
        return self.paginate(TR_VI, PATH_STOCK_INFO, vi_body(stex_tp=stex_tp), VI_LIST_KEY, max_pages)

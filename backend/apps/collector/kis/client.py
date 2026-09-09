"""한국투자증권(KIS) 국내 시세 수집용 저수준 클라이언트 (동기, requests 기반).

- OAuth 토큰: Redis 공유 캐시(발급 제한 대응) → 없으면 발급 후 저장
- 국내 일봉: inquire-daily-itemchartprice (tr_id=FHKST03010100, 수정주가, 시장=UN 통합)
- 재시도: 5xx·타임아웃·연결오류만 지수 백오프, 4xx 즉시 실패

참조(ams): app/libs/external_api/kis_client.py, schemas/kis/domestic_stock/inquire_daily_itemchartprice.py
"""

from __future__ import annotations

import os
import time

import redis
import requests
from requests.adapters import HTTPAdapter

from shared.kis_config import KISConfig, get_kis_config

# 국내 주식 시장 분류 코드
#   J  = KRX(한국거래소) 단독
#   NX = 넥스트레이드(ATS, 대체거래소) 단독
#   UN = 통합(KRX+NXT) — MTS 차트와 동일한 합산 시세(거래량=KRX+NXT)
# 넥스트레이드 출범(2025-03) 이후 MTS는 통합(UN) 시세를 표시하므로 UN 을 기본으로 한다.
# ⚠️ 단, NXT 미상장 종목은 UN 조회 시 빈 응답 → fetcher가 J(KRX)로 폴백한다.
DOMESTIC_MARKET_CODE = "UN"
KRX_MARKET_CODE = "J"  # UN 빈응답(비-NXT 종목) 폴백용
TR_DAILY_ITEMCHART = "FHKST03010100"

_MAX_RETRIES = 5
_TIMEOUT = 15
_POOL_SIZE = 4  # 단일 호스트(KIS) 대상 keep-alive 연결 재사용 풀 크기


class KISConnectionError(RuntimeError):
    """재시도(5xx·타임아웃·연결오류)를 모두 소진한 '연결계열' 실패.

    RuntimeError 서브클래스라 기존 `except RuntimeError`/`except Exception`
    처리와 완전 호환된다(Regression 안전). 상위 수집 루프는 이 타입만
    '재시도 가능(연결계열/throttle 신호)'으로 분류해 적응형 쿨다운·2차 재시도
    대상으로 삼는다. 4xx·rt_cd(논리 오류)는 requests.HTTPError 로 즉시 실패하므로
    이 타입에 들어오지 않는다(영구 실패 종목이 쿨다운을 유발하지 않게 하는 게이트).
    """


class KISClient:
    def __init__(self, config: KISConfig | None = None):
        self.cfg = config or get_kis_config()
        if not self.cfg.is_configured:
            raise RuntimeError("KIS 자격증명(KIS_APP_KEY/SECRET)이 설정되지 않았습니다.")
        self._redis = redis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
        )
        self._token_key = f"kis:token:{self.cfg.mode}:{self.cfg.app_key[:10]}"
        # 단일 호스트(openapi.koreainvestment.com) 대상 커넥션 재사용:
        # Session 없이 매 요청마다 새 TCP+TLS 핸드셰이크를 열면, 전종목(수천 건)
        # 순회 시 소켓/핸드셰이크가 폭주해 연결오류(Max retries exceeded)로 이어질 수
        # 있다. keep-alive 로 소수 연결을 재사용한다. 재시도는 _request_with_retry
        # 가 전담하므로 어댑터 자체 재시도는 0(이중 재시도 방지).
        self._session = requests.Session()
        _adapter = HTTPAdapter(
            pool_connections=_POOL_SIZE, pool_maxsize=_POOL_SIZE, max_retries=0
        )
        self._session.mount("https://", _adapter)
        self._session.mount("http://", _adapter)

    # --- 토큰 ---
    def _issue_token(self) -> str:
        url = f"{self.cfg.base_url}/oauth2/tokenP"
        resp = self._session.post(
            url,
            json={
                "grant_type": "client_credentials",
                "appkey": self.cfg.app_key,
                "appsecret": self.cfg.app_secret,
            },
            headers={"content-type": "application/json"},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        token = data["access_token"]
        # expires_in(초) 여유 60초 차감해 캐시
        ttl = max(60, int(data.get("expires_in", 86400)) - 60)
        self._redis.set(self._token_key, token, ex=ttl)
        return token

    def get_token(self) -> str:
        cached = self._redis.get(self._token_key)
        if cached:
            return cached
        return self._issue_token()

    def _headers(self, tr_id: str) -> dict:
        return {
            "content-type": "application/json; charset=utf-8",
            "authorization": f"Bearer {self.get_token()}",
            "appkey": self.cfg.app_key,
            "appsecret": self.cfg.app_secret,
            "tr_id": tr_id,
            "custtype": "P",  # 개인
        }

    # --- 국내 일봉 ---
    def get_daily_ohlcv(
        self,
        ticker: str,
        start_yyyymmdd: str,
        end_yyyymmdd: str,
        market_code: str = DOMESTIC_MARKET_CODE,
    ) -> list[dict]:
        """국내 일봉 원시 행(output2) 리스트 반환. 1회 호출 최대 ~100행.

        market_code: UN(통합·기본) | J(KRX) | NX(넥스트레이드). NXT 미상장 종목은
        UN 이 빈 응답이므로 상위(fetcher)에서 J 폴백을 처리한다.
        """
        url = (
            f"{self.cfg.base_url}"
            "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"
        )
        params = {
            "FID_COND_MRKT_DIV_CODE": market_code,
            "FID_INPUT_ISCD": ticker,
            "FID_INPUT_DATE_1": start_yyyymmdd,
            "FID_INPUT_DATE_2": end_yyyymmdd,
            "FID_PERIOD_DIV_CODE": "D",
            "FID_ORG_ADJ_PRC": "0",  # 수정주가
        }
        data = self._request_with_retry("get", url, TR_DAILY_ITEMCHART, params)
        return data.get("output2") or []

    def _request_with_retry(self, method: str, url: str, tr_id: str, params: dict) -> dict:
        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                resp = self._session.request(
                    method, url, headers=self._headers(tr_id), params=params, timeout=_TIMEOUT
                )
            except (requests.ConnectionError, requests.Timeout) as e:
                last_exc = e
                time.sleep(1.5**attempt)
                continue

            if 400 <= resp.status_code < 500:
                # 4xx는 즉시 실패(무의미한 재시도 방지)
                raise requests.HTTPError(f"KIS HTTP {resp.status_code}: {resp.text[:200]}")
            if resp.status_code >= 500:
                last_exc = requests.HTTPError(f"KIS HTTP {resp.status_code}")
                time.sleep(1.5**attempt)
                continue

            body = resp.json()
            if str(body.get("rt_cd", "0")) != "0":  # KIS 논리 오류 코드
                raise requests.HTTPError(
                    f"KIS rt_cd={body.get('rt_cd')} msg={body.get('msg1')}"
                )
            return body
        # 연결계열 소진 → 전용 타입. repr()로 errno/원인을 보존해 상위 로그에서
        # [Errno 99]/Connection reset/Read timed out 등을 그대로 진단할 수 있게 한다.
        raise KISConnectionError(f"KIS 요청 실패(재시도 소진): {last_exc!r}")

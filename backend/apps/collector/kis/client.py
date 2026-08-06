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

from shared.kis_config import KISConfig, get_kis_config

# 국내 주식 시장 분류 코드
#   J  = KRX(한국거래소) 단독
#   NX = 넥스트레이드(ATS, 대체거래소) 단독
#   UN = 통합(KRX+NXT) — MTS 차트와 동일한 합산 시세(거래량=KRX+NXT)
# 넥스트레이드 출범(2025-03) 이후 MTS는 통합(UN) 시세를 표시하므로 UN 을 기본으로 한다.
DOMESTIC_MARKET_CODE = "UN"
TR_DAILY_ITEMCHART = "FHKST03010100"

_MAX_RETRIES = 5
_TIMEOUT = 15


class KISClient:
    def __init__(self, config: KISConfig | None = None):
        self.cfg = config or get_kis_config()
        if not self.cfg.is_configured:
            raise RuntimeError("KIS 자격증명(KIS_APP_KEY/SECRET)이 설정되지 않았습니다.")
        self._redis = redis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True
        )
        self._token_key = f"kis:token:{self.cfg.mode}:{self.cfg.app_key[:10]}"

    # --- 토큰 ---
    def _issue_token(self) -> str:
        url = f"{self.cfg.base_url}/oauth2/tokenP"
        resp = requests.post(
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
        self, ticker: str, start_yyyymmdd: str, end_yyyymmdd: str
    ) -> list[dict]:
        """국내 일봉 원시 행(output2) 리스트 반환. 1회 호출 최대 ~100행."""
        url = (
            f"{self.cfg.base_url}"
            "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"
        )
        params = {
            "FID_COND_MRKT_DIV_CODE": DOMESTIC_MARKET_CODE,
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
                resp = requests.request(
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
        raise RuntimeError(f"KIS 요청 실패(재시도 소진): {last_exc}")

# 키움 REST 클라이언트 + 실측 도구 설계 (2026-11-16)

키움 연동 4단계 중 1단계. 전체 순서: ① 클라이언트·실측(이 문서) → ② 연기금 프리셋(KIS `FHPTJ04160001`) → ③ 일봉 폴백(실측이 "같음"일 때만) → ④ 대차잔고·테마 등 키움 데이터.
기획 문서: [`docs/kiwoom_setup_and_dev_spec.md`](../../kiwoom_setup_and_dev_spec.md).

## 결정 (사용자 2026-11-16)
- 목적: KIS 장애 대비(폴백) + 키움에만 있는(또는 키움이 나은) 데이터. 종목 분할 수집은 하지 않는다(출처마다 기준이 달라짐).
- **KIS·키움 모두 실전 키만** 쓴다 → 키움 모의(mock) 분기 없음. KIS 코드는 이번에 바꾸지 않는다(서버 env `KIS_MODE=prod`).
- 키움은 **상용 서버 IP만 화이트리스트** → 키움 호출은 상용에서만. 키가 없으면 꺼짐 — 개발 서버 동작은 그대로(상용 정상화 전까지 개발 서버 자체 수집 유지).

## 공식 명세 요점 (키움 GitHub `Kiwoom-Securities/Kiwoom-REST-API` `kiwoom/_data/kiwoom_api_spec.json`, c7a3d25)
- REST `https://api.kiwoom.com`. 모든 조회는 `POST` + JSON body, TR 은 헤더 `api-id`(예 `ka10081`), `authorization: Bearer <token>`.
- 토큰 `au10001` `POST /oauth2/token` body `{grant_type: "client_credentials", appkey, secretkey}` → `{token, token_type, expires_dt(YYYYMMDDHHmmss), return_code, return_msg}`. 유효 24시간.
- 연속조회: 응답 **헤더** `cont-yn=Y`·`next-key` → 다음 요청 헤더에 그대로.
- 한도: TR 마다 초당 5회(그 밖에 전체·그룹 한도 1700·1701·1702 — 수치 미공개).
- 오류(`return_code`≠0): 8005 토큰 무효, 8010 토큰 발급 IP≠요청 IP, 1700번대 한도 초과, 1902·1903 종목코드·거래소 구분 오류.
- 거래소 구분: 종목코드 접미사 — 없음=KRX, `_NX`=NXT, `_AL`=SOR(통합). `_AL` 일봉 거래량이 KRX+NXT 합산(KIS UN·MTS 와 같은지)은 **미확인** → 실측 대상.
- `ka10081` 주식일봉차트 `/api/dostk/chart` body `{stk_cd, base_dt(YYYYMMDD), upd_stkpc_tp("1"=수정주가)}` → 배열(키 이름은 명세 확인) 각 행 `dt, open_pric, high_pric, low_pric, cur_prc, trde_qty(주), trde_prica(백만원)` — 값에 부호(+/-)가 붙을 수 있다. `base_dt` 부터 과거로 연속조회.
- `ka10099` 종목정보 리스트 `/api/dostk/stkinfo` body `{mrkt_tp}`(0 코스피, 10 코스닥) → 각 행 `code, name, …, nxtEnable(Y/N)`.

## 구성

### 1. 설정 `backend/shared/kiwoom_config.py`
- `KiwoomConfig(app_key, app_secret, rate_per_sec)` frozen dataclass, `base_url="https://api.kiwoom.com"`, `ws_url="wss://api.kiwoom.com:10000"`, `is_configured`(키·시크릿 둘 다 있을 때).
- `get_kiwoom_config()` — env `KIWOOM_APP_KEY`, `KIWOOM_APP_SECRET`, `KIWOOM_RATE_PER_SEC`(기본 4, 1~5로 자름).
- `kis_config.py` 와 같은 모양.

### 2. 클라이언트 `backend/apps/collector/kiwoom/client.py`
- `KiwoomClient(config=None, limiter=None)` — `requests.Session`, 공유 `RateLimiter`(`apps/collector/rate_limit.py`)는 요청(재시도 포함)마다 acquire. 미설정이면 `KiwoomNotConfigured` 를 낸다.
- 토큰: Redis(`REDIS_URL`) 키 `kiwoom:token:prod:{app_key[:10]}`, TTL = `expires_dt` − 지금 − 600초(최소 60초). 캐시가 있으면 재사용.
- `post(api_id, path, body, *, cont_key=None) -> KiwoomResponse(data, cont_yn, next_key)`:
  - `return_code` 8005 → 캐시 삭제·재발급 후 **1회** 재시도
  - 8010 → `KiwoomIpError`("키움은 등록된 IP(상용 서버)에서만 호출할 수 있어요") 즉시 실패
  - 1700·1701·1702 → 백오프 재시도(최대 3회)
  - HTTP 5xx·타임아웃·연결 오류 → 백오프 재시도(최대 3회, `1.5**n` 초 — KIS 와 같음)
  - 그 밖의 4xx·`return_code`≠0 → `KiwoomApiError(code, msg)` 즉시 실패
- `paginate(api_id, path, body, list_key, max_pages)` — `cont-yn=Y` 동안 이어 받아 리스트를 합친다.
- 메서드: `get_daily_chart(stk_cd, base_dt, *, adjusted=True, max_pages=1) -> list[dict]`(ka10081), `list_stocks(mrkt_tp) -> list[dict]`(ka10099, 끝까지).

### 3. 정규화 `backend/apps/collector/kiwoom/normalize.py` (순수 함수)
- `to_int(s)` — 부호·쉼표·공백 제거, 빈 값은 0. `to_price(s)` = `abs(to_int(s))`.
- `daily_row(raw) -> {date: "YYYY-MM-DD", open, high, low, close, volume, trading_value}` — `trading_value` 는 백만원 × 1,000,000(원). KIS 일봉 정규화 결과와 같은 키(`apps/collector/kis/fetcher.py` 확인 후 맞춤).
- `stock_suffix(code, nxt_enable)` — 통합 조회용 코드(`_AL` 또는 그대로). 실측 뒤 ③단계에서 쓴다.

### 4. 실측 도구 `python -m apps.collector.kiwoom.probe`
- 인자: `--ticker`(기본 005930), `--date`(기본 20260805), `--non-nxt`(기본 293490).
- 출력(키·토큰 값은 절대 출력하지 않음):
  1. `[OK] 토큰 발급(또는 캐시) — 만료 YYYY-MM-DD HH:MM`
  2. 표: 구분(KRX / `_NX` / `_AL` / CH `daily_prices` FINAL) × (시·고·저·종·거래량·거래대금) + `_AL`과 CH 의 종가·거래량 일치 여부(✅/❌)
  3. NXT 미상장 종목에 `_AL`·접미사 없음 결과(값 또는 오류코드)
  4. `ka10099` 코스피·코스닥 종목 수와 `nxtEnable=Y` 수
- CH 연결이 안 되면 CH 줄만 "조회 불가"로 두고 계속.
- 결과를 `docs/kiwoom_setup_and_dev_spec.md` 에 기록할 수 있게 마지막에 요약 한 블록.

## 하지 않는 것
- 수집 파이프라인 연결, `DATA_COLLECTOR_PROVIDER`(③단계), WebSocket·조건검색, KIS 코드 변경.

## 테스트 (pytest, HTTP 는 모두 가짜)
- 설정: 기본 속도 4, 범위 자르기, 미설정 판정
- 토큰: 발급·캐시 재사용·TTL 계산·8005 재발급 1회·8010 즉시 실패
- 요청: 연속조회 합치기(cont-yn/next-key 헤더 전달), 5xx·타임아웃 재시도 후 성공/포기, 1700 백오프, 기타 오류 즉시 실패, 미설정 시 예외
- 정규화: 부호·쉼표·빈 값, 백만원→원, 날짜 형식
- 실측: 비교 판정 함수(일치/불일치), 출력에 키·토큰 문자열이 없음

## 문서
- `docs/kiwoom_setup_and_dev_spec.md` 정정: 상용 공인 IP 삭제(`<상용 서버 IP>`), 공식 명세와 다른 부분(초당 5회, `/oauth2/token`·`secretkey`, 8010, 모의 없음), 상용 서버 실제 경로·사용자·브랜치(`~/stock_app`, ubuntu, main), 4절(상용 전용 수집·DB 공유)은 "상용 정상화 후 별도 설계로 보류", 실측 실행 방법.
- `backend/.env.example`: `KIWOOM_APP_KEY=`, `KIWOOM_APP_SECRET=`, `KIWOOM_RATE_PER_SEC=`.
- README 외부 API 키 절에 키움 한 줄.

## 실측 실행 (구현 후, 상용 서버)
`/opt/stock_app/env/.env.production` 에 `KIWOOM_APP_KEY`·`KIWOOM_APP_SECRET` → 반영(git pull·env 복사·빌드·`up -d`) → `docker compose -f docker-compose.prod.yml run --rm celery_worker python -m apps.collector.kiwoom.probe`

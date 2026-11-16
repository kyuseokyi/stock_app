# 키움증권 REST API 연동 가이드 및 개발 명세서

> **문서 목적**: 한국투자증권(KIS) API와 키움증권 REST API를 병행하여 안정적인 멀티 브로커 시세 수집 파이프라인을 구축하기 위한 **사용자 준비 사항(Checklist)** 및 **클로드코드(Claude Code) 개발 구현 명세서**입니다.

> **정정 (2026-11-16, 공식 명세 기준)** — 키움 공식 명세(GitHub `Kiwoom-Securities/Kiwoom-REST-API` `kiwoom/_data/kiwoom_api_spec.json`, 커밋 c7a3d25)와 결정 사항에 맞춰 아래를 고쳤다. 설계: [`docs/superpowers/specs/2026-11-16-kiwoom-client-probe-design.md`](superpowers/specs/2026-11-16-kiwoom-client-probe-design.md)
> - **실전 키만** 쓴다(KIS·키움 모두) → `KIWOOM_MODE`·모의(mock) 도메인 분기 없음. 계좌번호도 시세 조회에는 필요 없다(`KIWOOM_ACCOUNT_NO` 삭제).
> - 한도: **TR 마다 초당 5회**(그 밖에 전체·그룹 한도 — 오류 1700·1701·1702, 수치 미공개). 기본 `KIWOOM_RATE_PER_SEC=4`(1~5로 자름).
> - 토큰: `au10001` `POST /oauth2/token`, body `grant_type=client_credentials`·`appkey`·**`secretkey`**(KIS 의 `appsecret` 과 이름이 다름) → `token`·`expires_dt`(YYYYMMDDHHmmss, KST). 유효 24시간.
> - 모든 조회는 `POST` + JSON body, TR 은 헤더 `api-id`. 연속조회는 응답 **헤더** `cont-yn`·`next-key` 를 다음 요청 헤더에 그대로.
> - IP 불일치는 HTTP 403 이 아니라 **오류 8010**(토큰 발급 IP ≠ 요청 IP)으로 온다. 8005 = 토큰 무효.
> - 거래소 구분은 종목코드 접미사: 없음=KRX, `_NX`=NXT, `_AL`=SOR(통합). `_AL` 거래량이 KIS UN(KRX+NXT 합산)과 같은지는 **실측 대상**(아래 [Step 3]).
> - 진행 순서: ① 클라이언트·실측 도구(완료) → ② 연기금 프리셋 → ③ 일봉 폴백(**완료 2026-11-16** — 아래 "③단계 일봉 폴백") → ④ 대차잔고·테마 등 키움 데이터. **종목 분할 수집은 하지 않는다**(출처마다 기준이 달라짐).

---

## 1. 개요 및 병행 수집(Hybrid) 전략

현재 시스템은 한국투자증권(KIS) API를 주 원천으로 사용하고 있습니다. 키움증권 REST API를 함께 연동하면 다음과 같은 시너지를 얻을 수 있습니다.

```
                  ┌──────────────────────┐
                  │ Celery Daily Beat    │
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   ┌─────────────────┐               ┌─────────────────┐
   │  KIS Fetcher    │               │ Kiwoom Fetcher  │
   │ (초당 15~20건)  │               │ (초당 5~10건)   │
   └────────┬────────┘               └────────┬────────┘
            │                                 │
            └─────────► [데이터 정규화] ◄─────┘
                             │
                             ▼
              ClickHouse (`daily_prices` FINAL)
              PostgreSQL (`stock_meta`, 수급 등)
```

1. **API 호출 한도(Rate Limit) 분산**: 전종목(2,500+개) 시세 수집 시 KIS와 키움에 분산 요청하여 수집 시간 단축
2. **장애 대응(Failover/Fallback)**: 증권사 정기 점검 또는 특정 API 일시 장애 시 자동 전환
3. **특화 데이터 결합**: 키움의 영웅문 조건검색식 연동, 투자자별 실시간 수급 등 차별화된 데이터 확보

---

## 2. 사용자가 준비해야 할 사항 (User Checklist)

클로드코드가 백엔드 연동 작업을 원활히 진행할 수 있도록 아래 항목을 확인하고 준비해 주세요.

### [체크리스트 1] 키움 개발자 센터 계정 및 권한
- [ ] **App Key 및 App Secret 발급**: 발급 완료 (안전한 곳에 보관)
- [x] **실전 키만 사용** (정정): 모의투자 키·도메인은 쓰지 않는다. 운영 도메인 `https://api.kiwoom.com` 고정.
- ~~**계좌번호 확인**~~ (정정): 시세 조회 TR 에는 계좌번호가 필요 없다.
- [x] **허용 IP 등록 (완료)**:
  - **상용 오라클 서버 인스턴스 공인 IP 등록 완료**.
  - ⚠️ 키움 REST API는 등록된 IP에서만 호출 가능하므로, **실제 API 통신은 상용 오라클 서버에서만 발생**합니다. (등록 밖 IP 는 오류 8010 등으로 거부 — 로컬·개발 서버에서는 호출하지 않는다)

### [체크리스트 2] 환경 변수(.env) 설정
(정정) **상용 서버의 `/opt/stock_app/env/.env.production` 에만** 아래 환경변수를 추가합니다. 로컬·개발 서버는 키를 넣지 않습니다(넣어도 IP 밖이라 호출 불가 — 비워 두면 키움 기능은 꺼짐). Git 커밋 금지, 이름 목록은 `backend/.env.example`.

```env
# 키움증권 REST API (실전 키만)
KIWOOM_APP_KEY=발급받은_키움_APP_KEY
KIWOOM_APP_SECRET=발급받은_키움_APP_SECRET
KIWOOM_RATE_PER_SEC=4  # 초당 호출 상한(기본 4, 1~5로 자름 — 키움 한도 TR 마다 초당 5회)
```
- ~~`KIWOOM_ACCOUNT_NO`·`KIWOOM_MODE`~~ 는 쓰지 않는다(정정).
- `DATA_COLLECTOR_PROVIDER` 는 ③단계(일봉 폴백)에서 정한다 — 지금은 넣지 않는다. `hybrid`(분할 수집)는 하지 않기로 했다.

### [체크리스트 3] 키움 REST API 명세서/자료 준비
- [x] (정정) 공식 명세 확보: GitHub `Kiwoom-Securities/Kiwoom-REST-API` `kiwoom/_data/kiwoom_api_spec.json`(c7a3d25)
  - 토큰 `au10001` `POST /oauth2/token`
  - 일봉 `ka10081` `POST /api/dostk/chart` — body `stk_cd`·`base_dt`(YYYYMMDD)·`upd_stkpc_tp`("1"=수정주가), 응답 배열 `stk_dt_pole_chart_qry`, 행 `dt`·`open_pric`·`high_pric`·`low_pric`·`cur_prc`·`trde_qty`(주)·`trde_prica`(백만원) — 값에 부호(+/-)가 붙는다. `base_dt` 부터 과거로 연속조회
  - 종목 리스트 `ka10099` `POST /api/dostk/stkinfo` — body `mrkt_tp`(0 코스피, 10 코스닥), 응답 배열 `list`, 행 `code`·`name`·…·`nxtEnable`(Y/N)
  - 오류 코드: 명세 `error_codes`(8005 토큰 무효, 8010 IP 불일치, 1700~1702 한도, 1902·1903 종목코드·거래소 구분)

---

## 3. 클로드코드(Claude Code) 개발 구현 명세서

클로드코드 세션을 열었을 때 아래 5단계 순서대로 개발을 진행하도록 지시하시면 됩니다.

### Phase 1: 환경 설정 모듈 구현
- **파일**: `backend/shared/kiwoom_config.py`
- **내용**:
  - `KISConfig`와 대칭되는 `KiwoomConfig` 데이터클래스 구현 — **(완료)**
  - (정정) 모드 분기 없음: `https://api.kiwoom.com`·`wss://api.kiwoom.com:10000` 고정, `rate_per_sec`(기본 4, 1~5)
  - `get_kiwoom_config()` 팩토리 함수 제공

### Phase 2: 저수준 REST 클라이언트 구현
- **파일**: `backend/apps/collector/kiwoom/client.py`
- **내용**:
  - `requests.Session` 기반 Keep-Alive 풀링 구현
  - **OAuth 2.0 토큰 발급 및 Redis 공유 캐싱**:
    - (정정) Redis 키: `kiwoom:token:prod:{app_key 앞 10자}`, 값 `{token, expires_dt}`, TTL = 만료(KST) − 지금 − 10분(최소 60초)
  - **Rate Limiter (속도 제어)**: 공유 `RateLimiter`(`apps/collector/rate_limit.py`), 초당 `KIWOOM_RATE_PER_SEC`(기본 4) — 토큰·재시도 포함 요청마다
  - **재시도**: 5xx·타임아웃·연결 오류·한도(1700~1702)만 백오프(최대 3회, `1.5**n` 초). 8005 는 토큰 재발급 후 1회, 8010 과 그 밖의 오류는 즉시 실패
  - **(완료)** `KiwoomClient.post`·`paginate`·`get_daily_chart`(ka10081)·`list_stocks`(ka10099)

### Phase 3: 데이터 수집기(Fetcher) 및 정규화
- (정정) 정규화는 `backend/apps/collector/kiwoom/normalize.py`(완료, 순수 함수 `to_int`·`to_price`·`daily_row`·`stock_suffix`). `fetcher.py` 는 ③단계(일봉 폴백)에서 실측 결과를 보고 만든다.
- **내용**:
  - `fetch_daily_ohlcv(ticker, start_date, end_date)`: 일봉 조회 — ③단계
  - **데이터 정규화(Normalize)**:
    - 키움의 응답 필드명을 시스템 공통 필드(`date`, `open`, `high`, `low`, `close`, `volume`, `trading_value`)로 매핑 — KIS `fetcher._to_ohlcv` 와 같은 타입(`date`=날짜 객체, 가격 float, 거래량 int), `trading_value` 는 백만원×1,000,000(원). CH `daily_prices` 에는 거래대금 컬럼이 아직 없다
    - 기존 ClickHouse `daily_prices` 적재 규격과 100% 일치시킴 (ReplacingMergeTree 멱등 적재)
  - `fetch_investor_flow(ticker)`: 투자자별 수급 조회 (개인/외국인/기관)

### Phase 4: 멀티 브로커 통합 및 폴백(Fallback) 파이프라인
- **파일**: `backend/apps/collector/provider.py`, `backend/apps/collector/tasks/pipeline.py`
- **내용**:
  - `DATA_COLLECTOR_PROVIDER` 설정에 따라 분기:
    - `kis`: 기존 KIS 단독 수집 (Regression 100% 방지)
    - `kiwoom`: 키움 단독 수집
    - ~~`hybrid` 분할 수집~~ (정정: **하지 않음** — 출처마다 기준이 달라짐)
    - **장애 폴백**: KIS 요청 실패(한도 초과, 5xx) 시 키움으로 — ③단계, **실측에서 `_AL` 이 KIS UN 과 같을 때만**
  - (정정) **③단계 완료(2026-11-16)** — `DATA_COLLECTOR_PROVIDER`·`provider.py` 없이, 전종목 일봉·백필에서 KIS 가 다 끝난 뒤 실패·빈 응답 종목만 키움으로 채운다. 아래 "③단계 일봉 폴백" 참고

### Phase 5: 단위 테스트 및 검증
- (정정) **파일**: `backend/tests/test_kiwoom_config.py`·`test_kiwoom_client.py`·`test_kiwoom_normalize.py`·`test_kiwoom_probe.py`(완료, HTTP 전부 가짜)
- **내용**:
  - Mock HTTP 응답을 이용한 토큰 발급, Redis 캐싱, 일봉 파싱 단위 테스트
  - Rate Limiter 동작 검증
  - KIS 일봉 결과와 키움 일봉 결과의 정합성 표본 비교

---

## 4. 상용 수집 + 개발서버(맥미니) 데이터 공유 아키텍처 (IP 제한 최적화)

> ⏸️ **보류 (2026-11-16)** — 이 절(상용 전용 수집·개발 서버가 상용 DB 를 읽기 전용으로 공유)은 **상용 서버 정상화 후 별도 설계로 다룬다.** 그 전까지 개발 서버는 지금처럼 자체 수집을 유지하고, 키움 호출만 상용 서버에서 한다(키 없는 서버는 키움 기능이 꺼짐).

사용자 환경의 서버 구성:
- **상용 서버**: **오라클 클라우드 인스턴스** (`funnotedaily.com`, 공인 IP 등록)
- **개발 서버**: **맥미니 인텔 서버** (`haezean.com`)
- **로컬 개발 환경**: **내 맥(Mac)**

주식 데이터는 **오직 상용 서버(오라클 클라우드)에서만 수집**하고, **개발 서버(맥미니)와 로컬 PC는 상용 서버의 주식 데이터를 공유(Read-Only)**하여 사용합니다.

```
┌─────────────────────────────────────────────────────────────┐
│ [상용 서버] 오라클 클라우드 인스턴스 (공인 IP 등록)             │
│                                                             │
│  - Celery Beat / Worker 가동 (전종목 시세 수집 독점 전담)     │
│  - KIS REST API + 키움증권 REST API 호출 (IP 화이트리스트)  │
│  - ClickHouse (8123) 시세 적재 & PostgreSQL (5432) 메타 적재 │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               │ (터널링 / 안전한 DB 연결)     │ (Cloudflare SSH Tunnel)
               ▼                              ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│ [개발 서버] 맥미니 (haezean)  │ │ [로컬 PC] 내 맥 (개발 환경)  │
│                              │ │                              │
│ - 주식 데이터 직접 수집 안 함 │ │ - ./scripts/dev-db-tunnel.sh │
│   (중복 수집·IP 차단 방지)   │ │ - 상용 ClickHouse 읽기 조회  │
│ - 상용 오라클 DB(CH/PG)를    │ │ - 수집 로직은 Mock 테스트    │
│   Read-Only로 연결하여       │ │ - API/UI 개발에 상용 시세     │
│   개발 백엔드·웹 서비스 구동 │ │   그대로 활용                │
└──────────────────────────────┘ └──────────────────────────────┘
```

### 세부 운영 원칙
1. **상용 서버 (오라클 클라우드) — 데이터 수집 독점 전담**:
   - 키움증권 REST API는 오라클 클라우드 IP만 승인하므로, **Celery Beat 및 Collector 워커는 오라클 클라우드에서만 실행**됩니다.
   - KIS와 키움 API를 조합하여 매일 정규 시세(일봉, 분봉, 수급 등)를 수집하고 상용 ClickHouse와 PostgreSQL에 적재합니다.

2. **개발 서버 (맥미니) — 상용 데이터 참조**:
   - 맥미니에서는 주식 수집 워커(`celery beat`, `collector worker`)를 절대 실행하지 않습니다. (동시 호출로 인한 API 키 한도 초과 및 차단 원천 방지)
   - 맥미니의 백엔드 서비스(`stock_api`, `blog`, `admin_web` 등)는 **상용 오라클 서버의 ClickHouse(시세)와 PostgreSQL(종목 메타)을 읽기 전용(Read-Only)으로 바라보도록 설정**하여 개발/테스트 서비스를 제공합니다.

3. **로컬 개발 PC (내 맥) — 터널링 조회 및 Mock 개발**:
   - 로컬 개발 시 `./scripts/dev-db-tunnel.sh`를 통해 상용 오라클 서버(또는 개발서버)의 DB를 터널링하여 상용 데이터를 확인합니다.
   - 키움 수집기 코드 개발 및 로직 테스트는 **Mock 응답 fixture(pytest-mock)**를 사용하여 오프라인으로 안전하게 검증합니다.

---

## 5. 핵심 준수 규칙 (Regression 방지 & 보안)

1. **IP 화이트리스트 준수**:
   - 로컬 PC에서 키움 API를 직접 호출하는 스케줄러/루프를 절대 실행하지 않습니다 (IP 차단 및 오라클 서버 호출 장애 방지).
2. **기존 KIS 동작 100% 보존**:
   - 키움 모듈이 추가되더라도 기존 `KIS_APP_KEY` 기반 단독 파이프라인은 설정 변경 없이 완벽히 동작해야 합니다 (`DATA_COLLECTOR_PROVIDER=kis` 기본 호환).
3. **Redis 키 네임스페이스 격리**:
   - 토큰 및 상태 캐시: `kis:*` 와 `kiwoom:*` 로 철저히 분리.
4. **NXT(대체거래소) 시세 차이 주의**:
   - KIS는 `UN`(KRX+NXT 통합) 시세를 지원합니다. (정정) 키움은 종목코드 접미사로 거래소를 고른다 — 없음=KRX, `_NX`=NXT, `_AL`=SOR(통합). `_AL` 이 KIS UN 과 같은지는 실측 도구로 확인한다([Step 3]). 수집 로그에 출처(`source='kiwoom'`)를 남기는 건 ③단계.

---

## 6. 사용자를 위한 단계별 진행 절차 및 확인 방법 (Playbook)

사용자께서 전체 과정을 한눈에 파악하고 검증할 수 있는 구체적인 실행 절차입니다.

### [Step 1] 클로드코드(Claude Code) 개발 시작 및 지시
로컬 터미널에서 Claude Code를 실행한 후 아래와 같이 입력하여 작업을 지시합니다.

```bash
# 로컬 터미널에서 Claude Code 실행
claude
```

**Claude Code 프롬프트 입력 예시:**
> "docs/kiwoom_setup_and_dev_spec.md 문서를 읽고 Phase 1부터 Phase 3까지 개발을 진행해줘.
> 키움 REST 클라이언트(OAuth 토큰 Redis 캐싱, Rate Limiter)와 시세 Fetcher를 작성하고, 
> 로컬 환경은 IP 미등록 상태이므로 pytest-mock을 활용한 단위 테스트로 검증해줘. 기존 KIS 코드는 수정 없이 보존해야 해."

---

### [Step 2] 상용 오라클 서버 배포 및 키움 키 설정
클로드코드가 로컬에서 단위 테스트를 통과하고 작업을 마치면 오라클 상용 서버에 반영합니다.

(정정) 상용 서버는 사용자 `ubuntu`, 저장소 `~/stock_app`, 브랜치 `main` 이다. 코드가 `main` 에 머지된 뒤 진행한다.

```bash
# 1. 상용 오라클 서버 접속 (Termius 또는 SSH)
ssh ubuntu@<상용 서버 IP>

# 2. 코드 풀
cd ~/stock_app
git pull origin main

# 3. 상용 env 에 키움 키 등록
nano /opt/stock_app/env/.env.production
# 아래 내용 추가 후 저장 (Ctrl+O, Enter, Ctrl+X):
# KIWOOM_APP_KEY=실제_키움_APP_KEY
# KIWOOM_APP_SECRET=실제_키움_APP_SECRET
# KIWOOM_RATE_PER_SEC=4

# 4. 반영 — docs/deploy/owner-todo.md 의 "서버 반영 순서"를 그대로 따른다
#    (env 복사: .env.production→backend/, compose.env→.env, chown ubuntu:docker → build → 마이그레이션 → up -d → ps)
#    celery_worker 는 env_file 로 backend/.env.production 을 읽으므로 env 복사가 빠지면 키가 안 들어간다.
```

---

### [Step 2-1] 개발 서버(맥미니) 설정 — 상용 DB 참조

> ⏸️ **보류** — 4절과 함께 상용 정상화 후 별도 설계로 다룬다. 지금은 하지 않는다(개발 서버는 자체 수집 유지).

개발 서버(맥미니, `haezean.com`)에서는 데이터 수집기를 돌리지 않고, 오라클 상용 서버의 ClickHouse/PostgreSQL을 바라보도록 설정합니다.

- 맥미니의 백엔드 env (`/opt/stock_app/env/.env.production` on Mac mini)에서:
  - `CLICKHOUSE_HOST`: 상용 오라클 서버 주소 (또는 상용 Cloudflare Tunnel 주소)
  - `DATABASE_URL`: 상용 PostgreSQL 주소 (Read-Only)
  - Celery Beat/수집 워커는 실행 제외 (API 서버 `stock_api`, `blog`, `auth`만 실행)

---

### [Step 3] 상용 오라클 서버에서 실서버 1종목 E2E 연동 테스트
(정정) 실측 도구 `apps.collector.kiwoom.probe` 를 상용 서버의 `celery_worker` 컨테이너에서 실행합니다(키·토큰 값은 출력하지 않음).

```bash
cd ~/stock_app
docker compose -f docker-compose.prod.yml run --rm celery_worker python -m apps.collector.kiwoom.probe
# 옵션: --ticker 005930 --date 20260805 --non-nxt 293490 (기본값)
```
- **출력**:
  1. `[OK] 토큰 발급(또는 캐시) — 만료 YYYY-MM-DD HH:MM` — `[FAIL] … 8010` 이면 등록 IP 밖(상용 서버에서 실행했는지 확인)
  2. 표: KRX / `_NX` / `_AL` / CH `daily_prices` FINAL 의 시·고·저·종·거래량·거래대금, `_AL vs CH(KIS UN)` 종가·거래량 ✅/❌, `KRX+NXT 거래량 합 = _AL` ✅/❌
  3. NXT 미상장 종목(`293490`)의 `_AL`·접미사 없음 결과(값 또는 오류코드)
  4. `ka10099` 코스피·코스닥 종목 수와 `nxtEnable=Y` 수
  5. 마지막 "요약" 블록 — 아래 "실측 결과"에 붙여 넣는다
- 키가 없으면 "키움 키가 설정되지 않았어요" 안내만 내고 호출 없이 끝난다. CH 연결이 안 되면 CH 줄만 "조회 불가".
- **판정**: `_AL vs CH` 가 종가·거래량 모두 ✅ 면 ③단계(일봉 폴백)를 진행, ❌ 면 폴백은 보류.

#### 실측 결과
**1차 실측 (2026-11-16 11:11 KST, 상용 서버)** — 종목 005930, 기준일 2026-08-05, 수정주가

| 구분 | 시가 | 고가 | 저가 | 종가 | 거래량 | 거래대금(원) |
|---|---|---|---|---|---|---|
| KRX (`005930`) | 254,000 | 254,500 | 244,000 | 246,000 | 22,577,128 | 5,610,076,000,000 |
| NXT (`005930_NX`) | 250,000 | 254,500 | 240,000 | 242,000 | 20,781,043 | 5,156,089,000,000 |
| SOR (`005930_AL`) | 250,000 | 254,500 | 240,000 | 242,000 | 43,358,171 | 10,766,165,000,000 |
| CH `daily_prices` | (상용 초기 데이터 준비 전이라 행 없음) | | | | | |

- **`_AL` 거래량·거래대금 = KRX + NXT 합** ✅ (43,358,171 / 10,766,165백만)
- **`_AL` = KIS UN**: CH 직접 비교는 불가였지만, CLAUDE.md 에 검증해 둔 KIS UN 값(005930 2026-08-05 종가 242,000·거래량 43.3M = MTS)과 일치 ✅
- `_AL` 의 시가·저가·종가는 NXT 쪽(08:00 먼저 열고 20:00 늦게 닫음) — MTS 통합 차트와 같은 방식
- **NXT 미상장 종목(293490)**: `_AL` 도 오류 없이 KRX 값(종가 7,770, 거래량 744,706)과 같음 → KIS UN(빈 응답 → J 폴백)과 달리 **항상 `_AL` 하나로 조회**하면 된다. `nxtEnable` 사전 판정 불필요
- ka10099: 코스피 2,494개(nxtEnable=Y 334), 코스닥 1,835개(nxtEnable=Y 268)
- **판정: ③단계(일봉 폴백) 진행.** 상용 초기 데이터 준비 후 같은 명령을 다시 돌려 `_AL vs CH` 줄이 ✅인지 직접 확인한다.

---

#### ③단계 일봉 폴백 (완료 2026-11-16)
설계: [`docs/superpowers/specs/2026-11-16-kiwoom-daily-fallback-design.md`](superpowers/specs/2026-11-16-kiwoom-daily-fallback-design.md), 동작 정리: `docs/data-collection.md` "일봉 키움 폴백"
- 코드: `backend/apps/collector/kiwoom/fetcher.py`(`fetch_daily_ohlcv` — `{ticker}_AL`·수정주가·연속조회 상한 10쪽·기간 자르기), `kiwoom/daily_fallback.py`(켜짐 조건·폴백 패스), `tasks/universe.py`(`collect_all_daily`·`backfill_all_daily` 연결·집계)
- 언제: KIS 1·2차 패스가 끝난 뒤 최종 실패 + UN·J 모두 빈 응답 종목만. KIS 정상 경로는 그대로
- 출처: CH `daily_prices.source`(`kis` 기본 / `kiwoom`). 다음 날 KIS 겹침 수집이 같은 날짜를 다시 넣으면 `kis` 로 돌아온다
- 결과: 일봉 단계 요약에 `kiwoom_fallback`(채운 종목 수)·`kiwoom_failed`
- **켜고 끄기**: 상용 `backend/.env.production` 에 키움 키가 있으면 기본 켜짐. 끄려면 `KIWOOM_FALLBACK_ENABLED=false` 를 넣고 collector(worker) 재시작 — 다시 켜려면 줄을 지우거나 `true`. 키가 없으면(개발 서버) 항상 꺼짐
- 상용 확인: 20:30 파이프라인 뒤 관리자 "데이터 현황" 일봉 요약의 `kiwoom_fallback`, 그리고
  ```sql
  SELECT source, count() AS rows, uniqExact(ticker) AS tickers
  FROM stock_data.daily_prices FINAL
  WHERE date >= today() - 7
  GROUP BY source;
  ```

### [Step 4] 로컬 PC에서 상용 데이터 연동 확인 방법
수집기가 상용 DB에 데이터를 적재하면, 로컬 PC에서 데이터가 잘 들어왔는지 확인합니다.

1. **로컬 터미널 1: DB 터널 실행**
   ```bash
   ./scripts/dev-db-tunnel.sh
   ```
2. **로컬 터미널 2 (또는 DataGrip/DBeaver): ClickHouse 쿼리 실행**
   - ClickHouse 포트: `localhost:18123`
   ```sql
   -- 오늘 날짜 데이터 및 출처(source) 확인
   SELECT 
       ticker, date, open, high, low, close, volume, source, ingested_at
   FROM stock_data.daily_prices FINAL
   WHERE date >= today() - 2
   ORDER BY date DESC, ticker ASC
   LIMIT 20;

   -- 전체 적재 종목 수 확인
   SELECT count(), uniqExact(ticker) 
   FROM stock_data.daily_prices FINAL 
   WHERE date = today();
   ```
3. **관리자 웹(`admin_web`)에서 확인**
   - 로컬 어드민 웹(`http://localhost:5173`) 접속
   - **"데이터 현황" / "수집 파이프라인"** 메뉴에서 Celery 파이프라인의 각 단계별 성공 여부 및 요약 로그 확인

---

### [Step 5] 트러블슈팅 가이드

| 증상 | 원인 | 해결 방법 |
|---|---|---|
| 오류 `8010` (또는 HTTP 403) | 토큰 발급 IP ≠ 요청 IP / 등록 IP 밖에서 호출 | 상용 서버에서 실행했는지, 키움 포털 등록 IP 가 상용 서버 공인 IP 와 같은지 확인 (모의 키는 쓰지 않음 — 8030·8031 이면 실전/모의 키 혼동) |
| 오류 `8005` (토큰 무효) | 캐시 토큰 만료·폐기 | 클라이언트가 캐시 삭제 후 1회 재발급한다. 반복되면 Redis `kiwoom:token:prod:*` 키 삭제 후 재실행 |
| 오류 `1700`·`1701`·`1702` | 초당 한도 초과 | `KIWOOM_RATE_PER_SEC` 를 낮춘다(기본 4, 최대 5) |
| KIS와 키움 시세(종가/거래량) 불일치 | 넥스트레이드(NXT) 포함 여부 차이 | KIS의 UN(통합) 시세 기준과 키움 제공 기준 비교 후 수집 정책 문서(`docs/data-collection.md`) 확인 |
| 로컬 DB 터널 끊김 | 네트워크 절전 또는 세션 만료 | `./scripts/dev-db-tunnel.sh` 창 확인 (스크립트가 3초 뒤 자동 재연결함) |


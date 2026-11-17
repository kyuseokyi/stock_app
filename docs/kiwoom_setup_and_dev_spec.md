# 키움증권 REST API 연동 가이드 및 개발 명세서

> **문서 목적**: 한국투자증권(KIS) API와 키움증권 REST API를 병행하여 안정적인 멀티 브로커 시세 수집 파이프라인을 구축하기 위한 **사용자 준비 사항(Checklist)** 및 **클로드코드(Claude Code) 개발 구현 명세서**입니다.

> **정정 (2026-11-16, 공식 명세 기준)** — 키움 공식 명세(GitHub `Kiwoom-Securities/Kiwoom-REST-API` `kiwoom/_data/kiwoom_api_spec.json`, 커밋 c7a3d25)와 결정 사항에 맞춰 아래를 고쳤다. 설계: [`docs/superpowers/specs/2026-11-16-kiwoom-client-probe-design.md`](superpowers/specs/2026-11-16-kiwoom-client-probe-design.md)
> - **실전 키만** 쓴다(KIS·키움 모두) → `KIWOOM_MODE`·모의(mock) 도메인 분기 없음. 계좌번호도 시세 조회에는 필요 없다(`KIWOOM_ACCOUNT_NO` 삭제).
> - 한도: **TR 마다 초당 5회**(그 밖에 전체·그룹 한도 — 오류 1700·1701·1702, 수치 미공개). 기본 `KIWOOM_RATE_PER_SEC=4`(1~5로 자름).
> - 토큰: `au10001` `POST /oauth2/token`, body `grant_type=client_credentials`·`appkey`·**`secretkey`**(KIS 의 `appsecret` 과 이름이 다름) → `token`·`expires_dt`(YYYYMMDDHHmmss, KST). 유효 24시간.
> - 모든 조회는 `POST` + JSON body, TR 은 헤더 `api-id`. 연속조회는 응답 **헤더** `cont-yn`·`next-key` 를 다음 요청 헤더에 그대로.
> - IP 불일치는 HTTP 403 이 아니라 **오류 8010**(토큰 발급 IP ≠ 요청 IP)으로 온다. 8005 = 토큰 무효.
> - 거래소 구분은 종목코드 접미사: 없음=KRX, `_NX`=NXT, `_AL`=SOR(통합). `_AL` 거래량이 KIS UN(KRX+NXT 합산)과 같은지는 **실측 대상**(아래 [Step 3]).
> - 진행 순서: ① 클라이언트·실측 도구(완료) → ② 연기금 프리셋 → ③ 일봉 폴백(**완료 2026-11-16** — 아래 "③단계 일봉 폴백") → ④ 대차잔고(④-1 **구현·상용 실측 완료 2026-11-17** — 아래 "④-1 대차잔고")·테마(④-2 **구현·상용 실측 2026-11-17, 교체 진행** — 아래 "④-2 테마")·시황 수급(④-3 **구현 2026-11-17, 상용 실측 대기** — 아래 "④-3 투자자별 순매수") 등 키움 데이터. **종목 분할 수집은 하지 않는다**(출처마다 기준이 달라짐).

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

**2차 확인 (2026-11-16, 상용 초기 데이터 준비 완료 후 CH 직접 조회)** — 상용 `daily_prices` FINAL 005930 2026-08-05 = 시가 250,000·고가 254,500·저가 240,000·종가 242,000·거래량 43,358,171 → 키움 `_AL` 과 **다섯 값 모두 일치** ✅. KIS UN = 키움 `_AL` 확정(폴백 값 동일).
- 같은 점검에서 상용 일봉 백필: 3,942종목·2,662,898행(2023-09-25~2026-11-13), 이상값·중복 0, 최근 거래일 종목 수 일정.

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

#### ④-1 대차잔고 (ka20068, 구현 2026-11-16)
설계: [`docs/superpowers/specs/2026-11-16-kiwoom-lending-design.md`](superpowers/specs/2026-11-16-kiwoom-lending-design.md), 동작 정리: `docs/data-collection.md` "대차잔고"
- **명세(c7a3d25 `대차거래추이요청(종목별)(ka20068)`)**: `POST /api/dostk/slb`, body `strt_dt`·`end_dt`(YYYYMMDD, 선택)·`all_tp`("0": 입력 종목만)·`stk_cd`(필수, length 6). 응답 LIST `dbrt_trde_trnsn` — `dt`·`dbrt_trde_cntrcnt`(체결 주)·`dbrt_trde_rpy`(상환 주)·`dbrt_trde_irds`(증감 주)·`rmnd`(잔고 주)·`remn_amt`(잔고금액 **백만원**). 쪽당 행 수는 명세에 없음
- **접미사**: 명세 `stk_cd` length 6·예시 `"005930"` → 접미사 없이 6자리로 부른다(대차는 KRX 단독 제도). `_AL` 을 받는지는 probe 가 한 번 불러 기록한다
- 코드: `kiwoom/client.py`(`get_lending_trend`), `kiwoom/normalize.py`(`lending_row`), `kiwoom/lending.py`(`fetch_lending`·`run_lending`), `tasks/market_data.py`(`collect_lending_daily`·`backfill_lending`, 파이프라인 단계 `lending` — investor_detail 뒤·canslim 앞)
- 실측(상용 서버에서만):
  ```bash
  docker compose -f docker-compose.prod.yml run --rm celery_worker python -m apps.collector.kiwoom.probe --lending
  # 옵션: --lending-tickers 005930,000660 (최대 3개)
  ```
  확인할 것: ① 표의 `금액/주`(잔고금액 ÷ 잔고주수)가 그날 주가 근처면 백만원 단위가 맞다 ② `최신 행` 날짜 — 20:30 에 당일이 없으면 공시 지연(스크리너는 최대 2거래일 지연까지 허용) ③ `cont-yn` — 10거래일이 한 쪽에 들어오는지 ④ `_AL` 줄의 오류 코드
- 실측 결과 (2026-11-17 08:32 KST, 상용, 005930·000660, 2026-10-30~11-17):
  - 응답 13행·`cont-yn=N` → **종목당 1회 호출**. 아침에도 정상 응답 → 연기금 같은 시간 제한 없음
  - 금액/주: 005930 약 19~22만 원, 000660 약 112~142만 원 = 주가 수준 → **잔고금액 백만원 단위 확인**(×1e6 맞음)
  - 실제 값이 있는 마지막 날은 **전 거래일**(공시 하루 지연) → `LENDING_MAX_LAG=2` 가 필요한 이유
  - ⚠️ **오늘 날짜를 다섯 값 모두 0 으로 채워 준다** → `lending_row` 가 모두 0 인 행을 버리도록 수정(2026-11-17, 백필 전). 저장했다면 그래프 0 낙하·`lending_chg5` -100% 로 '대차잔고 급감' 오탐
  - `005930_AL` 도 13행 — 접미사 없이 6자리 그대로 써도 된다

#### ④-2 테마 (ka90001·ka90002, 구현 2026-11-17)
설계: [`docs/superpowers/specs/2026-11-17-kiwoom-themes-design.md`](superpowers/specs/2026-11-17-kiwoom-themes-design.md), 동작 정리: `docs/data-collection.md` "테마 출처"
- **명세(c7a3d25 `테마그룹별요청(ka90001)`)**: `POST /api/dostk/thme`, body `qry_tp`(필수, 0 전체검색·1 테마검색·2 종목검색)·`stk_cd`(선택)·`date_tp`(필수, length 2, n일전 1~99)·`thema_nm`(선택)·`flu_pl_amt_tp`(필수, 1 상위기간수익률·2 하위기간수익률·3 상위등락률·4 하위등락률)·`stex_tp`(필수, 1 KRX·2 NXT·3 통합). 응답 LIST `thema_grp` — `thema_grp_cd`·`thema_nm`·`stk_num`·`flu_sig`·`flu_rt`·`rising_stk_num`·`fall_stk_num`·`dt_prft_rt`·`main_stk`. 연속조회 `cont-yn`·`next-key`
- **명세(c7a3d25 `테마구성종목요청(ka90002)`)**: 같은 경로 `POST /api/dostk/thme`(api-id 로 구분), body `date_tp`(선택, **length 1**)·`thema_grp_cd`(필수, length 6)·`stex_tp`(필수). 응답 `flu_rt`·`dt_prft_rt` + LIST `thema_comp_stk` — `stk_cd`(length 20)·`stk_nm`·`cur_prc`·`flu_sig`·`pred_pre`·`flu_rt`·`acc_trde_qty`·`sel_bid`·`sel_req`·`buy_bid`·`buy_req`·`dt_prft_rt_n`
- 우리가 보내는 body: ka90001 `{"qry_tp":"0","stk_cd":"","date_tp":"1","thema_nm":"","flu_pl_amt_tp":"1","stex_tp":"3"}`(끝까지 연속조회), ka90002 `{"date_tp":"1","thema_grp_cd":<원 코드>,"stex_tp":"3"}`. 쓰는 필드는 코드·이름·`stk_cd` 뿐(등락은 버림)
- 정규화: 테마 코드 → `KW` 접두사, `stk_cd` → `_AL`·`_NX` 접미사·앞 `A` 를 떼고 6자리 영숫자만(명세 예시처럼 같은 종목이 여러 번 와도 한 번)
- 코드: `kiwoom/client.py`(`theme_groups_body`·`list_themes`·`theme_members`), `kiwoom/normalize.py`(`theme_group`·`theme_member_ticker`), `kiwoom/themes.py`(`run_themes`), `shared/market_repo.py`(`sync_kiwoom_themes`·`active_theme_source`·`theme_groups`), `tasks/market_data.py`(`collect_themes_kiwoom`, 파이프라인 단계 `themes_kiwoom` — canslim 뒤·market_groups 바로 앞), `tasks/bootstrap.py`(같은 단계, 시장 그룹 60일 백필 앞)
- 실측(상용 서버에서만):
  ```bash
  docker compose -f docker-compose.prod.yml run --rm celery_worker python -m apps.collector.kiwoom.probe --themes
  ```
  확인할 것: ① `stex_tp=3`(통합)을 받는지(거부되면 KRX `stex_tp=1` 로 한 번 더 불러 기록 — 코드 기본값을 바꿔야 함) ② `qry_tp=0` 이 등락순 상위 N개로 잘리지 않고 **전체**(수백 개)를 주는지 — 테마 수·쪽 수·마지막 `cont-yn` ③ 첫 테마 구성 종목 수 = ka90001 `stk_num` 인지, 원시 `stk_cd` 에 접미사가 붙는지 ④ 시간 제한·미확정 행 같은 숨은 조건(오류 코드)
- 실측 결과 (2026-11-17 13:33 KST, 상용): ka90001 `stex_tp=3` 오류 없음, **테마 142개**(2쪽 100+42, 끝까지 받음). ka90002(290 백화점) 5행 = `stk_num` 5, 원시 `stk_cd` 는 `069960_AL` 형태 → 6자리로 정리.
  - KIS 마스터(약 302개)보다 적고 테마당 2~10종목으로 작다 → 오래된 테마가 없는 대신 수가 절반 이하. 사용자 결정(2026-11-17): **교체 진행**, 화면을 보고 판단. 작은 테마가 순위를 흔들면 "구성 종목 3개 미만 제외" 같은 규칙을 추가 검토.
  - 되돌리기: `themes`·`theme_stocks` 의 `source='kiwoom'` 행을 정리하면 다음 계산부터 KIS 마스터(출처는 데이터로 선택). 20:30 `themes_kiwoom` 단계가 다시 채우므로 단계도 함께 꺼야 한다.
- **상용 순서**: 배포 → `probe --themes` → 이상 없으면 `collector.collect_themes_kiwoom` 수동 1회 → `collector.backfill_market_groups` → 관리자 '테마 보정' 화면 위 출처가 '키움'·스냅숏 날짜가 오늘인지, 웹 마켓 테마 탭 확인. 이후 매일 20:30 파이프라인이 갱신

#### ④-3 투자자별 순매수 — 시황 수급 전광판 (ka10058, 구현 2026-11-17)
설계: [`docs/superpowers/specs/2026-11-17-kiwoom-investor-flow-design.md`](superpowers/specs/2026-11-17-kiwoom-investor-flow-design.md), 동작 정리: `docs/data-collection.md` "시황 수급 전광판 출처"
- **명세(c7a3d25 `투자자별일별매매종목요청(ka10058)`)**: `POST /api/dostk/stkinfo`(ka10099 와 같은 경로, api-id 로 구분). body 6개 모두 필수 — `strt_dt`·`end_dt`(YYYYMMDD), `trde_tp`(1 순매도·2 순매수), `mrkt_tp`(**001 코스피·101 코스닥** — ka10099 의 0·10 과 다름), `invsr_tp`(8000 개인·9000 외국인·1000 금융투자·3000 투신·3100 사모펀드·5000 기타금융·4000 은행·2000 보험·6000 연기금·7000 국가·7100 기타법인·9999 기관계), `stex_tp`(1 KRX·2 NXT·3 통합). 응답 LIST `invsr_daly_trde_stk` — `stk_cd`(length 20)·`stk_nm`·`netslmt_qty`(1주, 부호)·`netslmt_amt`(설명 "원", 부호)·`prsm_avg_pric`(추정평균가)·`cur_prc`·`pre_sig`·`pred_pre`·`avg_pric_pre`·`pre_rt`·`dt_trde_qty`. 연속조회 `cont-yn`·`next-key`
- **단위 충돌**: 명세 예시 `netslmt_qty +4464`·`prsm_avg_pric 57056`·`netslmt_amt +25467` → 4464×57056 ≈ 2.547억 = 25467 × 1만(나머지 두 행도 ×1만). 설명("원")과 예시가 달라 **예시를 따라 ×10,000**, 실측으로 확정
- **실측으로 확정 — 백만원**(아래 실측 결과). 예시 산술의 ×1만은 수량·금액 단위 차이에서 오는 응답 내부 비율일 뿐, 원 환산 배수가 아니었다.
- 우리가 보내는 body: `{"strt_dt":D,"end_dt":D,"trde_tp":"2","mrkt_tp":"001"|"101","invsr_tp":"9000"|"9999"|"6000","stex_tp":"3"}`
- 코드: `kiwoom/client.py`(`investor_daily_body`·`investor_daily_top`), `kiwoom/normalize.py`(`plain_ticker`·`investor_flow_row`·`implied_amt_unit`), `collector/investor_flow.py`(`fetch_kiwoom`·`_fill_from_pykrx`)
- 실측(상용 서버에서만):
  ```bash
  docker compose -f docker-compose.prod.yml run --rm celery_worker python -m apps.collector.kiwoom.probe --investors
  # 기준일 지정: --investors-date 20261116 (기본 직전 평일 — 공휴일은 모름)
  ```
  확인할 것: ① **'단위 추정'이 ×10,000 ✅** 인지(아니면 `KIWOOM_FLOW_AMT_TO_WON` 을 그 값으로) ② 투자자×시장별 응답 행 수·`cont-yn`(쪽당 몇 행인지, 상위 N 으로 잘리는지) ③ 원시 금액이 내림차순으로 오는지 ④ 원시 `stk_cd` 접미사 ⑤ 시간 제한·미확정 0행 같은 숨은 조건(장중·15:45 무렵 한 번 더 돌려 오류 코드·0행 확인) ⑥ 상위 종목이 HTS/MTS 투자자별 순매수와 같은지
- 실측 결과 (2026-11-17 14시 KST, 상용, 기준일 2026-11-16): 투자자×시장마다 **100행 · cont-yn=N**(상위 100 으로 잘림 — 전광판 상위 10 에는 충분), 원시 금액 내림차순, `stk_cd` 는 `_AL` 접미사.
  - **단위 = 백만원**: 같은 날 상용 전광판(pykrx, KRX 단독)과 비교 — 대덕전자 외국인 14,421 ↔ 144.2억(일치), 삼성전자 기관 195,491 ↔ 1,729억, 셀트리온 기관 28,135 ↔ 263억, 우리금융 26,466 ↔ 256억(키움은 통합이라 조금 큼). 만원이면 100배 작아져 상위 종목 금액이 수억 원대로 비상식적.
  - 외국인은 pykrx 와 차이가 더 큼(삼양식품 242억 vs 163억, pykrx 1위 SK스퀘어 274억이 키움 상위 5에 없음) — 외국인 정의(기타외국인 포함 여부)·통합 차이 추정, 전광판 반영 후 MTS 와 비교 확인.
  - **버그**: 연기금 코스피 목록 끝 음수 행의 금액이 `'+-5'`(부호 두 개)로 와 `to_int` 가 실패 → probe 중단(수집에서는 그 투자자만 pykrx 로 폴백). `to_int` 가 두 부호를 음수로 읽도록 수정.
  - ETF(KODEX 레버리지·TIGER 반도체TOP10)가 원시 목록 상위에 섞임 — 수집은 보통주 유니버스 필터로 거른다(probe 는 원시 그대로 표시).
- 실측 결과: (상용 실행 뒤 probe 요약 블록을 여기에)
- **상용 순서**: 배포 → `probe --investors` → 단위 ✅ 이면 그대로(❌ 면 상수 수정 커밋·배포) → 다음 전광판 갱신(15:45·18:10·22:00) 뒤 시황 탭 캡션 '출처 키움'·금액(억 단위)이 상식적인지 확인. 키움이 실패하면 자동으로 pykrx → KIS 라 서비스 영향은 없다

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


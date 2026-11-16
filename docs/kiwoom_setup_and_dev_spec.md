# 키움증권 REST API 연동 가이드 및 개발 명세서

> **문서 목적**: 한국투자증권(KIS) API와 키움증권 REST API를 병행하여 안정적인 멀티 브로커 시세 수집 파이프라인을 구축하기 위한 **사용자 준비 사항(Checklist)** 및 **클로드코드(Claude Code) 개발 구현 명세서**입니다.

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
- [ ] **실전투자 vs 모의투자 구분**:
  - 발급받은 키가 **실전계좌**용인지 **모의투자**용인지 확인
  - 키움 REST API는 도메인과 포트(또는 엔드포인트 URL)가 모드별로 다를 수 있습니다.
- [ ] **계좌번호 확인**: 시세 조회는 계좌번호가 필수가 아닐 수 있으나, 계좌 연동 TR이 필요할 경우 계좌번호(8자리+2자리) 확인
- [x] **허용 IP 등록 (완료)**:
  - **상용 오라클 서버 인스턴스 공인 IP 등록 완료**.
  - ⚠️ 키움 REST API는 등록된 IP에서만 호출 가능하므로, **실제 API 통신은 상용 오라클 서버에서만 발생**합니다. (로컬 PC 직접 호출 시 403 차단됨)

### [체크리스트 2] 환경 변수(.env) 설정
`backend/.env.development` 및 상용 서버의 `.env.production` 파일에 아래 환경변수를 추가합니다. (Git 커밋 금지)

```env
# ==========================================
# 키움증권 Open API (REST)
# ==========================================
KIWOOM_APP_KEY=발급받은_키움_APP_KEY
KIWOOM_APP_SECRET=발급받은_키움_APP_SECRET
KIWOOM_ACCOUNT_NO=  # 시세 전용이면 공란 가능
KIWOOM_MODE=prod    # prod(실서버) 또는 mock(모의투자)
KIWOOM_RATE_PER_SEC=5  # 초당 안전 호출 제한 (기본 권장 5)

# 수집 제공자 모드 선택 (kis | kiwoom | hybrid)
DATA_COLLECTOR_PROVIDER=hybrid
```

### [체크리스트 3] 키움 REST API 명세서/자료 준비
- [ ] 키움증권 개발자 포털(OpenAPI+ REST 가이드)의 **API 엔드포인트 URL 목록** 및 **TR ID 명세서** (PDF 또는 웹 링크)
  - OAuth 토큰 발급 엔드포인트 (예: `/oauth2/token` 등)
  - 주식 기본정보/현재가 조회 TR
  - 국내주식 기간별 일봉/분봉 조회 TR
  - 투자자별 매매동향 조회 TR

---

## 3. 클로드코드(Claude Code) 개발 구현 명세서

클로드코드 세션을 열었을 때 아래 5단계 순서대로 개발을 진행하도록 지시하시면 됩니다.

### Phase 1: 환경 설정 모듈 구현
- **파일**: `backend/shared/kiwoom_config.py`
- **내용**:
  - `KISConfig`와 대칭되는 `KiwoomConfig` 데이터클래스 구현
  - 모드(`prod`/`mock`)에 따른 BASE_URL 및 WebSocket URL 분기
  - `get_kiwoom_config()` 팩토리 함수 제공

### Phase 2: 저수준 REST 클라이언트 구현
- **파일**: `backend/apps/collector/kiwoom/client.py`
- **내용**:
  - `requests.Session` 기반 Keep-Alive 풀링 구현
  - **OAuth 2.0 토큰 발급 및 Redis 공유 캐싱**:
    - Redis 키: `kiwoom:token:{mode}` (워커 간 토큰 공유로 중복 발급 및 1일 발급 횟수 제한 방지)
  - **Rate Limiter (속도 제어)**:
    - 초당 요청 제한(`KIWOOM_RATE_PER_SEC`, 기본 5건) 준수하는 토큰 버킷 또는 슬립 제어
  - **지수 백오프 재시도(Exponential Backoff)**:
    - 5xx, 타임아웃, ConnectionError 발생 시 지수 백오프 재시도
    - 4xx 인증 에러는 즉시 실패 처리

### Phase 3: 데이터 수집기(Fetcher) 및 정규화
- **파일**: `backend/apps/collector/kiwoom/fetcher.py`
- **내용**:
  - `fetch_daily_ohlcv(ticker, start_date, end_date)`: 일봉 조회
  - **데이터 정규화(Normalize)**:
    - 키움의 응답 필드명을 시스템 공통 필드(`date`, `open`, `high`, `low`, `close`, `volume`, `trading_value`)로 매핑
    - 기존 ClickHouse `daily_prices` 적재 규격과 100% 일치시킴 (ReplacingMergeTree 멱등 적재)
  - `fetch_investor_flow(ticker)`: 투자자별 수급 조회 (개인/외국인/기관)

### Phase 4: 멀티 브로커 통합 및 폴백(Fallback) 파이프라인
- **파일**: `backend/apps/collector/provider.py`, `backend/apps/collector/tasks/pipeline.py`
- **내용**:
  - `DATA_COLLECTOR_PROVIDER` 설정에 따라 분기:
    - `kis`: 기존 KIS 단독 수집 (Regression 100% 방지)
    - `kiwoom`: 키움 단독 수집
    - `hybrid`:
      - **분할 수집**: 코스피는 KIS, 코스닥은 키움 (또는 짝수/홀수 종목 분할)으로 전체 수집 시간 반감
      - **장애 폴백**: KIS 요청 실패(한도 초과, 5xx) 시 자동으로 Kiwoom Fetcher 호출

### Phase 5: 단위 테스트 및 검증
- **파일**: `backend/tests/collector/test_kiwoom_client.py`
- **내용**:
  - Mock HTTP 응답을 이용한 토큰 발급, Redis 캐싱, 일봉 파싱 단위 테스트
  - Rate Limiter 동작 검증
  - KIS 일봉 결과와 키움 일봉 결과의 정합성 표본 비교

---

## 4. 상용 수집 + 개발서버(맥미니) 데이터 공유 아키텍처 (IP 제한 최적화)

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
   - KIS는 `UN`(KRX+NXT 통합) 시세를 지원합니다. 키움 REST API의 시세 제공 기준(KRX 단독인지 NXT 통합인지)을 명세서에서 확인하고 수집 로그에 출처(`source='kiwoom'`)를 남기도록 설계합니다.

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

```bash
# 1. 로컬에서 코드 푸시
git push origin dev

# 2. 상용 오라클 서버 접속 (Termius 또는 SSH)
ssh opc@<상용 서버 IP>  # 상용 오라클 서버

# 3. 상용 서버에서 코드 풀
cd /opt/stock_app/repo (또는 프로젝트 경로)
git pull origin dev

# 4. 상용 서버의 /opt/stock_app/env/.env.production 파일에 키움 키 등록
nano /opt/stock_app/env/.env.production
# 아래 내용 추가 후 저장 (Ctrl+O, Enter, Ctrl+X):
# KIWOOM_APP_KEY=실제_키움_APP_KEY
# KIWOOM_APP_SECRET=실제_키움_APP_SECRET
# KIWOOM_MODE=prod
# KIWOOM_RATE_PER_SEC=5
# DATA_COLLECTOR_PROVIDER=hybrid
```

---

### [Step 2-1] 개발 서버(맥미니) 설정 — 상용 DB 참조
개발 서버(맥미니, `haezean.com`)에서는 데이터 수집기를 돌리지 않고, 오라클 상용 서버의 ClickHouse/PostgreSQL을 바라보도록 설정합니다.

- 맥미니의 백엔드 env (`/opt/stock_app/env/.env.production` on Mac mini)에서:
  - `CLICKHOUSE_HOST`: 상용 오라클 서버 주소 (또는 상용 Cloudflare Tunnel 주소)
  - `DATABASE_URL`: 상용 PostgreSQL 주소 (Read-Only)
  - Celery Beat/수집 워커는 실행 제외 (API 서버 `stock_api`, `blog`, `auth`만 실행)

---

### [Step 3] 상용 오라클 서버에서 실서버 1종목 E2E 연동 테스트
상용 서버(등록된 IP)에서 실제 키움 REST API가 정상 응답하는지 단건 테스트 스크립트를 실행합니다.

```bash
# 상용 서버 환경에서 실행
cd backend
source .venv/bin/activate  # 또는 conda activate stock_app

# 키움 단건 조회 테스트 (클로드코드가 작성한 테스트 CLI 실행)
python -m apps.collector.kiwoom.test_run --ticker 005930
```
- **확인 포인트**:
  - `[OK] OAuth Token 발급 성공 (Redis 캐시 저장 완료)`
  - `[OK] 005930(삼성전자) 일봉 데이터 30건 수신 완료`

---

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
       ticker, date, open, high, low, close, volume, ingested_at
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
| 키움 API 호출 시 `403 Forbidden` | IP 미등록 또는 모의/실전 불일치 | 오라클 서버 공인 IP가 키움 포털에 정확히 등록되었는지 확인, `KIWOOM_MODE` 확인 |
| `Token Expired` 또는 발급 제한 에러 | 토큰 중복 발급 시도 | Redis의 `kiwoom:token:*` 키 TTL 및 캐시 상태 점검 |
| KIS와 키움 시세(종가/거래량) 불일치 | 넥스트레이드(NXT) 포함 여부 차이 | KIS의 UN(통합) 시세 기준과 키움 제공 기준 비교 후 수집 정책 문서(`docs/data-collection.md`) 확인 |
| 로컬 DB 터널 끊김 | 네트워크 절전 또는 세션 만료 | `./scripts/dev-db-tunnel.sh` 창 확인 (스크립트가 3초 뒤 자동 재연결함) |


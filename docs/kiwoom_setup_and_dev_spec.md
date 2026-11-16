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
- [ ] **허용 IP 등록 확인 (중요)**:
  - 키움증권 Open API 포털에서 **"API 호출 허용 IP 등록"** 메뉴가 있는지 확인
  - 상용 서버(미니PC)의 공인 IP 및 필요 시 로컬 개발 PC 공인 IP를 등록해야 API 요청이 거부(403/Blocked)되지 않습니다.

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

## 4. 상용 수집 + 개발 터널링 운영 가이드

```
[상용 서버 (미니PC)]
┌──────────────────────────────────────────────┐
│  Celery Beat / Worker                        │
│  - KIS + Kiwoom REST API로 시세 수집          │
│  - ClickHouse (8123), PostgreSQL (5432) 적재 │
└──────────────────────┬───────────────────────┘
                       │ (Cloudflare Tunnel: ssh.haezean.com)
                       ▼
[로컬 개발 PC]
┌──────────────────────────────────────────────┐
│  ./scripts/dev-db-tunnel.sh 실행            │
│  - localhost:18123 ──► 상용 ClickHouse (RO)   │
│  - localhost:15432 ──► 상용 PostgreSQL (RO)  │
│  - Redis: 로컬 Docker 유지 (Celery 간섭 방지)│
└──────────────────────────────────────────────┘
```

1. **데이터 수집은 상용 서버에서만 실행**:
   - 로컬 개발 PC에서는 수집 Celery Worker를 실행하지 않습니다.
   - 키움/KIS API 키를 상용 서버 워커 1곳에서만 사용하여 Rate Limit 초과 및 IP 차단을 원천 차단합니다.
2. **로컬 개발 시 상용 데이터 사용**:
   - 터미널에서 `./scripts/dev-db-tunnel.sh` 실행
   - 로컬 백엔드(`backend/.env.development`)에서 `CLICKHOUSE_PORT=18123`으로 상용 시세를 실시간 조회하여 개발 및 기능 테스트 수행

---

## 5. 핵심 준수 규칙 (Regression 방지)

1. **기존 KIS 동작 100% 보존**:
   - 키움 모듈이 추가되더라도 기존 `KIS_APP_KEY` 기반 단독 파이프라인은 설정 변경 없이 완벽히 동작해야 합니다 (`DATA_COLLECTOR_PROVIDER=kis` 기본 호환).
2. **Redis 키 네임스페이스 격리**:
   - 토큰 및 상태 캐시: `kis:*` 와 `kiwoom:*` 로 철저히 분리.
3. **NXT(대체거래소) 시세 차이 주의**:
   - KIS는 `UN`(KRX+NXT 통합) 시세를 지원합니다. 키움 REST API의 시세 제공 기준(KRX 단독인지 NXT 통합인지)을 명세서에서 확인하고 수집 로그에 출처(`source='kiwoom'`)를 남기도록 설계합니다.

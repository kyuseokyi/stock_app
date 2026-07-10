# 주식 앱 풀스택 상세 아키텍처 및 설계서

## 🏗️ 1. 전체 시스템 아키텍처 및 모노레포 구조
*   **Mobile App (Client)**: React Native (Expo), Zustand, React Query, NativeWind (일반 유저용)
*   **Web App (Client)**: React (Vite/Next.js), Zustand, TailwindCSS (일반 유저 웹용)
*   **Admin Web (Client)**: React (Vite), Zustand, React Query, TailwindCSS (관리자용)
*   **Backend API Server**: Python FastAPI (클라이언트 요청 처리 전담)
*   **Backend Worker Server**: Python Celery + Redis (데이터 수집, 무거운 연산, 푸시 알림 전담)
*   **Database**: PostgreSQL (RDBMS), ClickHouse (OLAP), Redis (Message Broker & Cache)

### 📂 모노레포(Monorepo) 디렉토리 구조 (Worker 분리 반영)
코드는 하나의 `backend` 폴더에서 관리하되, Docker 배포 시 컨테이너(프로세스)를 API와 Worker로 완벽히 분리하여 실행합니다.

```text
stock_app/
├── backend/               # FastAPI 및 Celery 백엔드 워크스페이스
│   ├── apps/              # 용도별 독립 배포가 가능한 마이크로서비스(앱) 모음
│   │   ├── auth/          # 인증 서버 (Users, OAuth, JWT 발급)
│   │   ├── blog/          # 블로그/커뮤니티 서버 (게시판, 댓글)
│   │   ├── stock_api/     # 주식 API 서버 (스크리너 조회, 차트 데이터 전송)
│   │   └── collector/     # 데이터 수집 워커 서버 (시세/재무 수집, 알림 발송 - Celery)
│   └── shared/            # 공통 DB 모델(SQLAlchemy), 유틸리티, 설정 공유
├── mobile/                # React Native (Expo) - 모바일 앱
├── web_client/            # React (Vite) - 일반 유저용 웹 서비스
├── admin_web/             # React (Vite) - 사내 관리자용 어드민
├── k8s/                   # Kubernetes 배포 매니페스트
├── docker-compose.dev.yml # 로컬 개발용 인프라(DB + API + Worker)
└── README.md
```

---

## 🗄️ 2. 상세 데이터베이스 스키마 설계
*   **PostgreSQL (관계형 데이터)**:
    *   `users`: 회원 정보, 소셜 로그인 토큰, FCM 디바이스 토큰, 권한(Role: FREE, PREMIUM, ADMIN 등)
    *   `boards`: 게시판/메뉴 카테고리 - `id`, `name`, `order_index`, `is_active`, `min_role_required` (접근 최소 권한)
    *   `blog_posts`: 블로그 게시글 (`board_id` FK 포함), 작성자, 제목, 본문(HTML), 생성일
    *   `blog_comments`: 댓글 내용, `post_id` FK, 작성자
    *   `push_templates`: 수동 발송용 푸시 알림 템플릿/발송 이력 내역 (`id`, `title`, `body`, `created_at`, `last_sent_at`)
    *   `stock_meta`: 주식 종목 마스터 정보 (종목코드, 회사명, 시장구분)
*   **ClickHouse (시계열 데이터 및 스토리지 관리)**:
    *   `daily_prices`: `ticker`, `date`, `open`, `high`, `low`, `close`, `volume`, `ma5`, `ma20`, `ma50`, `ma120`, `bb_upper`, `bb_lower`, `rsi_14`, `macd`
    *   `fundamentals`: `ticker`, `date`, `per`, `pbr`, `roe`, `dividend_yield`, `market_cap` (스크리너 JOIN용 재무 데이터)
    *   **스토리지 최적화 전략 (TTL & 파티셔닝)**:
        *   **압축(Compression)**: ClickHouse의 컬럼형 스토리지 특성상 시계열 데이터가 1/10 수준으로 고도로 압축되어 저장되므로 용량 부담이 매우 적습니다. (예: 전 종목 10년 치 일봉 데이터도 수백 MB 수준)
        *   **파티셔닝(Partitioning)**: 연월(`toYYYYMM(date)`) 단위로 데이터를 쪼개서 저장하여, 오래된 과거 데이터를 조회할 때 전체를 뒤지지 않게 하고 삭제 시에도 디스크 I/O 없이 통째로 날릴 수 있게 합니다.
        *   **TTL (Time-To-Live)**: 일봉(Daily) 데이터는 장기 보관(예: 10년)하되, 향후 용량을 많이 차지하는 분봉(Minute) 데이터 추가 시 `TTL date + INTERVAL 3 MONTH` 설정을 통해 3개월이 지난 데이터는 백그라운드에서 자동 삭제되도록 설정하여 스토리지 풀(Full)을 미연에 방지합니다.

---

## 📡 3. 백엔드 용도별 독립 배포 설계 (MSA 지향형 모듈러 모노리스)
클라우드 환경에서 각 기능의 부하(트래픽)에 따라 서버를 개별적으로 스케일아웃(확장)하고 배포할 수 있도록 도메인(용도)별로 서버를 분리합니다. 하나의 코드베이스(`backend/`)를 공유하지만, Docker 배포 시에는 완전히 별개의 컨테이너로 독립 실행됩니다.

### 🟢 1. 주식 API 서버 (Stock API Server)
**역할**: 가장 트래픽이 많고 빠른 속도가 요구되는 조회 전용 서버. ClickHouse와 주로 통신합니다.
*   `/api/v1/stocks/*`: 스크리너 검색 결과, 실시간 호가, 차트 데이터 조회.

### 🟢 2. 커뮤니티 및 블로그 서버 (Blog & Board Server)
**역할**: 사용자가 직접 글을 쓰고 읽는 커뮤니티 전담 서버. PostgreSQL과 통신합니다.
*   `/api/v1/boards/*`: 동적 게시판(메뉴) 목록 관리.
*   `/api/v1/blogs/*`: 블로그 게시글 CRUD 및 댓글 관리.

### 🟢 3. 인증 서버 (Auth Server)
**역할**: 소셜 로그인, JWT 토큰 발급 및 검증, 권한 관리 전담.
*   `/api/v1/auth/*`: 토큰 발급, 갱신, 로그아웃.

### 🟡 4. 데이터 수집 및 워커 서버 (Collector & Worker Server)
**역할**: 클라이언트의 요청을 받지 않고, 백그라운드에서 무거운 연산과 데이터 수집만 전담합니다. (FastAPI가 아닌 Celery 기반 구동)
1.  **시세 및 재무 데이터 수집 (Data Pipeline)**: 

    *   `celery-beat`를 통해 매일 정해진 시간에 수집 Task 트리거.
    *   한국투자증권 OpenAPI를 통해 일봉 시세 및 재무 데이터(PER, PBR, ROE 등)를 수집합니다. (유지보수성을 위해 `mojito2`, `pykis` 등 기존 오픈소스 라이브러리와 공식 문서를 참조하여, 파이썬 `requests`와 `websockets`를 기반으로 **자체 커스텀 API 클라이언트를 직접 구현**합니다.)
    *   `pandas-ta`로 보조지표 연산 후 ClickHouse에 Bulk Insert.
2.  **푸시 알림 (Push Notifications)**:
    *   **자동 발송**: API 서버에서 새 글 등록 시 Celery로 발송 Task 위임.
    *   **수동 발송**: 관리자가 저장된 메세지를 선택해 수동 발송 시 Celery로 대량 발송 Task 위임.

---

## 📱 4. 프론트엔드 (모바일 & 관리자 웹)
*   **모바일**:
    *   **Role 기반 동적 탭 네비게이션**: 활성화된 `boards` 목록을 가져올 때, 현재 로그인한 유저의 Role(권한)과 메뉴의 `min_role_required`를 비교하여 접근 가능한 메뉴만 상단 스와이프 탭으로 렌더링 (권한 밖 메뉴는 비노출).
*   **관리자 웹**:
    *   **유저 권한 관리 (Role Management)**: 전체 회원 목록을 조회하고, 특정 유저를 골라 등급(FREE, PREMIUM, ADMIN 등)을 즉시 변경하는 권한 부여 UI.
    *   **메뉴 권한(Role) 제어**: 게시판/메뉴를 생성하거나 수정할 때, "어느 등급 이상부터 이 메뉴를 볼 수 있는지" 권한(min_role_required)을 설정.
    *   **블로그 작성**: 카테고리 선택, 차트 스냅샷 첨부, 해시태그, 이미지 업로드 지원.
    *   **수동 푸시 알림 관리**: 자주 쓰는 푸시 알림 제목/내용을 템플릿으로 저장하고 목록화. 목록에서 하나를 선택해 "발송" 버튼을 누르면 즉시 전체 유저에게 푸시가 전송되는 기능.

---

## 🚀 5. 초기 클라우드 배포 전략 (Cost-Effective Deployment)
초기 트래픽이 적은 서비스 런칭 단계에서는 막대한 고정 비용이 발생하는 AWS/GCP 매니지드 서비스 대신, **단일 가상 서버(VPS) 기반의 Docker Compose** 배포 방식을 채택하여 월 유지비를 최소화(월 1~2만 원 수준)합니다.

*   **추천 클라우드 호스팅 (택 1)**:
    1.  **Vultr (벌쳐)**: 월 약 $24 수준 (2Core, 4GB RAM). **한국(서울) 리전**이 있어 국내 유저 대상 서비스 시 응답 속도가 매우 빠르고 안정적입니다. (권장)
    2.  **Hetzner (헤츠너)**: 월 약 $8 수준 (4Core, 8GB RAM). 미국/독일 리전만 있어 핑(Ping)이 약간 발생하나, 가성비가 압도적으로 좋아 넉넉한 메모리가 필요한 ClickHouse 운영에 유리합니다.
*   **운영 체제 (OS)**: 상용 배포 서버는 안정성과 Docker 호환성이 가장 뛰어난 **Ubuntu LTS (예: 22.04 또는 24.04)** 버전을 기본 운영체제로 사용합니다.
*   **운영 방식 및 Ubuntu 초기 설정 가이드**:
    상용 서버(VPS) 구매 후 접속부터 서비스 배포까지의 상세 절차입니다.
    1. **서버 접속 및 보안 설정 (UFW 방화벽)**
       * `ssh root@<서버IP>` 로 접속 후 패키지 업데이트: `sudo apt update && sudo apt upgrade -y`
       * 방화벽 설정(포트 개방): `sudo ufw allow OpenSSH`, `sudo ufw allow 80`, `sudo ufw allow 443`, `sudo ufw enable` (HTTPS 및 관리자 웹용 포트만 최소한으로 엽니다.)
    2. **Docker 및 Docker Compose 설치**
       * 공식 스크립트로 설치: `curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh`
       * `sudo apt install docker-compose-plugin -y`
    3. **소스코드 다운로드 및 환경변수 셋팅**
       * `git clone <프로젝트_레포지토리_주소>`
       * `cd stock_app` 이동 후 `.env.example`을 복사하여 `.env.production` 파일을 생성합니다. (KIS API Key, DB 비밀번호 등 실제 상용 키 입력)
    4. **Cloudflare 연동 및 Nginx Proxy (SSL 세팅)**
       * 구입하신 도메인의 네임서버를 **Cloudflare**로 이전하여 무료 플랜에 등록합니다.
       * Cloudflare DNS 메뉴에서 서버의 공인 IP로 A 레코드를 연결하고 '프록시 상태(주황색 구름)'를 켭니다.
       * Cloudflare의 SSL/TLS 설정 메뉴에서 **"가변(Flexible)"** 또는 **"전체(Full)"** 모드로 설정하여 클라이언트-서버 간 무료 HTTPS 통신을 활성화합니다. (Certbot 등 별도의 SSL 갱신 스크립트가 필요 없습니다.)
       * 우분투 서버에 `sudo apt install nginx` 후, Nginx가 외부의 80포트 요청을 받아 내부의 `8000`포트(FastAPI)와 `5173`(Admin)으로 넘겨주도록(Reverse Proxy) 설정합니다.
    5. **최종 컨테이너 실행**
       * `docker compose -f docker-compose.prod.yml up -d --build` 명령어로 전체 시스템(FastAPI, Celery, Postgres, ClickHouse, Redis)을 일괄 백그라운드 실행합니다.

---

## 🛜 6. 윈도우(Windows) 개발 서버 및 네트워크 설정 가이드

**Q: 내 컴퓨터(localhost)에서 띄우는 로컬 개발 방법은 여전히 유효한가요?**
👉 **네, 완전히 유효하며 가장 기본이 되는 개발 방식입니다.** 
혼자서 코드를 짜고 브라우저로 확인할 때는 복잡한 네트워크 설정 없이 그저 `localhost:8000`이나 `localhost:5173`으로 접속하시면 됩니다. (여기에 명시된 네트워크/방화벽 설정은 **스마트폰 등 외부 기기에서 내 윈도우 PC로 접속해야 할 때만** 추가로 진행하시면 됩니다.)

### 💻 윈도우 개발 서버 셋업 및 외부 개방 절차
윈도우 환경에서 안정적으로 백엔드 인프라를 구축하고, 포트포워딩을 통해 모바일 앱(외부 기기)과 통신하기 위한 절차입니다.

1. **Docker Desktop 및 WSL2 설치 (기본 인프라)**
   * 윈도우용 Docker Desktop을 설치할 때 반드시 **WSL2 기반 엔진** 옵션을 켜서 설치해야 데이터베이스(Postgres, ClickHouse) 속도가 리눅스처럼 빠르게 동작합니다.
   * 터미널(PowerShell 또는 WSL2 Ubuntu)을 열고 `docker-compose -f docker-compose.dev.yml up -d`를 실행하여 로컬 DB들을 띄웁니다.
2. **윈도우 방화벽 인바운드 규칙 개방 (필수)**
   * 외부 기기(스마트폰)가 내 PC에 들어오려면 방화벽을 뚫어줘야 합니다.
   * PowerShell을 관리자 권한으로 열고 아래 명령어를 칩니다:
     `New-NetFirewallRule -DisplayName "FastAPI Dev" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow`
3. **공유기 포트포워딩(Port Forwarding) 매핑**
   * 공유기 설정(예: 192.168.0.1)에 접속 후:
   * 외부 포트 `8000` ➡️ 내부 IP(윈도우 PC의 192.168.0.X)의 `8000` 포트로 연결.
   * 외부 포트 `5173` ➡️ 내부 IP(윈도우 PC)의 `5173` 포트로 연결.
4. **클라이언트 앱(`.env.development`) 환경변수 세팅**
   * 스마트폰 앱 코드의 `.env.development` 파일에 `localhost` 대신 윈도우 PC의 공인 IP (또는 DDNS) 주소를 입력하여 API를 바라보게 합니다. (예: `EXPO_PUBLIC_API_URL=http://my-stock-dev.iptime.org:8000/api/v1`)

---

## 🧪 7. 자동화 테스트 및 QA (Quality Assurance) 전략
안정적인 서비스 운영과 리팩토링을 위해 각 환경별로 최적화된 테스트 프레임워크를 도입하여 테스트 케이스(Unit Test) 및 UI 자동화 테스트(E2E)를 구축합니다.

### 🟢 1. 백엔드 (FastAPI & Celery)
*   **프레임워크**: `pytest`
*   **단위/통합 테스트**: 
    *   `TestClient`를 활용하여 주요 API(인증, 스크리너 조회, 게시글 작성)의 응답 상태코드 및 JSON 스키마를 검증합니다.
    *   `unittest.mock`을 사용하여 한국투자증권 API 통신 구간을 가짜(Mock) 데이터로 대체하여, 주말이나 장 종료 후에도 수집 파이프라인의 로직을 안전하게 테스트합니다.

### 📱 2. 모바일 앱 (React Native)
*   **컴포넌트/단위 테스트**: `Jest` + `@testing-library/react-native` (Zustand 상태 변화 및 UI 컴포넌트 렌더링 검증)
*   **UI 자동화 테스트 (E2E)**: **Maestro (마에스트로)**
    *   최근 모바일 자동화 테스트의 대세로 떠오른 툴입니다. 기존 Detox 대비 설정이 압도적으로 쉽고 안정적입니다.
    *   단순한 YAML 파일 스크립트로 "앱 실행 ➡️ 스크리너 탭 클릭 ➡️ RSI 슬라이더 조절 ➡️ 차트 화면 진입 확인" 같은 실제 사용자의 터치/스크롤 흐름을 시뮬레이터에서 자동화하여 테스트합니다.

### 💻 3. 관리자 웹 (React/Vite)
*   **컴포넌트/단위 테스트**: `Vitest` + `@testing-library/react` (Vite 환경에 완벽히 호환되며 Jest보다 훨씬 빠름)
*   **UI 자동화 테스트 (E2E)**: **Playwright (플레이라이트)**
    *   마이크로소프트에서 만든 강력한 웹 E2E 툴입니다.
    *   "관리자 로그인 ➡️ 블로그 작성 메뉴 진입 ➡️ 차트 캡처 버튼 클릭 ➡️ 푸시 발송 버튼 클릭"의 전체 시나리오를 Chromium 브라우저를 띄워 자동으로 테스트하고, 실패 시 스크린샷과 비디오를 녹화해 줍니다.

---

## ⚙️ 8. CI/CD 배포 자동화 및 롤백 전략 (추후 도입 예정)
수동 배포의 번거로움을 없애고 "코드 푸시(Push)만 하면 알아서 테스트하고 배포되는" 환경을 구성하기 위해 **GitHub Actions**를 중앙 파이프라인으로 사용합니다. 현재 구상 중인 청사진은 다음과 같습니다.

### 1. 백엔드 및 웹 클라이언트 통합 배포 (서버 자동/수동 배포 및 롤백)
대상: `backend/`(API/Worker), `admin_web/`(관리자 웹), `web_client/`(일반 유저 웹)
*   **CI (지속적 통합)**: PR이 올라오면 GitHub Actions가 자동으로 `pytest`와 `Vitest`를 실행하여 코드가 깨지지 않았는지 검증합니다.
*   **CD (자동 배포)**: `main` 브랜치에 코드가 병합(Merge)되면, GitHub Actions가 우분투 상용 서버(VPS)에 SSH로 자동 접속하여 코드를 당겨오고(git pull) `docker-compose up --build -d` 명령어를 실행하여 3개의 서비스(API, Admin Web, User Web) 컨테이너를 무중단으로 재시작합니다.
*   **수동 배포 및 롤백 (Workflow Dispatch)**: 
    *   GitHub Actions의 `workflow_dispatch` 기능을 활용해 GitHub 웹페이지에 **"수동 배포 버튼"**을 만듭니다.
    *   원하는 Git 태그(Tag, 예: `v1.0.1`)나 특정 커밋을 선택해 버튼을 누르면 서버가 해당 과거 버전 코드로 돌아가 빌드됩니다. 
    *   배포 후 치명적 버그 발생 시, 정상 작동하던 직전 태그(`v1.0.0`)를 선택 후 수동 배포 버튼을 누르는 것만으로 즉각적인 서버 롤백(Rollback)이 완료됩니다.

### 2. 모바일 앱 (Expo EAS 자동화 및 롤백)
*   **코드 푸시 (OTA Update)**: 앱의 로직(JavaScript)이나 UI만 변경된 경우, 앱스토어 심사를 기다릴 필요 없이 `eas update` 명령어를 GitHub Actions가 실행하여 사용자들의 앱을 즉시(Over-The-Air) 업데이트합니다.
*   **모바일 롤백**: OTA 업데이트에 버그가 있을 경우, 관리자가 `eas update --republish` (또는 EAS 대시보드 롤백 버튼)를 사용해 즉각적으로 이전 버전 코드로 원격 롤백할 수 있습니다.
*   **스토어 자동 제출 (EAS Submit)**: 네이티브 코드가 변경되어 스토어 심사가 필요한 경우, GitHub Actions가 `eas build`와 `eas submit`을 연속으로 트리거하여 빌드부터 애플 앱스토어/구글 플레이스토어 심사 제출까지 100% 자동화합니다.

---

## 🔐 9. 소셜 간편로그인 (OAuth) 아키텍처 및 요구사항
국내 주식/커뮤니티 앱의 특성에 맞게 회원가입의 장벽을 낮추기 위해 **카카오와 구글** 간편 로그인을 우선적으로 지원합니다.

> ⚠️ **주의 (Apple App Store 심사 정책)**: 만약 iOS(아이폰) 버전 앱을 애플 앱스토어에 출시하실 계획이라면, 구글이나 카카오 같은 제3자 소셜 로그인을 제공할 때 반드시 **'Apple로 로그인(Sign in with Apple)'도 함께 제공**해야 심사에 통과할 수 있습니다. 안드로이드 전용이거나 웹만 서비스한다면 애플 로그인은 제외해도 무방합니다.

### 🔄 인증 아키텍처 플로우 (Mobile -> Backend)
1. **클라이언트 인증**: 모바일 앱(React Native)에서 각 플랫폼의 네이티브 SDK를 호출하여 사용자가 로그인하면, 해당 플랫폼(카카오 등)으로부터 **공급자 토큰(Access Token / ID Token)**을 발급받습니다.
2. **백엔드 검증**: 모바일 앱이 이 토큰을 우리 백엔드 API (`POST /api/v1/auth/social`)로 전송합니다. 백엔드(FastAPI)는 각 플랫폼의 공식 검증 서버(API)로 HTTP 요청을 보내 이 토큰이 위조되지 않았는지, 누구의 토큰인지 검증합니다.
3. **자체 JWT 발급**: 검증이 완료되면 PostgreSQL `users` 테이블을 조회하여 기존 회원은 로그인 처리, 신규 회원은 자동 가입 처리 후 최종적으로 서버 자체 **Access JWT**와 **Refresh JWT**를 발급합니다.

### 📋 프로젝트 관리자(Owner) 사전 준비 사항 (개인 개발자 가능)
사업자 등록증(비즈니스 계정) 없이 **개인 자격으로도 100% 무료로 연동 가능**합니다. 단, 사용자로부터 받아올 수 있는 정보(이메일, 닉네임, 프로필 사진) 외에 더 민감한 정보(예: 휴대폰 번호)를 수집하려면 추후 비즈니스 인증이 필요할 수 있습니다.
1. **Kakao Developers**: 개인 카카오 계정으로 가입 ➡️ 앱 생성 ➡️ REST API Key, Native App Key 발급 ➡️ 카카오 로그인 활성화
2. **Google Cloud Console**: 개인 구글 계정으로 가입 ➡️ 프로젝트 생성 ➡️ OAuth 동의 화면 구성(외부용) ➡️ OAuth 2.0 클라이언트 ID (iOS/Android/Web 각각) 발급

### 💻 개발 패키지 및 요구사항 (개발자용)
*   **프론트엔드 (React Native / Expo)**:
    *   `@react-native-seoul/kakao-login` (가장 널리 쓰이는 카카오 네이티브 모듈)
    *   `@react-native-google-signin/google-signin` (구글 로그인)
    *   *주의: 네이티브 모듈이 포함되므로 Expo Go 앱에서는 테스트할 수 없으며, `npx expo run:ios/android` (Custom Dev Client) 방식으로 빌드해야 합니다.*
*   **백엔드 (FastAPI)**: `httpx` (토큰 검증 통신용), `PyJWT` (자체 JWT 토큰 발급용)

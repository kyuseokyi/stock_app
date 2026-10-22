# 간편로그인(소셜 로그인) 구현 가이드 & 개발 지시서

본 문서는 **카카오톡 간편로그인**을 최우선으로 구축하고, 향후 **네이버, 구글, 애플 로그인**으로 자연스럽게 확장할 수 있도록 정리한 개발 및 설정 가이드입니다.
사용자가 직접 콘솔에서 설정해야 하는 부분과, **Claude Code**가 코드베이스에서 구현해야 하는 기술 스펙을 명확히 분리하여 구성하였습니다.

---

## 📌 목차
1. [전체 시스템 아키텍처 및 흐름](#1-전체-시스템-아키텍처-및-흐름)
2. [사용자 직접 설정 가이드 (콘솔 및 사전 준비)](#2-사용자-직접-설정-가이드-콘솔-및-사전-준비)
   - [2.1 카카오 개발자 센터 (Kakao Developers) 설정 (우선 진행)](#21-카카오-개발자-센터-kakao-developers-설정-우선-진행)
   - [2.2 네이버 개발자 센터 (Naver Developers) 설정](#22-네이버-개발자-센터-naver-developers-설정)
   - [2.3 구글 클라우드 콘솔 (Google Cloud Console) 설정](#23-구글-클라우드-콘솔-google-cloud-console-설정)
   - [2.4 애플 개발자 콘솔 (Apple Developer) 설정](#24-애플-개발자-콘솔-apple-developer-설정)
3. [클로드코드(Claude Code) 개발 구현 지시서](#3-클로드코드claude-code-개발-구현-지시서)
   - [3.1 현재 코드베이스 현황 분석](#31-현재-코드베이스-현황-분석)
   - [3.2 백엔드 (FastAPI `apps/auth`) 구현 요구사항](#32-백엔드-fastapi-appsauth-구현-요구사항)
   - [3.3 모바일 앱 (React Native / Expo) 구현 요구사항](#33-모바일-앱-react-native--expo-구현-요구사항)
   - [3.4 웹 클라이언트 (React / Vite) 구현 요구사항](#34-웹-클라이언트-react--vite-구현-요구사항)
   - [3.5 다중 공급자(네이버·구글·애플) 확장 아키텍처](#35-다중-공급자네이버구글애플-확장-아키텍처)
4. [단계별 실행 체크리스트](#4-단계별-실행-체크리스트)

---

## 1. 전체 시스템 아키텍처 및 흐름

본 프로젝트는 보안 표준인 **OAuth 2.0 Authorization Code Flow + PKCE (RFC 7636)** 방식을 적용합니다.
모바일(Expo)과 웹(React) 모두 클라이언트가 공급자 SDK에 과도하게 의존하지 않고, **백엔드 중앙 집중형 인가(In-App Browser / Web Redirect)** 방식으로 동작하여 유지보수성과 보안을 극대화합니다.

```
[클라이언트 (App / Web)]
  │
  │ 1. verifier (CSPRNG 32바이트) 생성
  │    cc = base64url(SHA-256(verifier)) 계산
  │    (App: 메모리 보관 / Web: sessionStorage 보관)
  │
  ▼ 2. GET /api/v1/auth/social/{provider}/start?client=app|web&app=dev|prod&cc={cc}
[백엔드 auth 서비스 (FastAPI)]
  │
  │ 3. state JWT 생성 및 서명 (provider, client, app_variant, cc, nonce, exp=10분)
  │
  ▼ 4. 302 Redirect → 카카오 인가 서버 (https://kauth.kakao.com/oauth/authorize)
[카카오 로그인 화면]
  │
  │ 5. 사용자 로그인 및 필수 동의
  │
  ▼ 6. 302 Redirect → 백엔드 콜백 (/api/v1/auth/social/kakao/callback?code=...&state=...)
[백엔드 auth 서비스 (FastAPI)]
  │
  │ 7. state 서명/만료/nonce 검증 (Redis SET NX 로 재사용 차단)
  │ 8. 카카오 토큰 발급 (POST https://kauth.kakao.com/oauth/token)
  │ 9. 카카오 프로필 조회 (GET https://kapi.kakao.com/v2/user/me)
  │ 10. DB User 조회 또는 생성 (provider='KAKAO', provider_id=카카오 회원번호)
  │ 11. 일회용 교환 코드(exchange_code) 발급 (Redis에 cc와 함께 저장, TTL 60초)
  │
  ▼ 12. 302 Redirect → 클라이언트 복귀 주소
        - App (Dev):  stockapp-dev://auth?code={exchange_code}
        - App (Prod): stockapp://auth?code={exchange_code}
        - Web:        http://localhost:3000/auth/complete?code={exchange_code}
[클라이언트 (App / Web)]
  │
  ▼ 13. POST /api/v1/auth/social/exchange
        Body: { code: exchange_code, code_verifier: verifier }
[백엔드 auth 서비스 (FastAPI)]
  │
  │ 14. Redis에서 exchange_code 원자적 소모 (GETDEL)
  │ 15. code_verifier의 SHA-256 해시와 저장된 cc 일치 검증 (PKCE 타이밍 공격 방지 hmac.compare_digest)
  │ 16. 최종 서비스 JWT (access_token, refresh_token) 발급
  ▼
[로그인 완료 및 서비스 이용]
```

### 1.1 클라우드플레어 터널(Cloudflare Tunnel)과 소셜 로그인 연동 특성

본 프로젝트의 개발 서버(Mac mini)는 **Cloudflare Tunnel (`cloudflared`)**을 통해 공인 IP나 포트 포워딩 없이 안전하게 외부 도메인(`*.haezean.com`)과 로컬 Docker 컨테이너를 연결하고 있습니다.

```
[인터넷 / 카카오 인증 서버]
       │
       ▼ (HTTPS :443)
[Cloudflare Edge Network]
       │  (엔드-투-엔드 암호화 아웃바운드 터널)
       ▼
[개발 서버 (Mac mini) - cloudflared 데몬]
       ├── auth.haezean.com  ──▶  localhost:8001 (auth_api 서비스)
       ├── app.haezean.com   ──▶  localhost:3000 (web_client 정적 서빙)
       ├── api.haezean.com   ──▶  localhost:8002 (stock_api 서비스)
       └── blog.haezean.com  ──▶  localhost:8003 (blog_api 서비스)
```

#### 🌟 클라우드플레어 터널 환경에서 소셜 로그인 시 주의사항
1. **Redirect URI는 반드시 터널 공개 도메인 사용**:
   - 카카오 인증 서버는 사용자의 로그인이 끝나면 등록된 `Redirect URI`로 인터넷을 통해 HTTP GET 요청(인가 코드 전달)을 보냅니다.
   - 따라서 개발 서버의 백엔드 환경변수 `SOCIAL_REDIRECT_BASE`는 `localhost:8001`이 아니라 **`https://auth.haezean.com/api/v1/auth/social`**로 설정되어야 카카오가 Mac mini의 auth 컨테이너로 정상 도달할 수 있습니다.
2. **무료 SSL/TLS 자동 지원**:
   - 카카오 등 대부분의 소셜 로그인은 상용 환경 및 외부 콜백에 HTTPS를 필수로 요구합니다.
   - Cloudflare Tunnel이 `https://*.haezean.com`의 SSL 인증서 발급과 암호화 종단을 자동으로 처리하므로, 별도의 SSL 인증서 설치 없이 안전한 OAuth2 연동이 가능합니다.
3. **CORS 및 프록시 헤더**:
   - Cloudflare Tunnel은 `X-Forwarded-Proto: https` 및 클라이언트 `Origin` 헤더를 백엔드로 전달합니다.
   - 백엔드의 `shared/cors.py`에 `https://app.haezean.com`이 이미 허용 Origin으로 등록되어 있으므로 브라우저 CORS 문제 없이 토큰 교환이 진행됩니다.

### 🔒 보안상 강점
1. **커스텀 스킴 탈취 방지**: Android 등에서 악성 앱이 `stockapp://auth` 스킴을 가로채더라도 `code_verifier`를 알 수 없어 토큰 교환이 불가능합니다.
2. **소셜 토큰 미저장**: 공급자의 `access_token`은 프로필 조회 즉시 폐기하며, 서비스 DB에는 자체 발급한 세션/JWT만 관리합니다.
3. **오픈 리다이렉트 방지**: 클라이언트가 넘기는 임의의 URL로 리다이렉트하지 않고, 서명된 state의 `client`/`app_variant`에 따라 서버 화이트리스트 URL로만 복귀합니다.

---

## 2. 사용자 직접 설정 가이드 (콘솔 및 사전 준비)

개발자가 코드로 해결할 수 없고, **서비스 관리자(사용자 본인)가 각 개발자 콘솔에서 직접 클릭하여 발급/등록해야 하는 항목**입니다.

---

### 2.1 카카오 개발자 센터 (Kakao Developers) 설정 (우선 진행)

* **사이트 접속**: [카카오 데브톡 / 개발자 센터](https://developers.kakao.com/) 로그인

---

#### 🌟 [중요] 개인 개발자(사업자 없음)를 위한 개발(Dev)과 상용(Prod) 분리 전략

카카오 공식 기능인 **[테스트 앱]** 생성은 '비즈 앱'(사업자등록증 필요)에서만 지원됩니다.
따라서 **사업자가 없는 개인 개발자**는 다음 2가지 실용적인 방법 중 하나를 사용하시면 됩니다:

* **방법 1 (강력 추천): 일반 애플리케이션 2개 생성 (사업자등록증 불필요)**
  - 카카오 개발자 센터에서는 개인 계정으로 일반 애플리케이션을 **최대 10개까지 무료**로 생성할 수 있습니다.
  - [내 애플리케이션] > [애플리케이션 추가하기]로 **2개의 앱을 각각 만듭니다**:
    1. **`StockApp Dev`** (개발 전용 앱)
    2. **`StockApp`** (향후 상용 배포용 앱)
  - **장점**:
    - **사업자등록증 전혀 불필요** (개인 계정 즉시 가능).
    - 앱 키(`KAKAO_REST_API_KEY`)가 완전히 분리되므로, 개발 중 회원 탈퇴/테스트 데이터가 상용 데이터베이스 및 유저 식별자(`id`)와 완전히 격리됩니다.
    - 현재는 `StockApp Dev` 앱만 생성해서 개발하고, 상용 오픈 시점에 `StockApp` 앱을 하나 더 만들면 됩니다.

* **방법 2: 일반 애플리케이션 1개로 멀티 Redirect URI 등록**
  - 앱을 1개만(`StockApp`) 만들고, 플랫폼 및 Redirect URI 목록에 개발용과 상용용을 복수 등록하는 방식입니다:
    - Redirect URI: `http://localhost:8001/...` (개발용) + 추후 `https://auth.yourdomain.com/...` (상용용) 추가 등록
    - Android 패키지명: `com.stockapp.dev` + `com.stockapp` 둘 다 등록
  - **장점**: 앱 하나로 관리 가능.
  - **주의**: 개발 환경과 상용 환경에서 사용자의 카카오 회원번호(`id`)가 동일하게 발급되므로, 백엔드 데이터베이스를 완벽히 분리해 테스트해야 합니다.

> 💡 **현재 추천 가이드**: 지금은 **방법 1**처럼 `StockApp Dev`(또는 원하는 이름) 일반 앱을 하나 생성하여 개발을 진행하세요. 사업자등록증 없이 1분 만에 바로 만드실 수 있습니다!

---

#### [단계 1] 애플리케이션 생성
1. **[내 애플리케이션]** > **[애플리케이션 추가하기]** 클릭
2. 앱 이름: **`StockApp Dev`** (개발용) 입력
3. 사업자명: 본인 이름 또는 프로젝트명(예: `MyStockDev`) 입력 (사업자등록번호 요구 없음) 후 저장
   *(향후 상용 배포 시점에 동일한 방식으로 `StockApp` 상용 앱을 하나 더 추가하시면 됩니다)*

#### [단계 2] 플랫폼 등록 (개발 & 상용 분리)
**[앱 설정]** > **[플랫폼]** 메뉴로 이동합니다.
1. **Web 플랫폼 등록**:
   - 사이트 도메인에 개발 서버(haezean.com)와 로컬을 모두 등록합니다:
     - **개발 서버 (현재 구축된 서버)**: `https://app.haezean.com`, `https://auth.haezean.com`
     - **로컬 개발 (내 PC)**: `http://localhost:3000`, `http://localhost:8001`
     - **상용 운영 (향후 서버/도메인 확장 시)**: `https://stock.app` 등
2. **Android 플랫폼 등록**:
   - 패키지명:
     - **개발 빌드**: `com.stockapp.dev`
     - **상용 빌드(향후)**: `com.stockapp`
   - 키 해시(Key Hash):
     - 개발용(로컬 디버그 키스토어 해시) 및 배포용(Google Play Console 서명 키 해시) 등록
3. **iOS 플랫폼 등록**:
   - 번들 ID:
     - **개발 빌드**: `com.stockapp.dev`
     - **상용 빌드(향후)**: `com.stockapp`

#### [단계 3] 카카오 로그인 활성화
1. **[제품 설정]** > **[카카오 로그인]** 메뉴로 이동
2. **활성화 설정**: `ON` 토글 클릭

#### [단계 4] Redirect URI 등록 (개발 서버 & 로컬 ⚠️)
인가 코드를 전달받을 백엔드 콜백 엔드포인트를 등록합니다. (카카오는 최대 10개까지 등록 가능하므로 **아래 2개를 모두 등록**해두면 로컬과 개발 서버 어디서든 자유롭게 테스트할 수 있습니다):
1. **개발 서버 (haezean.com - 현재 운영 중)**:
   - `https://auth.haezean.com/api/v1/auth/social/kakao/callback`
2. **로컬 개발 (내 PC)**:
   - `http://localhost:8001/api/v1/auth/social/kakao/callback`
3. **상용 운영 (향후 신규 상용 도메인 구축 시 추가 등록)**:
   - `https://[신규상용도메인]/api/v1/auth/social/kakao/callback`

> 💡 등록되지 않은 Redirect URI 요청 시 카카오에서 `KOE006` 에러를 반환합니다.

#### [단계 5] 동의 항목(Scope) 설정
**[제품 설정]** > **[카카오 로그인]** > **[동의 항목]** 메뉴로 이동합니다.
- **닉네임 (`profile_nickname`)**: **[필수 동의]** 로 설정 (서비스 회원 식별 및 표시)
- **프로필 사진 (`profile_image`)**: **[선택 동의]** 권장
- **카카오계정(이메일) (`account_email`)**:
  - 개인 개발자 계정에서는 권한 검수가 필요할 수 있습니다.
  - 본 시스템은 카카오 고유 식별자(`id`) 기반으로 회원을 구분하므로 **이메일은 필수가 아닙니다 (선택 또는 미사용 가능)**.

#### [단계 6] 보안 키 확인 및 설정
1. **REST API 키 확인**:
   - **[앱 설정]** > **[앱 키]** 에서 `REST API 키` 복사
2. **Client Secret 활성화 (권장)**:
   - **[제품 설정]** > **[카카오 로그인]** > **[보안]** 메뉴로 이동
   - `Client Secret` 코드 [생성] 클릭 후 활성화 상태를 `사용함`으로 변경 및 코드 복사
3. **Admin 키 확인**:
   - **[앱 설정]** > **[앱 키]** 에서 `Admin 키` 복사 (회원 탈퇴 시 카카오 연결 끊기용)

#### [단계 7] 환경별 환경변수 파일 설정 비교 (haezean 개발서버 vs 로컬 vs 상용)

| 환경변수 키 | 로컬 개발 (`.env.development`) | 개발 서버 (haezean.com 배포) | 상용 서버 (향후 신규 구축) |
| :--- | :--- | :--- | :--- |
| **`APP_ENV`** | `development` | `development` (또는 `production`) | `production` |
| **`KAKAO_REST_API_KEY`** | 개발용 `StockApp Dev` 키 | 개발용 `StockApp Dev` 키 | 상용용 `StockApp` 키 |
| **`KAKAO_CLIENT_SECRET`**| 개발용 Client Secret | 개발용 Client Secret | 상용 Client Secret |
| **`KAKAO_ADMIN_KEY`**    | 개발용 Admin 키 | 개발용 Admin 키 | 상용 Admin 키 |
| **`SOCIAL_REDIRECT_BASE`**| `http://localhost:8001/api/v1/auth/social` | `https://auth.haezean.com/api/v1/auth/social` | `https://auth.domain.com/api/v1/auth/social` |
| **`SOCIAL_WEB_RETURN_URL`**| `http://localhost:3000/auth/complete` | `https://app.haezean.com/auth/complete` | `https://domain.com/auth/complete` |
| **`SOCIAL_APP_RETURN_URL_DEV`** | `stockapp-dev://auth` | `stockapp-dev://auth` | `stockapp-dev://auth` |
| **`SOCIAL_APP_RETURN_URL_PROD`**| `stockapp://auth` | `stockapp://auth` | `stockapp://auth` |
| **`SOCIAL_FAKE_PROVIDER`** | `false` (테스트시 true 가능) | `false` | 무조건 `false` (운영 강제 무시) |

---

### 2.2 네이버 개발자 센터 (Naver Developers) 설정

* **사이트 접속**: [네이버 개발자 센터](https://developers.naver.com/)

1. **Application 등록**:
   - **[Application]** > **[애플리케이션 등록]**
   - 사용 API: **네이버 로그인(Naver Login)** 선택
   - 제공 정보(동의항목): **회원이름**, **닉네임**, **프로필 사진** (필수/선택 설정)
2. **로그인 오픈 API 서비스 환경**:
   - **PC웹**:
     - 서비스 URL: `http://localhost:3000` (개발) / 운영 도메인
     - 네이버 로그인 Callback URL: `http://localhost:8001/api/v1/auth/social/naver/callback` (개발) 및 운영 URL
   - **모바일 웹**: 동일하게 콜백 URL 등록
3. **발급 키 환경변수**:
```env
NAVER_CLIENT_ID="<발급받은 Client ID>"
NAVER_CLIENT_SECRET="<발급받은 Client Secret>"
```

---

### 2.3 구글 클라우드 콘솔 (Google Cloud Console) 설정

* **사이트 접속**: [Google Cloud Console](https://console.cloud.google.com/)

1. **프로젝트 선택 또는 생성**: `stock-app`
2. **OAuth 동의 화면 구성**:
   - User Type: 외부(External)
   - 앱 정보, 개발자 연락처 입력
   - 범위(Scope): `openid`, `.../auth/userinfo.profile`, `.../auth/userinfo.email`
3. **사용자 인증 정보 생성**:
   - **[사용자 인증 정보]** > **[사용자 인증 정보 만들기]** > **[OAuth 클라이언트 ID]**
   - 유형: **웹 애플리케이션 (Web application)**
   - 승인된 리디렉션 URI 등록:
     - 개발: `http://localhost:8001/api/v1/auth/social/google/callback`
     - 운영: `https://[인증서버도메인]/api/v1/auth/social/google/callback`
4. **발급 키 환경변수**:
```env
GOOGLE_CLIENT_ID="<발급받은 Google Client ID>"
GOOGLE_CLIENT_SECRET="<발급받은 Google Client Secret>"
```

---

### 2.4 애플 개발자 콘솔 (Apple Developer) 설정

> ⚠️ **주의사항 (Apple App Store 심사 지침 4.8)**
> iOS 앱에 카카오, 네이버, 구글 등 서드파티 간편로그인을 제공하는 경우, **반드시 Sign in with Apple(애플 로그인)도 동등한 수준으로 제공해야 앱 심사를 통과**할 수 있습니다.

* **사전 조건**: Apple Developer Program 유료 멤버십 ($99/년)
* **사이트 접속**: [Apple Developer Account](https://developer.apple.com/account/)

1. **Certificates, Identifiers & Profiles**:
   - **App IDs**: `com.stockapp`에 **Sign in with Apple** 기능 체크 및 활성화
   - **Services IDs 생성**: 웹/백엔드 OAuth용 식별자 생성 (예: `com.stockapp.auth.service`)
     - Sign in with Apple 체크 후 [Configure]
     - Primary App ID 연결
     - Domains and Subdomains: 운영 도메인 등록
     - Return URLs: 백엔드 콜백 URL 등록 (`https://[인증서버도메인]/api/v1/auth/social/apple/callback`)
2. **Keys 생성**:
   - Sign in with Apple 선택 후 Key 생성
   - `.p8` 개인키 파일 다운로드 (최초 1회만 다운로드 가능하므로 안전하게 보관)
   - Key ID 및 Team ID 기록
3. **발급 키 환경변수**:
```env
APPLE_CLIENT_ID="com.stockapp.auth.service"
APPLE_TEAM_ID="<10자리 Apple Team ID>"
APPLE_KEY_ID="<10자리 Key ID>"
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

---

## 3. 클로드코드(Claude Code) 개발 구현 지시서

Claude Code CLI 환경에서 실제 소스 코드를 구현하거나 점검할 때 사용하는 기술 사양서입니다.

### 3.1 현재 코드베이스 현황 분석

현재 모노레포에는 소셜 로그인의 기초 뼈대가 이미 상당 부분 설계되어 있습니다.
- **백엔드**:
  - `backend/shared/models.py`: `AuthProvider` Enum (`KAKAO`, `GOOGLE`, `APPLE`, `NAVER`) 정의됨. `User` 테이블에 `provider`, `provider_id` 유니크 인덱스 완비.
  - `backend/apps/auth/social/`:
    - `config.py`: `SocialSettings`, 환경변수 읽기 로직 완비.
    - `pkce.py`: PKCE S256 challenge 검증 및 생성기 완비.
    - `state.py`: PyJWT 기반 서명 state 생성 및 검증 완비.
    - `store.py`: Redis 기반 nonce 1회 검증 및 일회용 교환 코드 관리 완비.
    - `providers.py`: `KakaoProvider`, `NaverProvider`, `FakeProvider` 완비.
    - `service.py`: `complete_social_login`, `find_or_create_user`, `redeem_exchange_code` 완비.
  - `backend/apps/auth/routers/social.py`:
    - `/api/v1/auth/social/providers` (GET)
    - `/api/v1/auth/social/{provider}/start` (GET)
    - `/api/v1/auth/social/{provider}/callback` (GET)
    - `/api/v1/auth/social/exchange` (POST)
- **모바일 (`mobile/src/features/auth/`)**:
  - `social.ts`, `api.ts`, `verifier.ts`, `return-url.ts`, `social-button.tsx` 완비.
- **웹 (`web_client/src/api/auth.ts`)**:
  - `socialStartUrl`, `getSocialProviders`, `exchangeSocialCode` 완비.

---

### 3.2 백엔드 (FastAPI `apps/auth`) 구현 요구사항

#### 1) 카카오 API 스펙 매핑
- **인가 URL 생성**:
  - 엔드포인트: `https://kauth.kakao.com/oauth/authorize`
  - 파라미터: `response_type=code`, `client_id={KAKAO_REST_API_KEY}`, `redirect_uri={REDIRECT_URI}`, `state={SIGNED_STATE}`
- **토큰 교환 API**:
  - 엔드포인트: `POST https://kauth.kakao.com/oauth/token`
  - Header: `Content-Type: application/x-www-form-urlencoded;charset=utf-8`
  - Body:
    - `grant_type=authorization_code`
    - `client_id={KAKAO_REST_API_KEY}`
    - `redirect_uri={REDIRECT_URI}`
    - `code={CODE}`
    - `client_secret={KAKAO_CLIENT_SECRET}` (설정된 경우)
- **사용자 프로필 조회 API**:
  - 엔드포인트: `GET https://kapi.kakao.com/v2/user/me`
  - Header: `Authorization: Bearer {ACCESS_TOKEN}`
  - 파싱 대상 필드:
    - 식별자: `body["id"]` (정수형이므로 문자열 변환 필수)
    - 닉네임: `body["kakao_account"]["profile"]["nickname"]` (없을 경우 `body["properties"]["nickname"]`)
- **회원 탈퇴 시 카카오 연결 끊기 (Unlink)**:
  - 엔드포인트: `POST https://kapi.kakao.com/v1/user/unlink`
  - Header: `Authorization: KakaoAK {KAKAO_ADMIN_KEY}`
  - Body: `target_id_type=user_id&target_id={PROVIDER_ID}`
  - 구현 위치: `backend/apps/auth/services/account_deletion.py` (이미 연동되어 있음)

#### 2) 환경변수 설정 가이드 (`backend/.env.*`)
```env
APP_ENV=development
# 가짜 모드(실제 카카오 키 없이 로컬 테스트할 때: development/test 환경에서만 유효)
SOCIAL_FAKE_PROVIDER=false

# 카카오 실제 키 (사용자가 발급받아 입력)
KAKAO_REST_API_KEY=your_kakao_rest_api_key_here
KAKAO_CLIENT_SECRET=your_kakao_client_secret_here
KAKAO_ADMIN_KEY=your_kakao_admin_key_here

# 복귀 주소 및 리다이렉트 설정
SOCIAL_REDIRECT_BASE=http://localhost:8001/api/v1/auth/social
SOCIAL_WEB_RETURN_URL=http://localhost:3000/auth/complete
SOCIAL_APP_RETURN_URL_DEV=stockapp-dev://auth
SOCIAL_APP_RETURN_URL_PROD=stockapp://auth
SOCIAL_STATE_SECRET=your_strong_state_secret_key
```

---

### 3.3 모바일 앱 (React Native / Expo) 구현 요구사항

#### 1) In-App Browser 세션 처리
- `expo-web-browser`의 `openAuthSessionAsync`를 사용합니다.
- 복귀 스킴:
  - 개발 빌드: `stockapp-dev://auth?code=...`
  - 상용 빌드: `stockapp://auth?code=...`
- `app.config.js`의 `scheme` 설정 확인:
```javascript
scheme: isDev ? 'stockapp-dev' : 'stockapp',
```

#### 2) 카카오 공식 디자인 가이드라인 준수
- **배경색**: 카카오 옐로우 `#FEE500`
- **텍스트/심볼 색상**: `#191919` (완전 블랙이 아닌 짙은 차콜/블랙)
- **라벨 문구**: `카카오 로그인` 또는 `카카오로 시작하기`
- **아이콘**: 카카오 말풍선 공식 심볼 비율 유지
- 구현 파일: `mobile/src/features/auth/social-button.tsx`

#### 3) 로그인 처리 플로우
```typescript
const handleKakaoLogin = async () => {
  setIsLoading(true);
  try {
    const outcome = await startSocialLogin('kakao');
    if (outcome.type === 'success') {
      await authStore.loginWithToken(outcome.result);
      // 로그인 성공 후 메인 화면 이동
    } else if (outcome.type === 'cancel') {
      // 사용자가 닫은 경우 조용히 무시
    } else {
      Alert.alert('로그인 오류', '카카오 로그인 중 문제가 발생했습니다.');
    }
  } finally {
    setIsLoading(false);
  }
};
```

---

### 3.4 웹 클라이언트 (React / Vite) 구현 요구사항

#### 1) 시작 시 PKCE 생성 및 보관
- `sessionStorage`에 `wc_social_verifier` 키로 verifier 저장.
- 복귀 후 원래 있던 페이지로 돌아가기 위해 `sessionStorage`에 `wc_login_return` (현재 pathname + search) 저장.
- 브라우저를 백엔드 `/start` 엔드포인트로 이동 (`window.location.assign(url)`).

#### 2) 콜백 처리 라우트 (`/auth/complete`)
- URL 쿼리 파라미터 파싱:
  - `?code=...`: 성공. `sessionStorage`에서 verifier 꺼내어 `POST /api/v1/auth/social/exchange` 호출.
  - `?error=...`: 실패. 에러 메시지 노출 및 로그인 모달/홈으로 유도.
- 토큰 발급 성공 시 전역 상태 저장 및 원래 페이지로 리다이렉트 (`router.replace`).

---

### 3.5 다중 공급자(네이버·구글·애플) 확장 아키텍처

새로운 소셜 로그인(구글, 애플 등)을 추가할 때 기존 코드를 훼손하지 않고 확장하는 방법:

1. **`backend/apps/auth/social/config.py`**:
   - `PROVIDERS` 튜플에 `"google"`, `"apple"` 추가
   - `SocialSettings`에 클라이언트 ID 및 Secret 필드 추가
2. **`backend/apps/auth/social/providers.py`**:
   - `GoogleProvider`, `AppleProvider` 클래스 작성 (`Provider` 프로토콜 준수: `authorize_url`, `exchange_code`)
   - `build_provider` 함수에 팩토리 분기 추가
3. **`backend/apps/auth/routers/social.py`**:
   - `ProviderName = Literal["kakao", "naver", "google", "apple"]` 확장
   - `schemas.SocialProvidersOut` 응답 스키마에 필드 추가
4. **프론트엔드 (Mobile/Web)**:
   - `SocialProvider = 'kakao' | 'naver' | 'google' | 'apple'` 타입 확장
   - 로그인 화면에 구글/애플 버튼 추가 (브랜드별 색상 가이드 준수)

---

## 4. 단계별 실행 체크리스트

### Phase 1: 개발 환경 사전 준비 (사용자 & 개발자)
- [ ] [사용자] 카카오 개발자 센터에서 앱 생성 및 REST API 키 발급 (테스트 앱 생성 권장)
- [ ] [사용자] 카카오 로그인 활성화 및 개발용 Redirect URI 등록 (`http://localhost:8001/api/v1/auth/social/kakao/callback`)
- [ ] [사용자] 닉네임 동의 항목 활성화
- [ ] [개발자] `backend/.env.development`에 `KAKAO_REST_API_KEY` 설정
- [ ] [개발자] Redis 및 Postgres 컨테이너 기동 (`docker-compose -f docker-compose.dev.yml up -d`)

### Phase 2: 백엔드 검증 (Claude Code)
- [ ] 백엔드 단위 테스트 실행:
  ```bash
  cd backend
  uv run pytest tests/test_social_login.py -v
  ```
- [ ] 실제 키를 이용한 로컬 기동 및 `/api/v1/auth/social/providers` 엔드포인트 응답 확인 (`kakao: true`)

### Phase 3: 클라이언트 연동 및 E2E 테스트 (Claude Code)
- [ ] 모바일 앱에서 카카오 로그인 버튼 클릭 시 인앱 브라우저로 카카오 로그인 창 표시 확인
- [ ] 로그인 완료 후 `stockapp-dev://auth?code=...` 딥링크 복귀 및 토큰 교환 성공 확인
- [ ] 웹 클라이언트 로그인 및 `/auth/complete` 페이지 복귀 성공 확인
- [ ] 회원 탈퇴 시 카카오 연동 해제(Unlink) 정상 호출 확인

### Phase 4: 네이버 / 구글 / 애플 순차 확장
- [ ] 네이버 개발자 센터 설정 및 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 등록
- [ ] 구글 클라우드 콘솔 설정 및 `GoogleProvider` 구현
- [ ] 애플 개발자 계정 설정 및 `AppleProvider` 구현 (iOS 배포 전 필수)

### Phase 5: 상용(Production) 서버 오픈 시 이관 체크리스트 (향후 서버 구축 시)
- [ ] [사용자] 카카오 개발자 센터에 상용 도메인 및 상용 Redirect URI 추가 (`https://[상용인증도메인]/api/v1/auth/social/kakao/callback`)
- [ ] [사용자] 상용 Android 패키지명(`com.stockapp`) 및 배포 키 해시, iOS 번들 ID(`com.stockapp`) 등록
- [ ] [개발자] 배포 서버의 `.env.production` (또는 Docker Secret)에 상용 키 및 상용 도메인 등록 (`SOCIAL_REDIRECT_BASE`, `SOCIAL_WEB_RETURN_URL` 등)
- [ ] [개발자] 모바일 상용 프로필 빌드 (`eas build --profile production`) 및 딥링크(`stockapp://auth`) 동작 최종 검증


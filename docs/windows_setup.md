# Windows 개발 환경 설정 가이드 (Windows Setup Guide)

이 문서는 Windows 11 환경에서 `stock_app` 프로젝트의 로컬 개발 환경(인프라 DB, 백엔드 마이크로서비스, 웹 프론트엔드, 모바일 앱)을 구성하고 운용하는 방법을 정리한 가이드입니다.

---

## 1. 아키텍처 및 런타임 구성

Windows 환경에서는 **Windows 네이티브(PowerShell/CMD)** 와 **WSL2 (Ubuntu 24.04)** 를 결합한 하이브리드 구성을 사용합니다.

```
[Windows Host]
  ├─ 소스 코드 저장소: E:\work_space\stock
  ├─ Git (MinGit 2.56.0)
  ├─ uv (0.12.23) + Python 3.12.15 (backend/.venv)
  ├─ Node.js (v24 LTS) & npm (v11)
  └─ docker / docker-compose (WSL2 엔진 연동 shim)
        │
        ▼ (WSL2 상호운용 / NAT 네트워크)
[WSL2 - Ubuntu 24.04]
  ├─ 마운트 경로: /mnt/e/work_space/stock
  ├─ Docker Engine (29.1.3) + systemd 자동실행
  └─ 컨테이너: stock_postgres(5432), stock_clickhouse(8123), stock_redis(6379)
```

- **파일 동기화**: `E:\work_space\stock`은 WSL2의 `/mnt/e/work_space/stock`으로 실시간 마운트되므로 코드가 완벽히 공유됩니다.
- **포트 공유**: WSL2에서 열린 포트(5432, 8123, 6379) 및 각 서비스 포트(8001, 8000, 8002, 5173, 3000)는 Windows 브라우저와 개발 도구에서 `localhost`로 그대로 접근 가능합니다.

---

## 2. 설치 도구 및 PATH 등록 정보

모든 도구는 UAC(관리자 권한 승인 창) 없이 일반 사용자 권한으로 설치되어 있으며, Windows 사용자 환경 변수(`User PATH`)에 영구 등록되어 있습니다.

| 도구 | 설치 경로 / 방식 | 비고 |
|---|---|---|
| **Git** | `%LOCALAPPDATA%\Programs\Git\cmd` | MinGit 64-bit |
| **uv** | `%LOCALAPPDATA%\Microsoft\WinGet\Packages\astral-sh.uv_*` | Python 3.12 자동 관리 |
| **Node.js** | `%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_*` | Node v24 LTS + npm 11 |
| **Docker Shim** | `%LOCALAPPDATA%\Programs\Git\cmd\docker.cmd` | WSL2 Docker 호출 래퍼 |
| **Docker Compose** | `%LOCALAPPDATA%\Programs\Git\cmd\docker-compose.cmd` | WSL2 Docker Compose 호출 래퍼 |

---

## 3. WSL2 및 Docker 권한 설정

WSL2 내부의 일반 사용자(`kyu`)가 `sudo`나 권한 오류 없이 Docker를 사용할 수 있도록 아래 설정이 완료되어 있습니다:

1. **Docker 그룹 권한**:
   ```bash
   sudo usermod -aG docker kyu
   ```
2. **Docker 데몬 자동 실행**:
   `/etc/wsl.conf`에 `systemd=true` 활성화 및 `systemctl enable docker` 설정 완료.
3. **sudo 패스워드리스 (NOPASSWD)**:
   개발 편의를 위해 `/etc/sudoers.d/kyu`에 `kyu ALL=(ALL) NOPASSWD:ALL` 구성 완료 (계정 기본 비번: `1234`).

---

## 4. 로컬 인프라 및 서비스 실행 방법

### 방법 A: Windows 원클릭 스크립트 활용 (추천)
`scripts/` 폴더에 배치 스크립트가 준비되어 있습니다:

- **DB 시작 (최초 1회 또는 재부팅 후)**:
  ```cmd
  scripts\start-infra.cmd
  ```
  PostgreSQL(5432), ClickHouse(8123), Redis(6379) 컨테이너가 백그라운드 구동됩니다.
- **전체 서비스 일괄 실행**:
  ```cmd
  scripts\start-services.cmd
  ```
  인증(8001), 블로그(8000), 주식API(8002), 관리자웹(5173), 유저웹(3000)이 각각의 콘솔 창으로 뜹니다.
- **DB 정지**:
  ```cmd
  scripts\stop-infra.cmd
  ```

### 방법 B: Windows 터미널(PowerShell/CMD) 수동 실행
```powershell
# 백엔드 의존성 및 테스트
cd backend
uv run pytest

# 서비스 개별 실행
uv run uvicorn apps.auth.main:app      --reload --port 8001
uv run uvicorn apps.blog.main:app      --reload --port 8000
uv run uvicorn apps.stock_api.main:app --reload --port 8002

# 웹 프론트엔드
cd admin_web  && npm run dev   # http://localhost:5173
cd web_client && npm run dev   # http://localhost:3000
```

### 방법 C: WSL2 터미널(Ubuntu)에서 실행
```bash
cd /mnt/e/work_space/stock

# 백엔드 실행
cd backend
uv run uvicorn apps.auth.main:app --reload --port 8001

# 프론트엔드 실행
cd /mnt/e/work_space/stock/admin_web
npm run dev
```

---

## 5. 모바일 앱 (`mobile/`) 개발 가이드

모바일 프로젝트는 **React Native (Expo SDK 57) + expo-router + Unistyles v3** 기반입니다.

### Q: 모바일 개발은 어디서 어떻게 진행하나요?
모바일 앱 소스 코드는 루트의 **[`mobile/`](../mobile)** 디렉터리에 위치하며, Windows에서 아래 3가지 방식으로 개발을 진행합니다:

### (1) 웹 브라우저 모드 (`npm run web`) — 가장 빠르고 간편 (추천)
UI 구조, 레이아웃, 상태 관리(Zustand), GraphQL/REST API 연동 등 대부분의 기능 개발은 브라우저에서 모바일 뷰로 즉시 확인 가능합니다.
```powershell
cd mobile
npm run web
```
- 브라우저가 열리며 핫 리로딩(코드 저장 시 즉시 화면 갱신)이 지원됩니다.
- 별도의 모바일 에뮬레이터나 빌드 대기 시간 없이 즉시 개발할 수 있습니다.

### (2) Android 개발 빌드 (`npm run android`)
실제 스마트폰 터치 인터랙션, 네이티브 모듈 검증이 필요할 때 사용합니다.
- **사전 요구사항**: Windows에 [Android Studio](https://developer.android.com/studio) 설치 및 Android SDK, 환경변수(`ANDROID_HOME`) 설정 필요.
- **주의사항**:
  - 본 프로젝트는 C++ 네이티브 모듈인 **Unistyles v3**를 사용하므로 앱스토어의 기본 **Expo Go 앱에서는 구동되지 않습니다**.
  - 최초 1회 **개발 클라이언트 빌드(Dev Build)** 를 기기/에뮬레이터에 설치해야 합니다:
    ```powershell
    cd mobile
    npm run android                # 에뮬레이터 실행
    npm run android:dev:device     # USB 디버깅 연결된 안드로이드 실기기
    ```
- **실기기 테스트 시 API 주소**:
  - 스마트폰 실기기는 개발 PC의 `localhost`에 직접 닿지 않으므로, `mobile/.env.development`의 URL을 개발 PC의 로컬 네트워크 IP(예: `http://192.168.0.x:8000`)로 변경해야 합니다.

### (3) iOS 개발 빌드
- iOS 시뮬레이터 및 IPA 빌드는 **macOS (Xcode)** 환경이 필수입니다.
- Windows 단독 환경에서는 iOS 네이티브 빌드가 불가하므로, 다음 방법을 사용합니다:
  - 평소 개발: **웹 모드(`npm run web`)** 또는 **Android 에뮬레이터**로 로직 및 UI 검증
  - iOS 실기기 검증: EAS Cloud Build(`eas build --profile development --platform ios`) 활용

---

## 6. 접속 정보 요약

- **관리자 웹**: [http://localhost:5173](http://localhost:5173) (계정: `admin@stock.app` / `admin1234`)
- **일반 유저 웹**: [http://localhost:3000](http://localhost:3000)
- **Auth API Swagger**: [http://localhost:8001/docs](http://localhost:8001/docs)
- **Blog API Swagger**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Stock GraphQL**: [http://localhost:8002/graphql](http://localhost:8002/graphql)
- **DB 포트**: PostgreSQL `5432`, ClickHouse `8123`, Redis `6379`

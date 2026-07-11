# Stock App Monorepo (Claude Code Instructions)

이 파일은 Claude Code CLI 환경이 이 프로젝트에서 동작할 때 기본적으로 숙지해야 하는 지시문서입니다. 프로젝트 구조와 주요 실행 명령어, 개발 규칙을 담고 있습니다.

## 📌 Project Overview
본 프로젝트는 **한국투자증권 API** 기반의 주식 시계열 데이터 파이프라인, 모바일 큐레이션 앱, 그리고 관리자 웹페이지를 포함하는 풀스택 주식 애플리케이션 모노레포입니다.

## 📂 Directory Structure & Tech Stack
*   `backend/`: Python FastAPI (API Server) & Celery (Data Pipeline/Workers). PostgreSQL & ClickHouse 사용. (패키지 매니저: `uv`)
*   `mobile/`: React Native (Expo). 주식 스크리너 및 차트(`react-native-echarts`) 표시.
*   `admin_web/`: React (Vite) + TailwindCSS. 블로그 작성 및 차트 캡처 기능 포함.
*   `docs/prompts/`: 각 기능별 세부 구현 지시서(AI 프롬프트) 모음.

## 💻 Common Commands
코드를 수정하거나 검증할 때 아래의 명령어를 활용하세요.

### 1. Backend (FastAPI / Celery) — 용도별 독립 서비스(apps/)
```bash
cd backend
uv sync                     # 의존성 설치 및 동기화

# 각 마이크로서비스는 독립 포트로 실행 (운영은 Nginx 리버스 프록시로 통합)
uv run uvicorn apps.auth.main:app      --reload --port 8001  # 인증 서버
uv run uvicorn apps.blog.main:app      --reload --port 8000  # 블로그(게시판/댓글) 서버
uv run uvicorn apps.stock_api.main:app --reload --port 8002  # 주식 API 서버(스켈레톤)

# 데이터 수집/알림 워커 (Celery)
uv run celery -A apps.collector.celery_app worker --loglevel=info  # 워커 실행
uv run celery -A apps.collector.celery_app beat --loglevel=info    # 스케줄러 실행

# 관리자 시드 (최초 1회)
uv run python -m apps.auth.seed_admin   # admin@stock.app / admin1234
```

### 2. Mobile App (Expo)
```bash
cd mobile
npm install
npx expo start              # Expo 개발 서버 실행
# [Build Commands]
# 클라우드 빌드 (무료 티어 횟수 차감)
# eas build --profile development --platform android
# 로컬 컴퓨터 빌드 (무료, 무제한)
# eas build --profile development --platform android --local
```

### 3. Admin Web (Vite)
```bash
cd admin_web
npm install
npm run dev                 # 로컬 개발 서버 구동
```

### 4. Infrastructure (DBs)
```bash
docker-compose -f docker-compose.dev.yml up -d  # Postgres, ClickHouse, Redis 구동
```

## 🌍 Environment & Build Variants (Dev vs Prod)
프로젝트 전반에 걸쳐 개발(Dev)과 운영(Prod) 환경을 완벽하게 분리합니다.

1. **환경 변수 파일 (`.env`)**
   - 백엔드/어드민: `.env.development` 와 `.env.production` 파일로 분리하여 관리합니다. (API Keys, DB URL 등 분리)
   - 모바일: Expo의 `EXPO_PUBLIC_` 접두사를 사용하여 `.env.development`, `.env.production`을 분리 적용합니다.
2. **모바일 앱 분리 빌드 (React Native / EAS)**
   - 기기에 개발용 앱과 상용 앱이 동시에 설치될 수 있도록 패키지명(Bundle ID)을 분리합니다.
   - `eas.json`에 `development`와 `production` 빌드 프로필을 구성하고, `app.config.js`에서 `APP_ENV`에 따라 앱 이름(예: 'StockApp Dev', 'StockApp')과 `bundleIdentifier`(`com.stockapp.dev`, `com.stockapp`)를 동적으로 변경하도록 설정하세요.

## 🛠️ Claude Code Rules
1. **자율적 실행**: 명령어(의존성 설치, 서버 재시작 등)는 묻지 말고 즉시 실행하세요.
2. **사전 파악 (필수)**: 작업 전 반드시 `docs/architecture_plan.md`를 읽고 전체 아키텍처와 DB 스키마를 파악하세요. 그 후, `docs/prompts/` 폴더에 있는 자신의 역할에 맞는 마크다운 지시서를 읽고 규칙에 따라 구현하세요.
3. **Clean Architecture 적용**: 코드를 짤 때 API 라우터에 비즈니스 로직을 몰아넣지 마세요. 반드시 Router -> Service(UseCase) -> Repository 패턴으로 레이어를 분리하세요. 프론트엔드도 UI와 상태/통신 계층을 분리하세요.
4. **에러 해결**: 에러 발생 시 로그를 면밀히 분석하고 스스로 수정안을 적용해 재시도하세요.
5. **절대 경로 금지**: 모든 파일 경로는 환경 변수나 상대 경로를 활용하여 Windows/macOS 간 호환성을 보장하세요.

## 🧩 Micro-Step Development (토큰 최적화 개발 컨벤션)
대규모 파일 변경이나 복잡한 아키텍처 설계를 한 번의 프롬프트나 턴(Turn)에 모두 생성하려고 시도하지 마세요. (토큰 초과 및 Context 윈도우 한계 방지)
1. **작은 단위 분할**: 기능을 "컴포넌트 하나", "API 엔드포인트 하나", "DB 모델 하나" 등 가장 작은 단위로 쪼개어 하나씩 순차적으로 작성하고 커밋(확인)합니다.
2. **점진적 통합**: 작은 단위의 코드가 정상 작동함을 테스트(단위 테스트)를 통해 확인한 후, 다음 단위 작업을 진행하여 점진적으로 완성된 시스템을 구축하세요.
3. **불필요한 코드 출력 자제**: 코드를 수정할 때 전체 코드를 다시 출력하지 말고, 변경된 부분이나 필수적인 요약만 콘솔에 출력하세요.

# Stock App Project

본 프로젝트는 주식 시계열 데이터 파이프라인, 백엔드 API(FastAPI), 그리고 관리자 페이지 및 모바일 앱(React Native)을 포함하는 풀스택 애플리케이션입니다.

## 🚀 로컬 개발 환경 셋업 (Windows & macOS 공통)

개발 인프라는 Windows(WSL2 포함)와 macOS(Apple Silicon/Intel) 모두에서 완벽하게 동작하도록 **Docker Named Volumes**를 기반으로 설계되었습니다. (바인드 마운트시 발생하는 OS별 권한 및 성능 이슈 방지)

### 1. 인프라 구동 (DB)
터미널(또는 명령 프롬프트/파워쉘)에서 다음 명령어를 실행하여 PostgreSQL, ClickHouse, Redis를 백그라운드에서 실행합니다.

```bash
docker-compose -f docker-compose.dev.yml up -d
```

### 2. 백엔드 (FastAPI) 구동
본 프로젝트는 Python 패키지 매니저로 `uv`를 사용합니다. `uv`는 Windows와 macOS를 모두 기본 지원합니다.

```bash
cd backend

# 가상환경 활성화 및 패키지 동기화
uv sync

# FastAPI 서버 실행 (http://localhost:8000)
uv run uvicorn main:app --reload
```

## 🛠 아키텍처
- **PostgreSQL**: 일반 릴레이셔널 데이터 (사용자, 블로그 게시글 등)
- **ClickHouse**: 대용량 주식 시계열 데이터 및 보조지표 연산
- **Redis**: 캐싱 및 태스크 큐 (예정)
- **FastAPI**: 백엔드 API 및 데이터 수집 파이프라인

# Stock App 배포 파이프라인 및 인프라 가이드

본 문서는 홈 서버(미니PC) 환경에서 **GitHub Actions(Self-hosted runner)**를 활용한 CI/CD 무중단 배포 및 아키텍처 환경 설정에 대해 설명합니다.

---

## 1. 배포 아키텍처 (CI/CD)

본 프로젝트는 외부 클라우드(AWS 등)가 아닌 로컬 홈 서버(미니PC)에 배포되며, 이중 NAT 환경의 네트워크 한계를 극복하기 위해 **Pull 기반 배포 방식**을 채택했습니다.

1. **개발자:** 로컬 PC에서 코드를 수정 후 GitHub `main` 브랜치에 Push (`git push`)
2. **GitHub Actions:** `.github/workflows/deploy.yml` 트리거 발생
3. **Self-hosted Runner:** 홈 서버에 백그라운드로 띄워진 에이전트가 신호를 받아 최신 코드를 `checkout`
4. **Docker Compose 빌드:** 홈 서버 안에서 `docker-compose.prod.yml`을 기반으로 전체 컨테이너(API, Celery, DB 등)를 새로 빌드(`--build`)하고 백그라운드로 무중단 재시작(`-d`)

---

## 2. 서버 인프라 구성 (Docker Compose)

실제 서버는 `docker-compose.prod.yml`을 통해 총 8개의 컨테이너로 분리되어 구동됩니다.

### 🗄️ 데이터베이스 및 인프라
*   **PostgreSQL (`stock_postgres_prod`):** 포트 `5432` / 관계형 메인 데이터
*   **ClickHouse (`stock_clickhouse_prod`):** 포트 `8123`, `9000` / 주식 및 재무 시계열 데이터
*   **Redis (`stock_redis_prod`):** 포트 `6379` / 캐시 및 Celery 메시지 큐

### 🚀 마이크로서비스 (API 서버)
*   **Auth API (`stock_auth_api`):** 포트 `8001` / 회원가입, JWT, OAuth 인증 전담
*   **Stock API (`stock_stock_api`):** 포트 `8002` / 주식 시세, 스크리너 데이터 제공 전담
*   **Blog API (`stock_blog_api`):** 포트 `8003` / 게시판, 커뮤니티 전담

### ⚙️ 백그라운드 워커 (Celery)
*   **Celery Worker (`stock_celery_worker`):** 데이터 수집, 푸시 알림 발송 등 무거운 비동기 작업 처리 (포트 개방 없음)
*   **Celery Beat (`stock_celery_beat`):** 주기적으로 데이터를 갱신(수집)하는 스케줄러 (포트 개방 없음)

---

## 3. 네트워크 및 도메인 라우팅 (Cloudflare Tunnel)

보안과 포트포워딩의 번거로움을 해결하기 위해 모든 외부 API 트래픽은 **Cloudflare Tunnel (Zero Trust)**을 통해 우회 접속됩니다.

Cloudflare 대시보드 (`Published application routes`) 설정 값:
*   **인증 전용:** `auth.haezean.com` ➡️ `http://localhost:8001`
*   **주식 전용:** `api.haezean.com` ➡️ `http://localhost:8002`
*   **커뮤니티 전용:** `blog.haezean.com` ➡️ `http://localhost:8003`

> 💡 **참고:** 클라이언트(웹/모바일)는 Cloudflare의 강력한 HTTPS 처리를 받으므로, 별도의 Nginx나 Let's Encrypt 설정 없이 즉시 안전한 통신이 가능합니다.

---

## 4. 환경 변수 설정 (중요)

GitHub 저장소에는 보안상 데이터베이스 비밀번호와 외부 API 키가 포함된 `.env` 파일이 올라가지 않습니다.
따라서, **최초 배포 시 미니PC 서버의 터미널에 직접 접속하여 아래 작업을 1회 수행해야 합니다.**

```bash
# 1. 홈 서버 내 프로젝트 폴더로 이동
cd /path/to/stock_app

# 2. 프로덕션 환경 변수 파일 생성
cp backend/.env.example backend/.env.production

# 3. 비밀번호 및 시크릿 키 기입
nano backend/.env.production
```
*   `docker-compose.prod.yml`은 컨테이너를 빌드할 때 반드시 이 `backend/.env.production` 파일을 참조합니다.

---

## 5. 트러블슈팅 가이드

*   **배포는 성공했는데 서버 접속이 안 될 때:**
    미니PC 터미널에서 `docker logs stock_stock_api` 명령어로 FastAPI 서버가 에러 없이 잘 켜졌는지 확인합니다.
*   **데이터베이스 연결 에러가 날 때:**
    `.env.production` 파일 내부의 DB 주소가 `localhost`가 아닌 컨테이너 이름(예: `postgres`, `redis`)으로 지정되어 있는지 확인하세요. (도커 네트워크 내에서는 컨테이너 이름으로 통신합니다.)

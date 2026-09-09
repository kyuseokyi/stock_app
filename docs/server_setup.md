# 미니PC 서버 최초 설정 런북 (Ubuntu 24.04)

> **범위**: 홈 서버(미니PC)에서 **딱 한 번** 수행하는 부트스트랩. 이후 배포는 `main` push → GitHub Actions가 자동 처리.
> **관련 문서**: [`deployment_guide.md`](./deployment_guide.md)(전체 아키텍처·트러블슈팅) · [`cloudflare_termius_guide.md`](./cloudflare_termius_guide.md)(SSH 터널·Termius) · [`claude_system_context.md`](./claude_system_context.md)(제약).
> **인그레스 원칙**: 외부 노출은 **Cloudflare Tunnel 전용**. Nginx/Traefik/Let's Encrypt/포트포워딩 금지.

전제: Ubuntu 24.04 + sudo · 도메인 `haezean.com` 이 Cloudflare에 연결됨 · GitHub 저장소 `kyuseokyi/stock_app` 접근 권한.

---

## 1. Docker + Compose v2 설치
```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 러너/사용자가 sudo 없이 docker 실행하도록 (재로그인 필요)
sudo usermod -aG docker $USER
```
> ⚠️ **재로그인(또는 `newgrp docker`)** 해야 그룹 반영. 안 하면 러너가 `permission denied ... docker.sock` 으로 실패한다.

---

## 2. GitHub Actions self-hosted runner 등록 (핵심 관문)
저장소 → **Settings → Actions → Runners → New self-hosted runner** → **Linux / x64** 선택.
화면에 나오는 **정확한 버전의 다운로드·`config.sh`·토큰 명령을 그대로** 복사해 서버에서 실행한다(토큰 유효 ~1시간).

```bash
# (GitHub이 제공하는 실제 명령을 사용 — 아래는 형태 예시)
mkdir ~/actions-runner && cd ~/actions-runner
# curl -o actions-runner-linux-x64-X.Y.Z.tar.gz -L https://github.com/actions/runner/releases/download/vX.Y.Z/actions-runner-linux-x64-X.Y.Z.tar.gz
tar xzf actions-runner-*.tar.gz
./config.sh --url https://github.com/kyuseokyi/stock_app --token <GITHUB이_준_토큰>

# 서비스로 상시 실행(부팅 시 자동)
sudo ./svc.sh install
sudo ./svc.sh start
```
확인: 저장소 Settings → Runners 에 러너가 **Idle(초록)** 으로 보이면 성공. `runs-on: self-hosted` 작업을 이 러너가 잡는다.
> ⚠️ 러너 실행 사용자가 **§1의 docker 그룹**에 있어야 한다.

---

## 3. 호스트 시크릿 디렉토리 (체크아웃 밖에 보관 — 반드시)
**왜**: 러너는 매 배포마다 `actions/checkout`이 `git clean -ffdx`를 돌려 **gitignore된 파일까지 삭제**한다. 체크아웃 안에 `.env.production`을 만들어도 **다음 배포에서 사라진다**. 그래서 시크릿은 체크아웃 밖 고정 경로에 두고, 워크플로가 매번 복사해 온다(§4에 반영됨).

```bash
# ⚠️ 소유자 = 러너 실행 사용자여야 한다. 워크플로의 cp 는 그 사용자로(sudo 없이) 실행되므로
#    root:root 로 두면 배포 시 "Permission denied"로 파일을 못 읽는다.
RUNNER_USER=summersnow            # 러너 서비스 실행 사용자로 교체(systemd 'Run as user' 값)
sudo mkdir -p /opt/stock_app/env
sudo chown -R "$RUNNER_USER:$RUNNER_USER" /opt/stock_app/env
sudo chmod 700 /opt/stock_app/env
```

### 3-1. `/opt/stock_app/env/.env.production` (앱 컨테이너용)
`backend/.env.example`을 복사하되 **아래를 반드시 바꾼다**. 특히 **DB 호스트는 `localhost`가 아니라 컨테이너 이름**(도커 네트워크 내부 통신).

```bash
sudo nano /opt/stock_app/env/.env.production
```
```ini
APP_ENV=production

# DB 호스트 = 컨테이너 이름 (localhost 아님!)
DATABASE_URL=postgresql+asyncpg://stock_user:<DB비번>@postgres:5432/stock_db
SYNC_DATABASE_URL=postgresql+psycopg2://stock_user:<DB비번>@postgres:5432/stock_db
REDIS_URL=redis://redis:6379/0
CLICKHOUSE_HOST=clickhouse
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<CH비번>
CLICKHOUSE_DB=stock_data

# 서비스 간 동일해야 함 — 강한 랜덤값으로
JWT_SECRET_KEY=<openssl rand -hex 32 결과>
JWT_ALGORITHM=HS256
JWT_EXPIRE_HOURS=12

ADMIN_EMAIL=admin@stock.app
ADMIN_PASSWORD=<강한 비번>

PUSH_BACKEND=mock

# 실데이터 수집: 실전키 + prod 모드 (비우면 Mock으로 폴백 — 성공처럼 보이는 깨진 배포)
KIS_MODE=prod
KIS_APP_KEY=<실전 앱키>
KIS_APP_SECRET=<실전 시크릿>
KIS_ACCOUNT_NO=
```
```bash
sudo chmod 600 /opt/stock_app/env/.env.production
```
> ⚠️ **DB 비번은 두 곳에서 일치해야 한다**: 위 `DATABASE_URL`/`CLICKHOUSE_PASSWORD` **와** §3-2의 `compose.env`. 한쪽만 강한 비번으로 두면 컨테이너 DB(기본값으로 초기화됨)에 앱이 **인증 실패**한다.

### 3-2. `/opt/stock_app/env/compose.env` (강한 DB 비번 쓸 때만, 선택)
`docker-compose.prod.yml`의 `${POSTGRES_PASSWORD:-...}`는 **compose 변수 치환**이라 `backend/.env.production`이 아니라 **compose 프로젝트 루트의 `.env`**에서 읽는다. 강한 비번을 쓰려면:
```ini
POSTGRES_USER=stock_user
POSTGRES_PASSWORD=<DB비번>      # §3-1 URL과 동일
POSTGRES_DB=stock_db
CLICKHOUSE_PASSWORD=<CH비번>    # §3-1과 동일
```
> 기본값(`stock_password`/`password`)을 그대로 쓸 거면 이 파일은 생략 가능(단 보안 약함).

---

## 4. 워크플로의 시크릿 주입 (이미 반영됨 — 참고)
`.github/workflows/deploy.yml`이 매 배포에서 `/opt/stock_app/env/.env.production`을 `backend/.env.production`으로 **복사(없으면 실패)**, `compose.env`가 있으면 루트 `.env`로 복사한다. → 시크릿은 git에 안 올라가고, 매 배포마다 호스트에서 주입된다.

---

## 5. Cloudflare Tunnel (인그레스)
`cloudflared` 설치:
```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```
[Cloudflare Zero Trust → Networks → Tunnels]에서 터널 생성 후, **Published application routes**에 3개 API 서브도메인을 추가(자세한 대시보드 절차는 `cloudflare_termius_guide.md` §3.1 참조):

| Hostname | Service |
|---|---|
| `auth.haezean.com` | `http://localhost:8001` |
| `api.haezean.com` | `http://localhost:8002` |
| `blog.haezean.com` | `http://localhost:8003` |

> ⚠️ **DB 포트(5432·8123·9000·6379)에는 터널 호스트네임을 절대 붙이지 않는다.** 외부 노출 금지, LAN 전용. Cloudflare가 붙는 건 위 3개 API 서브도메인뿐.

---

## 6. 최초 배포 트리거
`dev → main` 병합 후 push하면 러너가 `docker compose -f docker-compose.prod.yml up -d --build`를 실행한다.
```bash
# (로컬에서) 실제 배포 트리거
git checkout main && git merge dev && git push origin main
```
→ GitHub Actions 탭에서 `Deploy Production to Home Server` 실행을 확인.

---

## 7. 스키마 부트스트랩 (최초 1회 — 생략하면 전 요청 500!)
`docker-compose.prod.yml`/`deploy.yml`에는 **마이그레이션이 없다**. 첫 배포 후 볼륨이 비어 있으므로, 서버에서 **한 번** 스키마를 만든다(이미지에 deps가 system 설치돼 있어 `uv run` 불필요):
```bash
# 배포와 동일한 compose 프로젝트에서 실행해야 이미지/네트워크가 일치한다.
# 러너 기본 체크아웃 경로:
cd ~/actions-runner/_work/stock_app/stock_app
docker compose -f docker-compose.prod.yml run --rm stock_api alembic upgrade head
docker compose -f docker-compose.prod.yml run --rm stock_api python -m shared.clickhouse_schema
docker compose -f docker-compose.prod.yml run --rm auth_api python -m apps.auth.seed_admin
```
- `alembic upgrade head` — PostgreSQL 스키마(4개 마이그레이션)
- `shared.clickhouse_schema` — ClickHouse 테이블(멱등, 재실행 안전)
- `apps.auth.seed_admin` — 관리자 계정(`ADMIN_EMAIL`/`ADMIN_PASSWORD`)

---

## 8. 검증
```bash
docker compose -f docker-compose.prod.yml ps       # 8컨테이너 up/healthy 확인
docker compose -f docker-compose.prod.yml logs -f stock_api   # 부팅 에러 확인
curl -s https://api.haezean.com/graphql -H 'content-type: application/json' \
  -d '{"query":"{ __typename }"}'                  # Cloudflare 경유 응답 확인
```

---

## 9. 트러블슈팅
| 증상 | 원인/조치 |
|---|---|
| 러너가 작업을 안 잡음(대기) | 러너 오프라인이거나 docker 그룹 미가입(§1·§2) |
| 배포 성공했는데 접속 불가 | `docker compose logs stock_api`로 FastAPI 부팅 에러 확인 |
| DB 연결 에러 | `.env.production`의 DB 호스트가 `localhost` → **컨테이너 이름**(`postgres`/`redis`/`clickhouse`)이어야(§3-1) |
| DB 인증 실패 | `DATABASE_URL` 비번 ≠ `compose.env` 비번(§3 경고). 볼륨은 최초 비번으로 고정되므로 바꾸려면 볼륨 삭제 필요 |
| 배포 중 `.env.production` Permission denied | 시크릿 소유자가 `root`. 러너 사용자로 `sudo chown -R <러너>:<러너> /opt/stock_app/env`(§3) |
| 전 요청 500 (테이블 없음) | §7 스키마 부트스트랩 미실행 |
| 데이터가 Mock으로 나옴 | `KIS_APP_KEY` 비었거나 `KIS_MODE≠prod`(§3-1) |

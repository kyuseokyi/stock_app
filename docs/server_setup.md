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

| Hostname | Type | Service |
|---|---|---|
| `auth.haezean.com` | HTTP | `localhost:8001` (auth API) |
| `api.haezean.com` | HTTP | `localhost:8002` (stock API) |
| `blog.haezean.com` | HTTP | `localhost:8003` (blog API) |
| `app.haezean.com` | HTTP | `localhost:3000` (web_client) |
| `admin.haezean.com` | HTTP | `localhost:3001` (admin_web) |

> Type은 **HTTP**(로컬 uvicorn/serve는 평문). 외부 HTTPS는 Cloudflare 엣지가 종단한다 — 로컬 인증서 불필요.
> ⚠️ **DB 포트(5432·8123·9000·6379)에는 터널 호스트네임을 절대 붙이지 않는다.** 외부 노출 금지, LAN 전용. Cloudflare가 붙는 건 위 API·프론트 서브도메인뿐.

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

## 9. 디스크 관리 (이미지·빌드캐시)
데이터(ClickHouse 시계열)는 압축돼 작지만, **매 배포의 `--build`로 오래된 이미지·빌드캐시가 누적**되는 게 유일한 디스크 관리 포인트다.

**① 오래된 이미지 자동 삭제** — `deploy.yml`에 반영됨: 배포 끝에 `docker image prune -f`로 교체된 dangling 이미지 제거(실행 중 스택 이미지·볼륨은 보존). 별도 조치 불필요.

**② 빌드 캐시 10GB 상한** — Docker 데몬 GC로 설정(항상 자동 적용). `/etc/docker/daemon.json`:
```json
{
  "builder": { "gc": { "enabled": true, "defaultKeepStorage": "10GB" } }
}
```
```bash
sudo nano /etc/docker/daemon.json      # 다른 설정이 있으면 병합
sudo systemctl restart docker          # ⚠️ 모든 컨테이너 재시작 → 수집 중이면 끝난 뒤 적용
```
→ BuildKit이 캐시를 **10GB 이하로 유지**(초과분 자동 GC). 캐시를 남겨 빌드 속도는 유지하면서 상한만 건다.

**현황 확인 / 수동 정리**:
```bash
docker system df                       # 이미지/컨테이너/볼륨/빌드캐시 용량
df -h /                                # 디스크 여유
docker image prune -af                 # (필요시) 미사용 이미지 삭제
docker builder prune -f                # (필요시) 빌드 캐시 전체 삭제
```
> ⚠️ **`docker system prune --volumes` 절대 금지** — `pg_data_prod`·`clickhouse_data_prod`·`redis_data_prod` 볼륨(=DB 실데이터)이 삭제된다. `image`/`builder` prune만 볼륨을 건드리지 않는다.

---

## 10. 트러블슈팅
| 증상 | 원인/조치 |
|---|---|
| 러너가 작업을 안 잡음(대기) | 러너 오프라인이거나 docker 그룹 미가입(§1·§2) |
| 배포 성공했는데 접속 불가 | `docker compose logs stock_api`로 FastAPI 부팅 에러 확인 |
| DB 연결 에러 | `.env.production`의 DB 호스트가 `localhost` → **컨테이너 이름**(`postgres`/`redis`/`clickhouse`)이어야(§3-1) |
| DB 인증 실패 | `DATABASE_URL` 비번 ≠ `compose.env` 비번(§3 경고). 볼륨은 최초 비번으로 고정되므로 바꾸려면 볼륨 삭제 필요 |
| 배포 중 `.env.production` Permission denied | 시크릿 소유자가 `root`. 러너 사용자로 `sudo chown -R <러너>:<러너> /opt/stock_app/env`(§3) |
| 전 요청 500 (테이블 없음) | §7 스키마 부트스트랩 미실행 |
| alembic 돌렸는데 `relation "users" does not exist` | alembic이 `@localhost`(빈 곳)에 붙음. `env.py`는 `SYNC_DATABASE_URL`(=@postgres)을 자동 사용하도록 수정됨 — 구 이미지면 `-e ALEMBIC_DATABASE_URL='postgresql+psycopg2://stock_user:stock_password@postgres:5432/stock_db'` 로 재실행 후 seed_admin |
| 데이터가 Mock으로 나옴 | `KIS_APP_KEY` 비었거나 `KIS_MODE≠prod`(§3-1) |
| 전종목 수집이 특정 개수(예: ~928)부터 줄줄이 `Max retries exceeded` | 연결계열 실패. §11 참조(코드 완화 적용됨 — Session 재사용 + 적응형 쿨다운 + 연결계열 2차 재시도). 근본원인은 로그의 errno로 확정 |

## 11. 수집 신뢰성 (연결계열 실패 완화·진단)
KIS 시세 상한은 **20 TPS**. 우리는 8/s(=40%)로 도는데도 대량 순회(~928종목) 후 연결오류가 관찰됐다 → **TPS 초과가 원인이 아니다.** 코드에 3중 완화를 적용했다(`apps/collector/kis/client.py`, `apps/collector/tasks/universe.py`):

1. **커넥션 재사용**: `KISClient`가 인스턴스 `requests.Session`(keep-alive, 풀=4)으로 요청 → 매 요청 새 TCP+TLS 핸드셰이크 폭주를 제거.
2. **적응형 쿨다운**: 연결계열(`KISConnectionError`) 연속 실패가 임계치(기본 5) 이상이면 `60→120→…→600초`로 쉬었다 재개(성공 시 리셋). 4xx·rt_cd 논리오류는 대상 아님(즉시 격리).
3. **연결계열 2차 재시도**: 1차에서 연결계열로 실패한 종목만 쿨다운 후 한 번 더 시도(논리오류는 재시도 안 함).

튜닝 env(선택, `.env.production`): `KIS_RATE_PER_SEC`(기본 8), `KIS_COOLDOWN_THRESHOLD`(5), `KIS_COOLDOWN_BASE_SEC`(60), `KIS_COOLDOWN_MAX_SEC`(600).

**⚠️ 검증 순서(중요)**: 전종목 재시도 전 **20종목 프로브**부터.
```bash
# 20종목만 먼저 — 성공하면 차단 해제 상태, 실패하면 아직 원격 차단(코드로 못 고침 → 대기)
docker exec stock_celery_worker \
  celery -A apps.collector.celery_app call collector.collect_all_daily --kwargs '{"limit": 20}'
docker exec stock_celery_worker celery -A apps.collector.celery_app inspect active   # 진행 확인
docker logs -f stock_celery_worker                                                   # errno 확인
```

**근본원인 확정(다음 실패 시, 실행 *중*에)**: 코드가 실패를 `repr`로 남기므로 로그의 `[Errno …]`가 그대로 보인다. 의미:
| 로그의 errno | 원인 | 처방 |
|---|---|---|
| `[Errno 99]`/`[Errno 98] Cannot assign requested address` | 로컬 포트 고갈 | Session이 해결(적용됨). `sysctl net.ipv4.ip_local_port_range` 확인 |
| `Connection reset by peer`/TLS 핸드셰이크 실패 | 원격 엣지가 핸드셰이크 레이트 차단 | Session이 핸드셰이크 수를 급감시켜 해결 |
| `Read timed out`/`[Errno 110]` (connect) | 원격 지연/IP 차단 | 쿨다운이 완화. 코드로 근본 해결 불가 → 대기 |
| `dmesg`에 `nf_conntrack: table full` | conntrack 테이블 포화 | 코드 아님 → sysctl 조정 |

실행 *중* 미니PC에서 로컬 자원 소진 여부를 초 단위로 판별:
```bash
ss -tan state time-wait | wc -l                              # TIME_WAIT 소켓 수(수만이면 포트압박)
cat /proc/sys/net/netfilter/nf_conntrack_count               # 현재 conntrack 엔트리
cat /proc/sys/net/netfilter/nf_conntrack_max                 # 상한(count가 근접하면 포화)
dmesg | tail -30                                             # conntrack table full 경고 확인
```
> 재발 위치가 단서: **같은 개수(~900~1000)에서 또 막히면** 미확인 자원 상한, **랜덤/즉시면** 원격 차단. 전종목 1회가 깨끗이 끝나기 전엔 "해결"로 보고하지 않는다.

# 수평 확장 배포 가이드 (Docker Swarm · Kubernetes) — 초보자용

> 대상: Docker Compose 는 써 봤지만 **Swarm·Kubernetes 는 처음**인 사람.
> 지금 개발 서버(미니PC)는 계속 `docker-compose.prod.yml` 로 운영합니다. 이 문서는 **상용 서버로 갈 때** 쓰는 준비물입니다.
> 설계 배경: [`docs/superpowers/specs/2026-10-14-horizontal-scaling-swarm-k8s-design.md`](../superpowers/specs/2026-10-14-horizontal-scaling-swarm-k8s-design.md)

| 파일 | 용도 |
|------|------|
| [`deploy/swarm/stack.yml`](../../deploy/swarm/stack.yml) | Docker Swarm 스택 (단계 B) |
| [`deploy/swarm/stack.env.example`](../../deploy/swarm/stack.env.example) | Swarm 용 비밀 아닌 설정 예시 |
| [`deploy/k8s/base/`](../../deploy/k8s/base) | Kubernetes 공통 정의 (단계 C) |
| [`deploy/k8s/overlays/dev/`](../../deploy/k8s/overlays/dev) | 내 컴퓨터(k3d) 실습용 |
| [`deploy/k8s/overlays/prod/`](../../deploy/k8s/overlays/prod) | 상용 클러스터용 (레플리카 2+, 오토스케일) |
| [`prod-release.md`](prod-release.md) | 상용 배포 — `release/v*` 태그로 개발 서버와 분리(`.github/workflows/deploy-prod.yml`) |

---

## 목차
0. [먼저 개념부터 (10분)](#0-먼저-개념부터-10분)
1. [왜 코드를 "무상태"로 바꿨나](#1-왜-코드를-무상태로-바꿨나)
2. [어떤 걸 고를까 — A / B / C](#2-어떤-걸-고를까--a--b--c)
3. [단계 A — 지금(docker compose)](#단계-a--지금-docker-compose)
4. [단계 B — Docker Swarm](#단계-b--docker-swarm)
5. [단계 C — Kubernetes](#단계-c--kubernetes)
6. [상용 전환 체크리스트](#상용-전환-체크리스트)
7. [FAQ](#faq)

---

## 0. 먼저 개념부터 (10분)

식당에 비유해서 설명합니다.

| 용어 | 한 줄 설명 | 비유 |
|------|-----------|------|
| **이미지(Image)** | 앱 코드 + 파이썬 + 라이브러리를 한 덩어리로 굳힌 "설치 파일". `docker build` 로 만든다. 우리 백엔드는 **이미지 1개**(`stock-app-backend`)를 명령만 바꿔 7가지 서비스로 쓴다. | 레시피 + 재료를 밀키트로 포장 |
| **컨테이너(Container)** | 이미지를 실제로 실행한 것(프로세스). 지우고 다시 만들어도 이미지만 같으면 똑같이 동작. | 밀키트를 데워 만든 요리 1인분 |
| **레지스트리(Registry)** | 이미지를 올려 두는 저장소(Docker Hub, AWS ECR, GCP Artifact Registry, NCP Container Registry 등). 서버가 여러 대면 각 서버가 여기서 이미지를 받아 간다. | 밀키트 물류창고 |
| **레플리카(Replica)** | 같은 서비스를 **몇 개 동시에** 띄울지. `replicas: 2` = 같은 컨테이너 2개. | 같은 메뉴를 만드는 요리사 수 |
| **서비스(Service)** | 레플리카 여러 개를 **하나의 이름·주소**로 묶은 것. 요청은 그중 아무 컨테이너로 간다. | 주문 창구 하나(뒤에 요리사 여럿) |
| **로드밸런서(Load Balancer)** | 들어온 요청을 레플리카들에 **골고루 나눠 주는** 장치. Swarm 은 "라우팅 메시", k8s 는 Service 가 자동으로 해 준다. | 주문을 요리사에게 나눠 주는 매니저 |
| **노드(Node)** | 컨테이너를 실제로 돌리는 서버(물리/가상 머신) 한 대. | 주방 하나 |
| **클러스터(Cluster)** | 노드 여러 대를 하나처럼 묶은 것. 노드 한 대가 죽으면 그 위 컨테이너는 다른 노드에서 자동으로 다시 뜬다. | 체인점 주방 여러 개를 본사가 통합 관리 |
| **Ingress** (k8s) | 외부(인터넷)에서 들어온 HTTP 요청을 **도메인별로** 알맞은 Service 로 보내는 입구. 예: `auth.example.com → auth`. 실제 처리는 "Ingress 컨트롤러"(nginx-ingress 등)가 한다. | 건물 1층 안내데스크 |
| **ConfigMap** (k8s) | **비밀이 아닌** 설정값 모음(Redis 주소, 도메인 등). 컨테이너에 env 로 주입. | 매장 공지 게시판 |
| **Secret** (k8s / Swarm) | **비밀번호·API 키** 모음. 이미지·git 에 넣지 않고 클러스터에만 저장, 컨테이너 안에서는 파일(`/etc/stock-app/secrets/…`, Swarm 은 `/run/secrets/…`)로 보인다. | 금고 |
| **Probe / Healthcheck** | "이 컨테이너 살아 있나? 요청 받을 준비 됐나?"를 주기적으로 물어보는 검사. 우리 API 는 `/health`(살아 있음)·`/ready`(DB·Redis 연결 OK) 를 제공. | 요리사 컨디션 체크 |
| **롤링 업데이트** | 새 버전을 **하나씩** 띄우고 준비되면 옛 것을 내리는 방식 → 배포 중에도 서비스가 안 끊김. 문제 생기면 **롤백**(이전 버전으로 되돌리기). | 요리사를 한 명씩 교대 |
| **HPA** (k8s) | Horizontal Pod Autoscaler. CPU 사용률을 보고 레플리카 수를 **자동으로** 늘리고 줄인다(우리는 70% 기준, 2~6개). | 손님 많으면 알바 자동 호출 |
| **Pod** (k8s) | k8s 에서 컨테이너를 감싸는 최소 실행 단위. 우리 구성에선 "Pod 1개 = 컨테이너 1개"로 생각해도 된다. | 요리사 1명 |
| **Deployment** (k8s) | "이 이미지로 Pod 를 N개 유지해 줘"라는 선언. 죽으면 다시 띄우고, 이미지가 바뀌면 롤링 업데이트. | 인력 배치표 |
| **Namespace** (k8s) | 클러스터 안의 폴더. 우리 앱은 모두 `stock-app` 안에. | 층/구역 |

### Swarm vs Kubernetes 한 줄 비교
- **Docker Swarm**: Docker 에 내장. 지금 쓰는 compose 파일과 거의 같은 문법. **배우기 쉽고 작은 규모(서버 2~5대)에 충분.**
- **Kubernetes(k8s)**: 업계 표준. 기능(오토스케일·생태계·클라우드 관리형)이 많지만 개념이 더 많다. **클라우드(EKS/GKE/NKS)로 크게 갈 때.**

---

## 1. 왜 코드를 "무상태"로 바꿨나

컨테이너를 2개 이상 띄우면, 사용자 A 의 요청은 1번 컨테이너로, 다음 요청은 2번 컨테이너로 갈 수 있습니다.
그래서 **"메모리에만 있는 상태"에 기대면 안 됩니다.** 이번에 바뀐 점(요약):

1. **WebSocket 메시지를 Redis Pub/Sub 로 전달** (trading_game)
   - 예전: 틱·손익 메시지를 "내 프로세스에 접속한 사람"에게만 직접 보냄 → 컨테이너가 2개면 반대편 접속자는 못 받음.
   - 지금: 메시지를 Redis 채널(`game:ws:broadcast`, `game:ws:user:{id}`)에 **발행**하고, 모든 컨테이너가 **구독**해서 자기에게 붙은 접속자에게 전달.
   - 그래서 **sticky 세션(같은 사용자를 같은 컨테이너로 고정) 필요 없음.**
2. **싱글톤 작업은 리더 선출** (trading_game)
   - 틱 리스너(+자동청산), 0.25초 방송 루프, 1초 손익 루프, 시장심리 루프는 **전체에서 딱 1개만** 돌아야 함(2개면 청산이 두 번 일어남).
   - Redis 락(`game:leader:{이름}`)을 잡은 컨테이너 1개만 실행. 그 컨테이너가 갑자기 죽으면 **최대 약 TTL×4/3 + 리스너 기동 시간(기본 TTL 10초 → 약 13초) 안에 다른 컨테이너가 이어받음**(로컬 실측: TTL 3초 → 4.2초). 정상 종료(SIGTERM, 롤링 업데이트)면 락을 즉시 반납해 **1초 이내** 승계(실측 0.65초).
3. **헬스체크** — 모든 API 에 `/health`(프로세스 생존)·`/ready`(DB `SELECT 1` + Redis `PING`, 실패 시 503).
4. **비밀값 파일 지원** — `JWT_SECRET_KEY_FILE=/run/secrets/jwt_secret_key` 처럼 `X_FILE` 을 주면 그 파일 내용을 `X` 로 읽음(없으면 기존 env 그대로). 허용 목록(`shared/env.py` `FILE_ENV_KEYS`) 키만 처리 — 그 밖의 키는 `APP_FILE_ENV_EXTRA=KEY1,KEY2` 로 추가, 목록 밖 `*_FILE`(SSL_CERT_FILE 등)은 무시.

### ⚠️ 절대 복제하면 안 되는 서비스 (replicas = 1 고정)
| 서비스 | 이유 |
|--------|------|
| `game_ws` (k8s: `game-ws`) | KIS 실시간 WebSocket 세션은 **앱키당 개수 제한**. 2개면 서로 세션을 끊거나 틱이 중복 발행됨. |
| `celery_beat` (k8s: `celery-beat`) | 스케줄러가 2개면 **모든 정기 작업(수집·정산·주간마감·퀴즈 생성)이 두 번** 실행됨. |

이 둘은 업데이트 때도 "옛 것 먼저 끄고 새 것 켜기"(Swarm `stop-first`, k8s `Recreate`)로 설정돼 있어 순간적으로도 2개가 되지 않습니다.
`celery_worker` 는 여러 개여도 괜찮습니다(같은 큐를 나눠 처리, 정산·주간마감 태스크는 멱등).

---

## 2. 어떤 걸 고를까 — A / B / C

| 단계 | 언제 | 서버 | 난이도 |
|------|------|------|--------|
| **A. docker compose** (현재) | 동시접속 수백 명까지, 서버 1대 | 미니PC 1대 | ★ |
| **B. Docker Swarm** | 서버 2~5대로 늘리고 싶을 때, 무중단 배포·자동 복구가 필요할 때 | VM 여러 대 | ★★ |
| **C. Kubernetes** | 클라우드 관리형으로 크게 키울 때, 오토스케일이 필요할 때 | EKS/GKE/NKS | ★★★ |

추천 순서: **A 로 운영 → 필요해지면 B** → 더 커지면 C. 이 문서의 C 는 내 컴퓨터에서 먼저 **연습(k3d)** 해 볼 수 있게 되어 있습니다.

공통 전제: **DB(PostgreSQL)·Redis·ClickHouse 는 클러스터 밖**에 둡니다(기존 서버나 관리형 RDS/ElastiCache 등). 데이터베이스는 컨테이너를 늘렸다 줄였다 하는 대상이 아니기 때문입니다. 클러스터 안의 앱들은 주소(env)로 접속만 합니다.

---

## 단계 A — 지금 (docker compose)

변경 없음. `docker-compose.prod.yml` + GitHub Actions(`Deploy Server`)로 미니PC 에 배포합니다([`docs/server_setup.md`](../server_setup.md)).
이번 코드 변경(Pub/Sub·리더 선출) 후에도 **인스턴스 1개에서 그대로 동작**합니다(1개뿐이면 그 컨테이너가 항상 리더).

현재 포트(= Cloudflare Tunnel 대상, Swarm 에서도 동일하게 유지):

| 도메인 | 포트 | 서비스 |
|--------|------|--------|
| auth.haezean.com | 8001 | auth_api |
| api.haezean.com | 8002 | stock_api |
| blog.haezean.com | 8003 | blog_api |
| game.haezean.com | 8004 | trading_game (REST + WS) |
| app / admin.haezean.com | 3000 / 3001 | web_client / admin_web (정적 — 이 문서 범위 밖, 기존 compose 유지) |

---

## 단계 B — Docker Swarm

### B-0. 준비물
- Linux 서버(VM) 2대 이상, Docker 설치(compose 와 같은 Docker 면 됨).
- 서버끼리 포트 열기: `2377/tcp`(클러스터 관리), `7946/tcp+udp`(노드 통신), `4789/udp`(오버레이 네트워크).
- DB·Redis·ClickHouse 가 각 서버에서 접속 가능한 주소에 있어야 함.

### B-1. Swarm 만들기 (매니저 1대에서)
```bash
docker swarm init --advertise-addr <이 서버의 내부 IP>
# 출력된 "docker swarm join --token SWMTKN-... <IP>:2377" 명령을 복사
```

### B-2. 다른 서버를 워커로 참여
```bash
# 워커 서버에서
docker swarm join --token SWMTKN-... <매니저IP>:2377

# 매니저에서 확인
docker node ls        # STATUS=Ready 가 서버 수만큼 보이면 OK
```
> 매니저는 3대(홀수)로 두면 매니저 1대가 죽어도 클러스터가 유지됩니다: `docker swarm join-token manager` 로 토큰을 받아 참여.

### B-3. 비밀값(secret) 등록 (매니저에서, 1회)
비밀값은 파일·git 에 남기지 않고 Swarm 에 등록합니다. 컨테이너 안에선 `/run/secrets/<이름>` 파일로 보입니다.
```bash
# printf 로 넣으면 줄바꿈이 붙지 않는다. 명령이 셸 히스토리에 남지 않게 앞에 공백을 두거나 history 를 지우세요.
printf '%s' 'postgresql+asyncpg://stock_user:<비번>@<DB주소>:5432/stock_db'  | docker secret create database_url -
printf '%s' 'postgresql+psycopg2://stock_user:<비번>@<DB주소>:5432/stock_db' | docker secret create sync_database_url -
printf '%s' '<ClickHouse 비번>'   | docker secret create clickhouse_password -
openssl rand -hex 32 | tr -d '\n'  | docker secret create jwt_secret_key -      # 모든 서비스 공통
printf '%s' '<KIS App Key>'       | docker secret create kis_app_key -
printf '%s' '<KIS App Secret>'    | docker secret create kis_app_secret -
# 간편 로그인(auth 만 사용)
printf '%s' '<카카오 REST API 키>' | docker secret create kakao_rest_api_key -
printf '%s' '<카카오 Client Secret>' | docker secret create kakao_client_secret -
printf '%s' '<카카오 Admin 키>'     | docker secret create kakao_admin_key -
printf '%s' '<네이버 Client Secret>' | docker secret create naver_client_secret -
openssl rand -hex 32 | tr -d '\n'  | docker secret create social_state_secret -

docker secret ls
```
- Swarm secret 은 **빈 값으로 만들 수 없습니다.** 안 쓰는 공급자(예: 네이버 미사용)는 `stack.yml` 에서 해당 secret 줄·`*_FILE` env·하단 정의 3곳을 함께 지우세요.
- secret 은 **수정이 안 됩니다.** 바꾸려면 새 이름으로 만들고(`jwt_secret_key_v2`) stack.yml 을 바꿔 다시 deploy 하거나, 서비스에서 떼고 지운 뒤 다시 만듭니다.
- 값은 **상용용으로 새로** 준비합니다(개발 서버 `.env.production` 값 재사용 금지 — 특히 JWT·state 키는 새로 생성, DB 호스트는 `postgres` 가 아닌 **외부 DB 주소**). DB 비밀번호에 특수문자가 있으면 URL 인코딩(`@`→`%40`). env 이름 ↔ secret 이름: `DATABASE_URL`→`database_url`, `SYNC_DATABASE_URL`→`sync_database_url`, `CLICKHOUSE_PASSWORD`→`clickhouse_password`, `JWT_SECRET_KEY`→`jwt_secret_key`, `KIS_APP_KEY`/`KIS_APP_SECRET`→`kis_app_key`/`kis_app_secret`, `KAKAO_REST_API_KEY`/`KAKAO_CLIENT_SECRET`/`KAKAO_ADMIN_KEY`, `NAVER_CLIENT_SECRET`, `SOCIAL_STATE_SECRET` → 소문자 이름.
- 앱은 (허용 목록의) `X_FILE` 이 가리키는 파일이 없으면 **기동에 실패**합니다(조용히 빈 값으로 뜨는 것 방지). secret 을 지웠다면 해당 `*_FILE` env 도 꼭 지우세요.

### B-4. 이미지 빌드 & 레지스트리에 올리기
Swarm 은 `build:` 를 무시합니다. 모든 노드가 받아 갈 수 있게 **레지스트리에 push** 해야 합니다.
```bash
export REGISTRY=registry.example.com          # 예: docker.io/<내계정>, <계정>.dkr.ecr.ap-northeast-2.amazonaws.com
export TAG=$(git rev-parse --short HEAD)     # 커밋 해시를 태그로 쓰면 롤백이 쉽다
docker build -t $REGISTRY/stock-app-backend:$TAG backend
docker login $REGISTRY
docker push $REGISTRY/stock-app-backend:$TAG
```
> 레지스트리가 없다면(실습) Swarm 안에 간단히 띄울 수 있습니다:
> `docker service create --name registry --publish 5000:5000 registry:2` → `REGISTRY=127.0.0.1:5000`.

### B-5. DB 마이그레이션 (배포 전 1회, 매 배포마다)
마이그레이션은 **딱 한 번만** 돌아야 해서 스택에 넣지 않았습니다. one-off 컨테이너로 실행합니다(멱등 — 이미 최신이면 아무것도 안 함).
`docker run` 은 Swarm secret 을 못 쓰므로 **상용 DB 주소**를 직접 env 로 넘깁니다.
```bash
# 상용 DB 주소(외부 DB 서버/관리형). 비밀번호에 특수문자(@ : / # 등)가 있으면 URL 인코딩(@ → %40)
docker run --rm \
  -e SYNC_DATABASE_URL='postgresql+psycopg2://stock_user:<비번>@<상용 DB주소>:5432/stock_db' \
  $REGISTRY/stock-app-backend:$TAG alembic upgrade head
```
> ⚠️ 미니PC 의 `/opt/stock_app/env/.env.production` 을 쓰지 마세요. 그건 **개발 서버(develop)** 용이고 DB 호스트가 compose 서비스 이름 `postgres` 라 Swarm 노드에서는 닿지도 않습니다.
> 매번 입력이 번거로우면 상용 전용 파일(예: `/opt/stock_app/env/migrate.prod.env`, 권한 600, `SYNC_DATABASE_URL=...` 한 줄)을 만들어 `--env-file` 로 넘기세요.

### B-6. 스택 배포
```bash
cp deploy/swarm/stack.env.example deploy/swarm/stack.env   # 최초 1회, 값 수정(커밋 금지)
set -a; . deploy/swarm/stack.env; set +a                     # 셸 env 로 로드
export TAG=<B-4 의 태그>                                      # stack.env 의 TAG 보다 우선하게 하려면 로드 후 export
docker stack deploy -c deploy/swarm/stack.yml --with-registry-auth stock
```
확인:
```bash
docker stack services stock      # REPLICAS 가 2/2, 1/1 로 차면 OK
docker stack ps stock            # 각 컨테이너가 어느 노드에서 도는지, 실패 이유(ERROR 열)
curl -s http://<아무노드IP>:8001/health
curl -s http://<아무노드IP>:8004/ready
```
**라우팅 메시**: published 포트(8001~8004)는 **모든 노드**에서 열립니다. 어느 노드로 들어와도 Swarm 이 살아 있는 컨테이너로 보내 줍니다.
→ Cloudflare Tunnel(cloudflared)은 노드 중 아무 곳(또는 여러 곳)에 두고 기존처럼 `localhost:8001` 등으로 연결하면 됩니다.

### B-7. 스케일 (개수 조절)
```bash
docker service scale stock_trading_game=4 stock_stock_api=3
docker service ls
```
> ⚠️ `stock_game_ws`, `stock_celery_beat` 는 **절대 1 이외로 바꾸지 마세요**(§1 표).
> 이렇게 바꾼 개수는 다음 `stack deploy` 때 stack.yml 의 값으로 돌아갑니다. 영구히 바꾸려면 stack.yml 의 `replicas` 를 수정하세요.

### B-8. 업데이트 (새 버전 배포)
```bash
set -a; . deploy/swarm/stack.env; set +a       # 먼저 로드(REGISTRY 등)하고
export TAG=$(git rev-parse --short HEAD)       # 그다음 TAG 덮어쓰기(순서가 반대면 stack.env 의 TAG 로 돌아감)
docker build -t $REGISTRY/stock-app-backend:$TAG backend && docker push $REGISTRY/stock-app-backend:$TAG
docker run --rm --env-file /opt/stock_app/env/migrate.prod.env $REGISTRY/stock-app-backend:$TAG alembic upgrade head   # B-5
docker stack deploy -c deploy/swarm/stack.yml --with-registry-auth stock
```
- API·워커: **start-first** — 새 컨테이너가 healthy 가 된 다음 옛 것을 내립니다(무중단).
- game_ws·celery_beat: **stop-first** — 옛 것을 끈 뒤 새 것을 켭니다(잠깐 공백, 중복 없음).
- 새 버전이 healthcheck 를 통과 못 하면 **자동 롤백**(`failure_action: rollback`).

### B-9. 롤백 (이전 버전으로)
```bash
docker service rollback stock_trading_game     # 서비스 하나만 직전 버전으로
# 전체를 특정 버전으로: TAG 를 이전 값으로 두고 B-6 을 다시 실행
```

### B-10. 로그·문제 해결
```bash
docker service logs -f --tail 100 stock_trading_game    # 레플리카 전체 로그가 합쳐서 나옴
docker service ps --no-trunc stock_auth_api              # 재시작 반복 시 ERROR 열에 이유
docker service inspect --pretty stock_auth_api
```
| 증상 | 원인·해결 |
|------|-----------|
| REPLICAS 가 0/2 에서 안 올라감 | 이미지 pull 실패(`--with-registry-auth` 빠짐, 태그 오타) 또는 secret 없음 → `docker service ps --no-trunc` |
| 계속 재시작 | `/ready` 실패 = DB·Redis 에 못 붙음. 주소·방화벽·secret 값(줄바꿈 포함 여부) 확인 |
| 노드 하나를 점검하고 싶다 | `docker node update --availability drain <노드>` → 컨테이너가 다른 노드로 이동. 끝나면 `active` |

> 참고: Swarm 의 healthcheck 가 `/ready`(DB·Redis 포함)라서 **DB 가 잠깐 끊기면 API 컨테이너들이 재시작**될 수 있습니다. DB 가 돌아오면 자동 회복되며, 재시작 폭주를 줄이려고 `retries: 4`, `start_period` 를 넉넉히 두었습니다.

### B-11. 정리
```bash
docker stack rm stock            # 스택 제거(secret 은 남음)
docker swarm leave --force       # (실습 끝) 이 노드를 Swarm 에서 빼기
```

---

## 단계 C — Kubernetes

순서: **C-1~C-5 내 컴퓨터(k3d)에서 연습** → **C-6 클라우드 상용**.

### C-1. 도구 설치 (macOS 기준)
```bash
brew install kubectl k3d     # kubectl: k8s 조작 CLI / k3d: Docker 안에 작은 k8s(k3s) 클러스터를 만들어 줌
kubectl version --client
k3d version
```
> Windows 는 `winget install Kubernetes.kubectl` + `choco install k3d`(또는 Docker Desktop 의 Kubernetes 사용).
> kustomize 는 kubectl 에 내장돼 있어 따로 설치할 필요 없습니다(`kubectl kustomize`, `kubectl apply -k`).

### C-2. 로컬 클러스터 만들기
```bash
# k3d 는 기본 Ingress 로 Traefik 을 깔지만 우리 설정은 nginx 기준 → Traefik 끄고 생성
k3d cluster create stock \
  --agents 2 \
  -p "8080:80@loadbalancer" \
  --k3s-arg "--disable=traefik@server:0"

kubectl get nodes            # server 1 + agent 2 = 노드 3개가 Ready
```
(선택) Ingress 까지 실습하려면 nginx-ingress 설치:
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/cloud/deploy.yaml
kubectl -n ingress-nginx wait --for=condition=available deploy/ingress-nginx-controller --timeout=180s
```

### C-3. 로컬 DB 띄우기 & 이미지 넣기
dev overlay 는 **내 컴퓨터의 docker-compose.dev.yml DB** 를 `host.k3d.internal` 주소로 씁니다(k3d 가 자동으로 만들어 주는 "호스트 PC" 주소).
```bash
docker compose -f docker-compose.dev.yml up -d        # Postgres 5432 · ClickHouse 8123 · Redis 6379

# 이미지 빌드 → k3d 클러스터 안으로 복사(레지스트리 불필요)
docker build -t stock-app-backend:dev backend
k3d image import stock-app-backend:dev -c stock
```
> 개발서버 DB 를 SSH 터널(localhost:15432)로 쓰는 설정은 터널이 127.0.0.1 에만 열려 클러스터에서 안 닿을 수 있습니다. 실습은 로컬 compose DB 를 권장합니다.

### C-4. 네임스페이스·Secret·앱 적용
```bash
# 1) 네임스페이스 먼저(Secret 이 들어갈 곳)
kubectl create namespace stock-app

# 2) Secret — 실습용 값(파일은 .gitignore 대상인 *.secret.env 로)
cat > deploy/k8s/overlays/dev/dev.secret.env <<'EOF'
database_url=postgresql+asyncpg://stock_user:stock_password@host.k3d.internal:5432/stock_db
sync_database_url=postgresql+psycopg2://stock_user:stock_password@host.k3d.internal:5432/stock_db
clickhouse_password=password
jwt_secret_key=dev-insecure-secret-change-me
kis_app_key=
kis_app_secret=
kakao_rest_api_key=
kakao_client_secret=
kakao_admin_key=
naver_client_secret=
social_state_secret=dev-state-secret
EOF
kubectl -n stock-app create secret generic stock-app-secrets \
  --from-env-file=deploy/k8s/overlays/dev/dev.secret.env

# 3) 렌더링 결과 미리 보기(적용 안 함) — 무엇이 만들어지는지 눈으로 확인하는 습관
kubectl kustomize deploy/k8s/overlays/dev | less

# 4) 적용
kubectl apply -k deploy/k8s/overlays/dev
```
> 다시 apply 할 때 `field is immutable` 오류가 나면 마이그레이션 Job 때문입니다(Job 은 수정 불가) → `kubectl -n stock-app delete job stock-app-migrate --ignore-not-found` 후 다시 apply.
> `apply -k` 하면 마이그레이션 Job(`stock-app-migrate`)도 같이 실행됩니다. 앱(Deployment)은 Job 을 기다리지 않으니, 처음엔 Job 완료를 확인하세요:
> `kubectl -n stock-app wait --for=condition=complete job/stock-app-migrate --timeout=180s`

### C-5. 확인·조작 — kubectl 기본 명령
```bash
kubectl -n stock-app get pods                 # 모든 Pod 상태 (Running, READY 1/1 이면 OK)
kubectl -n stock-app get pods -w              # 실시간으로 지켜보기(Ctrl+C 종료)
kubectl -n stock-app get deploy,svc,ingress,job
kubectl -n stock-app describe pod <pod이름>    # 왜 안 뜨는지 — 맨 아래 Events 를 본다
kubectl -n stock-app logs -f deploy/trading-game          # 로그(여러 Pod 면 그중 하나)
kubectl -n stock-app logs -f -l app=trading-game --prefix # 같은 라벨 Pod 전체 로그
kubectl -n stock-app exec -it deploy/auth -- sh           # 컨테이너 안으로 들어가기

# 내 PC 에서 서비스 접속(가장 쉬운 방법) — 터미널을 열어 둔 동안만 유효
kubectl -n stock-app port-forward svc/auth 8001:8001 &
kubectl -n stock-app port-forward svc/trading-game 8004:8004 &
curl -s localhost:8001/health; curl -s localhost:8004/ready

# (nginx-ingress 설치한 경우) Ingress 경유 — Host 헤더로 도메인 흉내
curl -s -H 'Host: auth.example.com' http://localhost:8080/health

# 스케일 실습 — trading-game 3개로
kubectl -n stock-app scale deploy/trading-game --replicas=3
kubectl -n stock-app logs -l app=trading-game --prefix | grep -i leader   # 리더는 1개만

# Pod 하나 죽여 보기 → Deployment 가 자동으로 새로 띄움
kubectl -n stock-app delete pod -l app=auth
```
| Pod 상태 | 의미·해결 |
|----------|-----------|
| `ImagePullBackOff` / `ErrImagePull` | 이미지를 못 받음. dev: `k3d image import` 를 했는지, 태그가 `dev` 인지. prod: 레지스트리 주소·로그인(imagePullSecrets) |
| `CreateContainerConfigError` | Secret/ConfigMap 없음 → `kubectl -n stock-app get secret stock-app-secrets` |
| `CrashLoopBackOff` | 앱이 시작하다 죽음 → `kubectl logs <pod> --previous` |
| `Running` 인데 READY `0/1` | `/ready` 실패 = DB·Redis 연결 문제(주소 `host.k3d.internal`, 방화벽) |

실습 끝:
```bash
kubectl delete -k deploy/k8s/overlays/dev     # 앱 삭제
k3d cluster delete stock                      # 클러스터 통째로 삭제
```

### C-6. 클라우드 상용 (EKS / GKE / NKS)
#### 1) 클러스터·도구 준비
- 관리형 클러스터 생성: AWS **EKS**(`eksctl`), GCP **GKE**(`gcloud container clusters create`), 네이버 **NKS**(콘솔). 노드 2~3대부터.
- `kubectl` 이 그 클러스터를 보게 설정(각 클라우드 CLI 가 kubeconfig 를 만들어 줌) → `kubectl get nodes`.
- **metrics-server**(HPA 에 필요): GKE·k3s 는 기본 포함, **EKS 는 별도 설치**:
  `kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml`
- **Ingress 컨트롤러**: nginx-ingress 설치(C-2 의 명령, 클라우드면 LoadBalancer 가 자동 생성됨) — 또는 Ingress 대신 Cloudflare Tunnel(아래 4).

#### 2) 이미지 push
```bash
export REGISTRY=<ECR/GAR/NCR 주소>; export TAG=$(git rev-parse --short HEAD)
docker build --platform linux/amd64 -t $REGISTRY/stock-app-backend:$TAG backend   # Apple Silicon 에서 빌드 시 플랫폼 지정
docker push $REGISTRY/stock-app-backend:$TAG
```
`deploy/k8s/overlays/prod/kustomization.yaml` 의 `images:` 에서 `newName`·`newTag` 를 직접 바꾸거나, kustomize CLI(`brew install kustomize`)로:
```bash
(cd deploy/k8s/overlays/prod && kustomize edit set image REGISTRY/stock-app-backend=$REGISTRY/stock-app-backend:$TAG)
```
> 비공개 레지스트리면 노드가 pull 할 권한 필요: EKS 는 노드 IAM 역할, 그 외는 `kubectl create secret docker-registry` + `imagePullSecrets`.

#### 3) 설정·Secret
- `overlays/prod/kustomization.yaml` 의 ConfigMap 값(REDIS_URL, CLICKHOUSE_HOST)과 `base/kustomization.yaml` 의 도메인(CORS·SOCIAL_*), `base/ingress.yaml` 의 `example.com` 을 실제 값으로.
- Secret:
```bash
kubectl create namespace stock-app
cp deploy/k8s/base/secret.example.yaml deploy/k8s/base/secret.yaml   # .gitignore 대상 — 커밋 안 됨
# secret.yaml 을 실값으로 수정 후
kubectl apply -f deploy/k8s/base/secret.yaml
```
> 더 안전하게는 AWS Secrets Manager / GCP Secret Manager + External Secrets Operator 로 연동(나중 과제).

#### 4) 배포 순서
```bash
kubectl kustomize deploy/k8s/overlays/prod > /tmp/prod.yaml && less /tmp/prod.yaml   # 미리 보기
kubectl -n stock-app delete job stock-app-migrate --ignore-not-found                 # Job 은 수정 불가 → 지우고 다시
kubectl apply -k deploy/k8s/overlays/prod
kubectl -n stock-app wait --for=condition=complete job/stock-app-migrate --timeout=300s
kubectl -n stock-app rollout status deploy/trading-game
kubectl -n stock-app get pods -o wide        # 노드별 분산 확인
```
> 스키마가 크게 바뀌는(컬럼 삭제 등) 배포는 "Job 완료 확인 → 앱 롤아웃" 순서가 중요합니다. 필요하면 Job 만 먼저: `kubectl apply -k` 전에 렌더링 결과에서 Job 만 골라 apply 하는 방식을 쓰세요.

**Ingress 대신 Cloudflare Tunnel** (지금 미니PC 방식과 동일, nginx 불필요): `deploy/k8s/base/cloudflared.yaml` 상단 주석대로 토큰 Secret 생성 → `kubectl apply -f deploy/k8s/base/cloudflared.yaml` → Cloudflare 대시보드의 Public Hostname 을 `http://auth.stock-app.svc.cluster.local:8001` 같은 내부 주소로. 이 경우 `base/ingress.yaml` 은 쓰지 않아도 됩니다(kustomization 의 resources 에서 빼기).

#### 5) HPA(오토스케일) 확인
```bash
kubectl -n stock-app get hpa                 # TARGETS 가 "cpu: 12%/70%" 처럼 보이면 정상
                                             # "<unknown>/70%" 면 metrics-server 없음 또는 requests 미설정
kubectl -n stock-app top pods                # Pod 별 CPU/메모리
kubectl -n stock-app describe hpa trading-game
```
CPU 평균이 70% 를 넘으면 2→최대 6개까지 늘고, 내려가면 천천히 줄어듭니다(trading-game 은 10분 안정화 — 줄어드는 Pod 의 WebSocket 은 끊기고 앱이 자동 재접속).

#### 6) 업데이트·롤백
```bash
# 업데이트: 새 TAG 로 images 변경 → (Job 삭제) → apply -k → rollout status
kubectl -n stock-app rollout history deploy/trading-game
kubectl -n stock-app rollout undo deploy/trading-game                  # 직전 버전으로
kubectl -n stock-app rollout undo deploy/trading-game --to-revision=3   # 특정 버전으로
kubectl -n stock-app rollout restart deploy/auth                        # 같은 이미지로 재시작(Secret 변경 반영 등)
```
> Secret 을 바꿨을 땐 Pod 가 자동으로 재시작되지 않습니다 → `rollout restart` 필요. ConfigMap 은 kustomize 가 이름에 해시를 붙여 바뀌면 자동 롤링됩니다.

#### 7) 클라우드로 옮길 때 할 일 요약
- [ ] 레지스트리 만들기, CI(GitHub Actions)에서 `docker build/push` + `kubectl apply -k` 하도록 워크플로 추가(현재는 self-hosted compose 배포)
- [ ] metrics-server(EKS), Ingress 컨트롤러 또는 cloudflared
- [ ] DB/Redis/ClickHouse: 관리형(RDS·ElastiCache 등) 또는 기존 서버 — 클러스터 노드에서 접속 가능하도록 보안그룹/방화벽
- [ ] TLS: Cloudflare 앞단이면 불필요, 직접 노출이면 cert-manager
- [ ] 로그·모니터링: 클라우드 기본(CloudWatch/Cloud Logging) 또는 Prometheus+Grafana
- [ ] 노드 오토스케일(Cluster Autoscaler/Karpenter) — HPA 가 Pod 를 늘려도 노드가 모자라면 Pending

---

## 상용 전환 체크리스트

| # | 항목 | 어디서 |
|---|------|--------|
| 1 | `APP_ENV=production` | stack.yml 고정 / k8s base ConfigMap |
| 2 | **게스트 로그인 끄기** `AUTH_GUEST_ENABLED=false` + 프론트 빌드 `VITE_ENABLE_GUEST_LOGIN=false` | stack.env / ConfigMap, `docker-compose.prod.yml` build args |
| 3 | **`KAKAO_ADMIN_KEY`** 설정(회원 탈퇴 시 카카오 연결 끊기) | secret `kakao_admin_key` |
| 4 | `JWT_SECRET_KEY`·`SOCIAL_STATE_SECRET` 를 길고 무작위인 **새 값**으로(개발 값 재사용 금지) | secret |
| 5 | 도메인: `SOCIAL_REDIRECT_BASE`·`SOCIAL_WEB_RETURN_URL`, 카카오/네이버 콘솔의 Redirect URI 등록 | stack.env / ConfigMap, 공급자 콘솔 |
| 6 | **CORS** `CORS_ORIGINS` 에 상용 프론트 도메인 | stack.env / ConfigMap |
| 7 | 프론트 빌드 `VITE_*_URL` 을 상용 도메인으로 | 프론트 빌드 args |
| 8 | `KIS_MODE=prod` + 실서버 앱키, `MOCK_TICK_STREAM=false` | secret / env |
| 9 | **백업**: PostgreSQL 정기 덤프(`pg_dump`)·스냅샷, ClickHouse 백업([`docs/deployment/clickhouse-backup.md`](../deployment/clickhouse-backup.md)), 복구 리허설 1회 | DB 서버 |
| 10 | **모니터링**: `/ready` 외부 감시(UptimeRobot 등), 로그 수집, 디스크·메모리 알림 | 운영 |
| 11 | `game_ws`·`celery_beat` 레플리카 1 확인 | `docker stack services` / `kubectl get deploy` |
| 12 | Redis 비밀번호를 쓰면 `REDIS_URL` 에 포함(일반 env — 아래 FAQ 참고) | stack.env / ConfigMap |

---

## FAQ

**Q. WebSocket 은 sticky 세션(같은 사용자를 같은 서버로)이 필요하지 않나요?**
A. 필요 없습니다. 메시지가 Redis Pub/Sub 로 **모든** trading_game 인스턴스에 전달되고, 각 인스턴스는 자기에게 붙은 접속자에게만 보냅니다. 사용자가 어느 인스턴스에 붙든 같은 메시지를 받습니다. 인스턴스가 내려가면 클라이언트가 재접속해서 다른 인스턴스에 붙습니다.

**Q. celery beat 가 실수로 두 개 뜨면?**
A. 모든 정기 작업이 두 번 실행됩니다(수집 API 호출 2배 → KIS 호출 제한, 퀴즈 중복 생성 등). 정산·주간마감은 멱등이라 결과는 같지만 낭비입니다. 그래서 Swarm `replicas: 1` + `stop-first` + `max_replicas_per_node: 1`, k8s `replicas: 1` + `strategy: Recreate` 로 막아 두었습니다. **`scale` 명령으로 늘리지 마세요.**

**Q. trading_game 을 여러 개 띄우면 자동청산이 중복되지 않나요?**
A. 틱 리스너(자동청산 포함)는 Redis 리더 락을 가진 **1개 인스턴스에서만** 돕니다. 리더가 갑자기 죽으면 최대 약 TTL×4/3 + 리스너 기동 시간(기본 TTL 10초 → 약 13초) 뒤 다른 인스턴스가 이어받습니다(갱신·재시도 주기가 TTL/3 이라서). 그 사이 틱 처리가 멈출 수 있습니다(`GAME_LEADER_TTL_MS` 로 조절). 정상 종료(SIGTERM)는 락을 바로 반납하므로 1초 이내에 넘어갑니다.

**Q. game_ws 가 죽으면?**
A. Swarm/k8s 가 자동으로 다시 띄웁니다(수 초~수십 초 틱 공백). 1개뿐이라 그 사이 시세가 잠깐 멈출 수 있는데, 이는 KIS 세션 제한 때문에 감수하는 부분입니다.

**Q. DB 도 Swarm/k8s 안에 넣으면 안 되나요?**
A. 가능하지만 권장하지 않습니다. DB 는 데이터가 특정 디스크에 묶여 있어 "아무 노드에서나 다시 띄우기"가 안 됩니다. stack.yml 하단에 단일 노드 고정 예시(주석)만 있습니다. 상용은 관리형 DB 또는 별도 DB 서버를 쓰세요.

**Q. Redis 주소는 왜 Secret 이 아니라 일반 설정에 있나요?**
A. Celery 가 시작할 때 `REDIS_URL` 을 (파일 env 처리보다 먼저) 직접 읽기 때문에 `REDIS_URL_FILE` 이 동작하지 않습니다. Redis 에 비밀번호가 있다면 `REDIS_URL=redis://:<비번>@host:6379/0` 을 일반 env 로 넣으세요. k8s 에서 숨기고 싶다면 Deployment 의 `env` 에 `valueFrom.secretKeyRef` 로 주입하는 방법이 있습니다.

**Q. `/health` 와 `/ready` 차이는?**
A. `/health` = 프로세스가 살아 있다(의존성 안 봄) → 실패하면 **재시작**(k8s liveness). `/ready` = DB·Redis 까지 연결 OK → 실패하면 **트래픽만 잠시 빼고** 재시작은 안 함(k8s readiness). DB 장애 때 모든 Pod 가 재시작 폭주하지 않게 나눈 것입니다. (Swarm 은 healthcheck 가 하나라 `/ready` 를 쓰고, 실패가 이어지면 재시작합니다.)

**Q. 개발 서버(미니PC)는 바꿔야 하나요?**
A. 아니요. `docker-compose.prod.yml` 그대로입니다. 단일 인스턴스에서도 같은 코드 경로(Pub/Sub 왕복, 리더=자기 자신)로 동작합니다.

**Q. 프론트(web_client·admin_web)는?**
A. 이 설정 범위 밖입니다. 정적 파일이라 기존 compose 나 Cloudflare Pages/S3+CDN 으로 두는 게 간단합니다. 빌드 시 `VITE_*_URL` 만 상용 도메인으로 바꾸세요.

**Q. 설정 파일이 문법적으로 맞는지 클러스터 없이 확인하려면?**
```bash
docker stack config -c deploy/swarm/stack.yml > /dev/null && echo swarm OK
kubectl kustomize deploy/k8s/overlays/dev  > /dev/null && echo k8s dev OK
kubectl kustomize deploy/k8s/overlays/prod > /dev/null && echo k8s prod OK
```

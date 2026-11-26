# 단일 서버 무중단 배포 — 단일 노드 Docker Swarm 전환

> 대상: 개발 서버(haezean) 한 대 — **Mac mini(macOS) + OrbStack**(Swarm 노드 이름 `orbstack`), 배포 러너 폴더 `/Users/kyuseok/actions-runner/_work/stock_app/stock_app`. 작성 2026-10-19. 결정 배경: 배포할 때마다 접속이 끊기거나 API 호출이 실패하던 문제.
> 관련 파일: `deploy/swarm/single-node.yml`(스택), `deploy/swarm/deploy.sh`(워크플로가 호출), `deploy/swarm/cutover.sh`(1회 전환), `deploy/swarm/rollback-to-compose.sh`(되돌리기).
> 다중 서버·레지스트리·Swarm secret 을 쓰는 상용 구성은 별도 문서 `docs/deploy/README.md`(`deploy/swarm/stack.yml`).

## 1. 왜 끊겼나
`docker compose up -d` 는 같은 호스트 포트(8001~8004·3000·3001)를 쓰는 컨테이너를 동시에 두 개 띄울 수 없어 **옛 컨테이너를 먼저 끄고 새 것을 켠다**. uvicorn·serve 가 준비될 때까지(수 초~수십 초) Cloudflare 터널이 `localhost:포트` 에 닿지 못해 502/연결 불가. 백엔드는 이미지가 하나라 push 마다 7개가 함께 재시작됐다.

## 2. 무엇이 바뀌나
| | 지금(compose) | 전환 후(Swarm) |
|---|---|---|
| DB(postgres·clickhouse·redis) | compose | **그대로 compose**(볼륨·컨테이너 그대로, 재시작 없음) |
| 앱 9개(API 4·game_ws·celery 2·웹 2) | compose, stop-first | Swarm 스택 `stock`, **start-first**(새 컨테이너 healthy → 옛 것 종료) |
| 포트 | 컨테이너가 직접 publish | Swarm ingress 가 같은 포트를 계속 받음 → **Cloudflare 터널 설정 변경 없음** |
| 배포 | `docker compose up -d` | `deploy/swarm/deploy.sh`(빌드 → 마이그레이션 → 스택 갱신 → 완료 대기, 실패 시 자동 롤백) |
| 비밀값 | `backend/.env.production` | 같은 파일(env_file) |
| celery_beat·game_ws | 재시작 | stop-first(중복 실행 금지) — 몇 초 멈춤. 사용자 요청과 무관, 게임 틱은 자동 재연결 |

워크플로는 **스택 `stock` 이 있으면 Swarm 방식, 없으면 기존 compose 방식**으로 배포한다. 그래서 이 변경을 머지·배포해도 전환 전에는 지금과 똑같다.

클라이언트도 같이 보완했다(웹 `web_client/src/lib/retry.ts`, 앱 `mobile/src/lib/api/retry.ts`): **조회(GET·GraphQL query)만** 연결 실패·502/503/504 에 1·3·6초 간격으로 최대 3번 재시도. 주문·보상·글쓰기(POST·mutation)는 중복 실행 위험이 있어 재시도하지 않는다. 앱은 새 빌드가 나가야 적용.

## 3. 전환 절차(1회, 운영자가 서버에서) — 1~2분 중단
접속이 적은 시간에. **20:30~20:50(일일 수집)은 피한다.**

```bash
# 0) 이 변경이 들어간 main 을 받은 저장소 폴더(배포 러너 폴더 권장)
cd <저장소>
git pull
cp /opt/stock_app/env/.env.production backend/.env.production
cp /opt/stock_app/env/compose.env .env 2>/dev/null || true

# 1) 전환 — yes 입력 후 진행. 빌드·마이그레이션까지는 중단 없음, 앱 교체 순간부터 1~2분 중단
# 개발 서버는 게스트 로그인 버튼을 유지하도록 값을 넘긴다(없으면 웹 이미지에서 버튼이 빠진다)
VITE_ENABLE_GUEST_LOGIN=true bash deploy/swarm/cutover.sh
```
스크립트가 하는 일: Swarm init(127.0.0.1) → overlay 망 `stock_net` 생성 → DB 컨테이너 3개를 같은 이름(`postgres`·`clickhouse`·`redis`)으로 망에 연결(재시작 없음) → 이미지 빌드(태그 = 커밋) → 마이그레이션 → 새 망에서 DB 이름이 풀리는지 확인 → compose 앱 컨테이너 9개 삭제 → 스택 배포 → 6개 포트 응답 확인.

## 4. 전환 후 확인
- [ ] `docker stack services stock` — 9개 서비스 `1/1`
- [ ] `https://app.haezean.com`·`api`·`auth`·`blog`·`game`·`admin` 정상
- [ ] 백엔드 파일 하나 바꿔 push → Actions 로그 `모드: Swarm(start-first)` → 배포 중 브라우저에서 계속 새로고침해도 끊기지 않는지
- [ ] `docker service ps stock_stock_api` — 옛 태스크 `Shutdown`, 새 태스크 `Running`
- [ ] **재부팅 내성(중요, 한가한 시간에)** — 2026-11-25 개발 서버 재부팅에서 **실패**(DB 꺼짐·낡은 연결·터널, 외장 SSD 손상까지 겹침). 복구 순서는 9절, 이후 배포 스크립트가 사전 점검으로 꺼진 컨테이너·낡은 연결을 고친다: OrbStack 재시작(`orb restart docker`, 또는 메뉴 막대 OrbStack → Restart) → DB 3개가 healthy 로 돌아오고 여전히 `stock_net` 에 붙어 있는지(`docker inspect -f '{{json .NetworkSettings.Networks}}' stock_postgres_prod`), 스택 9개 `1/1`. compose 컨테이너가 overlay 에 붙은 상태로 데몬이 재시작될 때 망 준비 전에 떠서 실패한 사례가 Docker 에 있었다. 불안정하면 대안: DB 를 overlay 에 붙이지 않고 스택에 `extra_hosts: ["postgres:host-gateway", …]` 로 호스트 공개 포트(5432·8123·6379)를 쓰게 바꾼다.

## 4-1. 전환 전에 알아 둘 것
- **스크립트는 아직 어디서도 실제로 돌려 보지 않았다**(문법 검사·`docker stack config` 렌더링만). 대신 `cutover.sh` 는 중단 전에 실패하도록 사전 점검을 모아 뒀다: DB healthy, Docker ≥ 23, live-restore 꺼짐, 10.x 대역 겹침 경고, 이미지 빌드·마이그레이션, 새 망에서 DB 이름 확인, **compose 와 Swarm 의 env 해석 비교**(따옴표·`${}`·행 끝 주석 때문에 다르게 읽히는 키가 있으면 키 이름만 출력하고 중단).
- 이 변경을 처음 push 하면(`docker-compose.prod.yml`·`deploy/swarm/**` 변경) **두 워크플로가 기존 compose 방식으로 한 번 배포**한다 — 평소처럼 잠깐 끊김. 20:30~20:50 은 피한다.
- 이미지 이름이 `stock-app-backend` 등으로 바뀌어 예전 이름(`<프로젝트>-auth_api` 류) 이미지가 태그 달린 채 남는다(`docker image prune` 로 안 지워짐). 전환 뒤 한 번 정리: `docker images | grep -E -- '-(auth_api|stock_api|blog_api|trading_game|game_ws|celery_worker|celery_beat|web_client|admin_web) '` 확인 후 `docker rmi`.

## 4-2. 실제 전환 기록(2026-10-19)
- `cutover.sh`: env 해석 20개 키 일치, 중단 약 15초, 9개 `1/1`, 외부 도메인 6개 200.
- 첫 무중단 배포(df3800f, 웹 → 백엔드): 9개 모두 start-first 로 교체·롤백 없음. 배포 10분 동안 외부에서 1,899회 호출 중 실패 1회(교체와 무관한 시각의 시간 초과).
- 버그: 완료 판정이 `UpdateStatus.StartedAt` 시각을 문자열로 비교했는데 Docker 출력 형식(`2026-10-19 03:05:48 +0000 UTC`)이 달라 늘 '시작 전'으로 보여 5분 뒤 실패 표시 → 시각 비교를 없애고 '설정 이미지가 새 태그인지 + 실행 중 태스크가 모두 새 태그·Running 인지'로 판정하도록 수정.

## 5. 바뀐 운영 명령
컨테이너 이름이 `stock_celery_worker.1.<id>` 처럼 바뀐다. 이름으로 찾아서 실행:
```bash
docker exec $(docker ps -qf name=stock_celery_worker -f status=running | head -1) \
  celery -A apps.collector.celery_app call collector.backfill_market_groups
docker service logs -f stock_celery_worker      # 로그
docker service ps stock_trading_game            # 태스크 상태(롤백 여부 포함)
docker service rollback stock_stock_api         # 직전 버전으로 수동 롤백
```

## 6. 되돌리기(compose 로)
```bash
bash deploy/swarm/rollback-to-compose.sh   # 스택 삭제 → compose 로 앱 9개 기동(1~2분 중단)
```
스택이 없어지면 워크플로는 자동으로 compose 방식으로 배포한다. Swarm 모드 자체는 남겨 둬도 무해(`docker swarm leave --force` 로 끌 수 있음).

## 7. 주의
- **DB 컨테이너를 compose 로 다시 만들면** `stock_net` 연결이 빠진다 → 다음 배포 때 `deploy.sh` 가 자동으로 다시 연결하지만, 그 사이 앱이 DB 를 못 찾는다. DB 를 재생성했으면 바로 `docker network connect --alias postgres stock_net stock_postgres_prod`(clickhouse·redis 도) 또는 아무 배포나 한 번 실행.
- 이미지 태그는 커밋 SHA. 최근 3개만 남기고 정리(롤백용).
- 백엔드·웹 배포가 동시에 와도 `deploy.sh` 가 서버 잠금(`/tmp/stock_stack_deploy.lock`)으로 순서대로 처리.
- Docker 23 이상 필요(스택 `ulimits`). `docker version` 으로 확인.
- macOS 라 스크립트는 bash 3.2·BSD 도구 기준으로 작성(잠금은 `flock` 대신 `mkdir`). OrbStack 이 로그인 시 자동 시작되도록(설정 → Start at login) 둬야 재부팅 뒤 스택·DB 가 다시 뜬다.

## 8. 상용 서버 전환(Oracle Cloud Ubuntu, funnotedaily) — 2026-11-24 준비
상용 워크플로(`deploy-prod.yml`)도 스택 `stock` 이 있으면 Swarm 으로, 없으면 compose 로 배포한다 → **코드 변경 없이 서버에서 한 번 전환**하면 된다. 개발 서버와 다른 점만 적는다.

| 항목 | 개발(haezean) | 상용(funnotedaily) |
|---|---|---|
| OS·Docker | macOS + OrbStack | Ubuntu + Docker Engine(systemd — 재부팅 뒤 자동 기동) |
| 사설망 | 겹침 없음 | Oracle VCN 이 보통 `10.0.0.0/16` → Swarm 기본 풀(10.0.0.0/8)과 겹칠 수 있음 → **`ADDR_POOL=172.30.0.0/16`** |
| 게스트 로그인 | `VITE_ENABLE_GUEST_LOGIN=true` 를 넘김 | **넘기지 않는다**(상용은 게스트 버튼 없음) |
| 피할 시간 | 20:30~20:50 | 19:55~21:00(20:00 교육 게임 정산 + 20:30 수집) |

```bash
# 0) compose 가 쓰는 저장소 폴더로(배포 러너 폴더) — 위치를 모르면 라벨에서 찾는다
cd "$(docker inspect $(docker ps -qf name=stock_api | head -1) --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
git log -1 --oneline   # 러너 작업 폴더는 배포한 커밋이 detached 로 체크아웃돼 있다 — git pull·checkout 하지 말 것(다음 배포 때 러너가 맞춘다)
cp /opt/stock_app/env/.env.production backend/.env.production
cp /opt/stock_app/env/compose.env .env

# 1) 사전 점검(값은 출력하지 않고 이름·버전만)
docker version --format '{{.Server.Version}}'          # 23 이상
docker info --format '{{.LiveRestoreEnabled}}'         # false 여야 함
ip route | grep -E '^10\.' || echo "10.x 경로 없음"
grep -oE '^ADMIN_[A-Z_]+_URL' .env                     # 관리자 웹 주소 4개 — 없으면 관리자 웹이 개발 주소로 빌드됨(중단)

# 2) 전환 — yes 입력 후 진행(앱 교체 순간 수십 초 중단)
ADDR_POOL=172.30.0.0/16 bash deploy/swarm/cutover.sh
```

전환 후 확인
- [ ] `docker stack services stock` — 9개 `1/1`
- [ ] `https://app.funnotedaily.com`·`api`·`auth`·`blog`·`game`·`admin` 정상, 앱 로그인·게임 탭
- [x] 다음 상용 배포(`release/v*`) Actions 로그에 `모드: Swarm(start-first)` → 배포 중 새로고침해도 502 없음 — release/v1.0.15 로 확인(8-1)
- [ ] `sudo reboot` 뒤(한가한 시간) DB 3개 healthy·`stock_net` 연결·스택 9개 `1/1`
- [ ] **포트 노출(전환과 무관한 기존 상태)**: compose 도 앱·DB 포트(8001~8004·3000·3001·5432·8123·6379)를 0.0.0.0 에 연다. Oracle 보안 목록(VCN Security List/NSG)에서 인바운드는 22(SSH)만 열려 있는지 확인 — Cloudflare 터널은 바깥으로 나가는 연결이라 인바운드가 필요 없다
- 되돌리기: `bash deploy/swarm/rollback-to-compose.sh`(6절)

### 8-1. 실제 전환 기록(2026-11-24)
- 사전 점검: Docker 29.9.3, live-restore false, 사설망 `10.0.0.0/24`(서버 10.0.0.x) → `ADDR_POOL=172.30.0.0/16` 로 실행, 관리자 웹 주소 4개 확인.
- `cutover.sh`(커밋 6dc90e4 = release/v1.0.14): env 해석 40개 키 일치, DB 이름 확인 OK, **중단 약 30초**, 9개 서비스 `1/1`.
- 외부 확인: app·admin 200, api·auth·blog·game 루트 404(서버 응답 = 정상), auth `/health` 200, 교육 게임 features·GraphQL 정상, 시세 차단 유지.
- 첫 무중단 상용 배포(release/v1.0.15, 같은 날 14:25~14:27): `모드: Swarm(start-first)`, 마이그레이션(`users.is_super_admin` 칸 추가) → 백엔드 → 웹 순서. 배포 중 10초마다 16회 외부 점검(auth `/health`·app) 모두 200 — 끊김·502 없음.
- 남은 확인: 한가한 시간 재부팅 내성, Oracle 보안 목록 인바운드 22 만.

## 9. 재부팅 뒤 복구(서버를 다시 켠 다음)

2026-11-25 개발 서버 장애에서 실제로 밟은 순서다(기록: [`incident-2026-11-25-dev-ssd.md`](incident-2026-11-25-dev-ssd.md)). 배포 스크립트의 사전 점검(`deploy/swarm/preflight.sh`)이 2~4번을 자동으로 고치지만, 1번(디스크)은 사람이 해야 한다.

> ⚠️ 명령을 넣기 전에 **어느 서버 창인지** 확인한다. 두 서버는 컨테이너·망·러너 폴더 이름이 같아 다른 창에서도 오류 없이 실행된다. 개발 = Mac mini(`➜`), 상용 = `ubuntu@instance-…`. `git --no-pager log -1 --oneline` 으로 커밋도 대조한다.

0. **바깥에서 상태 보기** — `curl -s https://auth.<도메인>/` 가 `error code: 1033`(530) 이면 터널(cloudflared)이 안 떴다, 502 면 앱이 DB 를 못 찾는다.
1. **(개발 Mac mini) 로그인·외장 디스크** — 재부팅 뒤 로그인해야 OrbStack·러너가 뜨고 외장 SSD 가 마운트된다. `ls /Volumes` 에 `StockData` 가 있어야 한다.
   - 없으면 `diskutil list external` → `diskutil mount <볼륨 id>`. 마운트가 안 되면 `diskutil verifyVolume <볼륨 id>`(읽기만) 결과를 보고 판단한다.
   - **`/Volumes/StockData` 폴더를 손으로 만들거나 권한을 바꾸지 않는다** — 내장 디스크에 빈 폴더가 생겨 DB 가 빈 채로 뜬다.
2. **DB 3개 켜기** — `docker ps -a --filter name=_prod` 에서 `Exited` 면 `docker start stock_postgres_prod stock_clickhouse_prod stock_redis_prod`. `mkdir … permission denied` 가 나오면 1번(디스크 미마운트)이다.
3. **(개발) 상용 CH 읽기 전용 터널** — `docker compose --env-file /opt/stock_app/env/ch-ro-tunnel.env -f deploy/dev/ch-ro-tunnel.yml up -d` (없으면 시세 화면·CH 작업이 `stock_ch_ro_tunnel` 이름 해석 실패).
4. **망 다시 붙이기와 이름 확인** — 재부팅 뒤 `docker inspect` 는 '붙어 있음'인데 이름이 안 풀리는 낡은 연결이 남을 수 있다.
   ```bash
   for p in postgres:stock_postgres_prod clickhouse:stock_clickhouse_prod redis:stock_redis_prod; do
     a=${p%%:*}; c=${p#*:}; docker network disconnect -f stock_net "$c" 2>/dev/null; docker network connect --alias "$a" stock_net "$c"
   done
   docker run --rm --network stock_net alpine nslookup postgres
   ```
5. **배포 다시 실행** — 실패한 Actions 실행은 GitHub 화면에서 Re-run, 또는 러너 폴더에서 `bash deploy/swarm/deploy.sh backend <커밋 앞 12자리>`(러너 폴더에서 `git pull` 금지).
6. **DB 를 새로 만들었다면(디스크 초기화 등) 1회만** — 배포가 `alembic upgrade head` 로 PG 표를 만든 뒤:
   - ClickHouse 표: 상용은 `docker run --rm --network stock_net --env-file backend/.env.production <이미지> python -m shared.clickhouse_schema`.
     **개발은 기본 연결이 상용 읽기 전용이라** 자체 CH 로 방향을 바꿔 실행한다:
     `… <이미지> sh -c 'CLICKHOUSE_HOST=$CLICKHOUSE_LOCAL_HOST CLICKHOUSE_PORT=$CLICKHOUSE_LOCAL_PORT CLICKHOUSE_USER=$CLICKHOUSE_LOCAL_USER CLICKHOUSE_PASSWORD=$CLICKHOUSE_LOCAL_PASSWORD python -m shared.clickhouse_schema'`
   - 슈퍼 관리자: `… <이미지> python -m apps.auth.seed_admin` → 로그인 후 바로 비밀번호 변경. 게시판·앱 버전·광고·푸시 템플릿·관리자 계정은 관리자 웹에서 다시 만든다. 개발 서버 시세는 상용에서 읽으므로 '초기 데이터 준비'는 하지 않는다.

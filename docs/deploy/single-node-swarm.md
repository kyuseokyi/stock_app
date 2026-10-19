# 단일 서버 무중단 배포 — 단일 노드 Docker Swarm 전환

> 대상: 개발 서버(haezean) 한 대. 작성 2026-10-19. 결정 배경: 배포할 때마다 접속이 끊기거나 API 호출이 실패하던 문제.
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
bash deploy/swarm/cutover.sh
```
스크립트가 하는 일: Swarm init(127.0.0.1) → overlay 망 `stock_net` 생성 → DB 컨테이너 3개를 같은 이름(`postgres`·`clickhouse`·`redis`)으로 망에 연결(재시작 없음) → 이미지 빌드(태그 = 커밋) → 마이그레이션 → 새 망에서 DB 이름이 풀리는지 확인 → compose 앱 컨테이너 9개 삭제 → 스택 배포 → 6개 포트 응답 확인.

## 4. 전환 후 확인
- [ ] `docker stack services stock` — 9개 서비스 `1/1`
- [ ] `https://app.haezean.com`·`api`·`auth`·`blog`·`game`·`admin` 정상
- [ ] 백엔드 파일 하나 바꿔 push → Actions 로그 `모드: Swarm(start-first)` → 배포 중 브라우저에서 계속 새로고침해도 끊기지 않는지
- [ ] `docker service ps stock_stock_api` — 옛 태스크 `Shutdown`, 새 태스크 `Running`

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

# 수평 확장 준비(코드 무상태화 + Docker Swarm·Kubernetes 배포 설정) 설계 스펙

> 작성일: 2026-10-14 · 상태: 승인됨(사용자: "추후 진짜 상용서버에 운영하게되면 docker swarm 또는 쿠버네티스를 사용할 수 있도록 미리 준비해줘" → "둘다 설정하는게 좋을것 같아" → "좋아 그대로 진행해줘")
> 선행: `2026-10-14-realtime-conflation-public-ws-design.md`(범위 밖이던 ③을 이번에 구현). 개발 서버는 계속 docker-compose 단일 인스턴스 — 이번 변경 후에도 그대로 동작해야 함.
> 사용자는 Kubernetes 경험이 없음 → 한국어 초보자 가이드 필수.

## 1. 코드 — 인스턴스 N개에서 안전하게
### 1.1 WS 전달을 Redis Pub/Sub 로 (trading_game)
- 채널: `game:ws:broadcast`(전체: tick·sentiment·코치 등 — 대상 구분 필드 포함: `audience: all|users`), `game:ws:user:{user_id}`(개인: position_pnl·nudge 등).
- 발행 측: 기존 `manager.broadcast(...)`/`broadcast_users(...)`/`send_to_user(...)` 호출부를 **발행 함수**로 교체(`ws_bus.publish_all/publish_users/publish_user`).
- 구독 측: 각 인스턴스가 lifespan 에서 구독 태스크 1개 — `game:ws:broadcast` 와 패턴 `game:ws:user:*` 를 구독해 **자기 프로세스의 ConnectionManager** 로 전달(로컬 접속자 없으면 무시).
- 메시지 형식(클라이언트가 받는 JSON) 불변. 공개/로그인 연결 규칙(공개는 tick·sentiment 만) 유지.
- 단일 인스턴스에서도 같은 경로(Pub/Sub 왕복) — 지연 수 ms 수준 허용.

### 1.2 싱글톤 작업 = 리더 선출 `services/leader.py`
- Redis 락 `game:leader:{name}` = `SET key <instance_id> NX PX <ttl>`, 리더는 ttl/3 주기로 갱신(값이 자기 것일 때만 — Lua compare-and-pexpire), 종료 시 compare-and-del.
- 기본 ttl 10초(`GAME_LEADER_TTL_MS`). instance_id = hostname+pid+uuid4.
- 리더만 실행: 틱 리스너(+자동청산), 0.25초 broadcast 루프, 1초 PnL 루프, 시장심리 루프. 리더를 잃으면 즉시 해당 태스크 취소, 다시 얻으면 재시작(포지션 캐시는 리더에서 dirty 처리 후 재적재).
- `mark_dirty` 는 주문을 받은 인스턴스(비리더일 수 있음)에서 발생 → **Redis 로 알림**: `game:cache:dirty` 채널 발행, 리더가 구독해 dirty 처리(+기존 5초 TTL 재적재는 안전망으로 유지).
- 넛지(오더 응답 외 비동기 넛지): 기존 큐 경로를 `publish_user` 로.

### 1.3 헬스·종료
- 모든 FastAPI 서비스(auth/blog/stock_api/trading_game): `/health`(프로세스 생존, 의존성 미검사)와 `/ready`(DB `SELECT 1` + Redis `PING`, 실패 503). 기존 `/health` 응답 형식 유지.
- trading_game SIGTERM(lifespan 종료): 구독 해제, 리더 락 반납, 로컬 WS close(1001).
- 로그는 stdout 유지(이미 그러함).

### 1.4 단일 실행 전용(복제 금지, 배포 설정에서 replicas=1 고정)
- `game_ws`(KIS 실시간 세션 앱키당 제한), `celery beat`. celery worker 는 복제 가능(정산·주간마감 태스크는 이미 멱등).

## 2. 배포 설정
### 2.1 Docker Swarm — `deploy/swarm/stack.yml`
- 기존 `docker-compose.prod.yml` 의 이미지·환경을 기반으로 서비스 정의, `deploy.replicas`(auth 2, blog 2, stock_api 2, trading_game 2, celery_worker 2, celery_beat 1, game_ws 1), `update_config`(rolling, order start-first), `healthcheck`(/ready), `restart_policy`.
- 비밀값: Swarm `secrets`(예: `db_password`, `jwt_secret`, `kis_app_secret`) + 앱이 `*_FILE` env 를 읽도록 `shared/env.py` 에 `_FILE` 지원 추가(값 없으면 기존 env).
- DB·Redis·ClickHouse 는 클러스터 외부(기존 미니PC·관리형) 주소를 env 로 — stack 에 DB 미포함(옵션 주석으로 단일 노드 배치 예시만).
- 진입: 기존 Cloudflare Tunnel → Swarm 라우팅 메시(published port). WebSocket 은 Pub/Sub 덕분에 sticky 세션 불필요.
- 마이그레이션: `docker stack deploy` 전 1회 `docker run --rm <image> alembic upgrade head`(문서) — stack 에 넣지 않음(복제 실행 방지).

### 2.2 Kubernetes — `deploy/k8s/` (Kustomize)
- `base/`: 서비스별 Deployment+Service(auth, blog, stock-api, trading-game, celery-worker, celery-beat, game-ws), ConfigMap(비밀 아닌 env), Secret 예시(`secret.example.yaml` — 실값 커밋 금지, `.gitignore`), Ingress(nginx-ingress 기준, WS 타임아웃 annotation, 호스트별 라우팅), readiness/liveness probe(`/ready`·`/health`), resources requests/limits, migration Job(`alembic upgrade head`).
- celery-beat·game-ws: `replicas: 1` + `strategy: Recreate`(동시 2개 금지).
- `overlays/dev/`(k3d/minikube 로컬 실습: replicas 1, 로컬 이미지), `overlays/prod/`(replicas 2+, HPA: trading-game·stock-api CPU 70% 기준 min2/max6).
- 이미지 레지스트리 주소·도메인은 placeholder(`REGISTRY`, `example.com`)로 두고 문서에서 바꾸는 법 안내.
- 참고: 사용자 규칙상 Nginx/Traefik 은 기존 서버에서 금지였음 — k8s Ingress 컨트롤러는 클러스터 표준 구성요소로 별개이나, 문서에 "Cloudflare Tunnel 을 Ingress 대신 쓰는 방법(cloudflared Deployment)"도 함께 안내해 선택 가능하게.

## 3. 문서 — `docs/deploy/README.md`(한국어, 초보자용)
- 개념: 컨테이너/이미지/레플리카/서비스/로드밸런싱, 왜 코드가 무상태여야 하는지(이번 변경 요약), 싱글톤 서비스 목록.
- 단계별: (A) 지금 compose → (B) Swarm(노드 추가·secret 생성·stack deploy·스케일·롤백 명령) → (C) k8s(k3d 로컬 실습 → 클라우드: 이미지 push, secret 생성, kustomize apply, HPA 확인, 롤백).
- 상용 전환 체크리스트(env, 게스트 off, KAKAO_ADMIN_KEY, 도메인/CORS, 백업).
- README 루트에 링크 한 줄, ROADMAP 상시 백로그 ③ 항목 완료 표시.

## 4. 검증
- pytest: Pub/Sub 경유 전달(인스턴스 2개 시뮬레이션 — 매니저 2개가 각자 로컬 접속자에게만 전달), 공개/개인 규칙 유지, 리더 선출(획득·갱신·상실 시 태스크 중지·다른 인스턴스 승계, 남의 락 삭제 금지), dirty 알림, `/ready` 503, `_FILE` env.
- 기존 전체 테스트 회귀.
- 로컬 다중 인스턴스 스모크: 일회용 DB+Redis DB5, trading_game 2개(포트 8003/8013) + Mock 틱 → 두 인스턴스 각각의 공개 WS 가 틱 수신, 리더 1개만 리스너 실행(로그), 리더 프로세스 종료 시 다른 쪽 승계(≤ ttl). 끝나면 정리.
- 배포 파일: `docker stack config -c deploy/swarm/stack.yml`(또는 compose config) 문법 검사, `kubectl kustomize deploy/k8s/overlays/prod` 렌더링 검사(도구 없으면 설치 없이 가능한 범위에서 YAML 파싱 검사).

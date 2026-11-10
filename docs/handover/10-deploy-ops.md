# 10. 배포·운영 — 코드가 서버에 올라가는 길, 문제가 났을 때

> 목표: 내가 고친 코드가 어떤 경로로 개발 서버에 반영되는지 알고, "사이트가 안 돼요" 연락을 받았을 때 순서대로 점검할 수 있다.

## 10-1. 서버 구성 한눈에

```
인터넷 ─▶ Cloudflare (HTTPS, 도메인) ─▶ Cloudflare Tunnel ─▶ 미니PC(개발 서버)
                                                          ├─ Docker 컨테이너들 (docker-compose.prod.yml 또는 Swarm 스택 stock)
                                                          ├─ GitHub Actions self-hosted 러너 (자동 배포 실행기)
                                                          └─ /opt/stock_app/env/.env.production (운영 비밀값 — Git 에 없음)
```

| 도메인 | 미니PC 포트 | 컨테이너 |
|---|---|---|
| `app.haezean.com` | 3000 | web_client |
| `admin.haezean.com` | 3001 | admin_web |
| `auth.haezean.com` | 8001 | auth_api |
| `api.haezean.com` | 8002 | stock_api |
| `blog.haezean.com` | 8003 | blog_api |
| `game.haezean.com` | 8004 | trading_game (REST + WebSocket) |
| (외부 노출 없음) | — | game_ws, celery_worker, celery_beat, postgres, clickhouse, redis |

- 공유기 포트포워딩 없이 Cloudflare Tunnel 이 바깥 요청을 미니PC 로 넘긴다. HTTPS 인증서도 Cloudflare 가 처리한다.
- **DB 포트(5432·8123·9000·6379)는 절대 터널에 노출하지 않는다.** 개발 PC 에서 DB 를 볼 땐 SSH 터널(`scripts/dev-db-tunnel.sh`)을 쓴다.
- 현재 배포된 서버는 **개발 서버**다. 상용 서버는 아직 없고, 만드는 절차는 [`docs/deploy/prod-release.md`](../deploy/prod-release.md).

## 10-2. Git 브랜치 흐름

```
feature/기능 ──(머지 커밋)──▶ dev ──(fast-forward)──▶ main ──(자동)──▶ 개발 서버 배포
                                                        └─ release/vX.Y.Z 태그 ──(승인)──▶ 상용 서버 (준비 중)
```
- 평소 작업은 `dev` 에서 갈라진 `feature/…`, `fix/…`, `docs/…` 브랜치에서.
- **`main` 에 push = 배포.** main 에 직접 커밋하지 않는다.
- 자세한 명령: [`docs/git_workflow.md`](../git_workflow.md)

## 10-3. 자동 배포 (GitHub Actions)

| 워크플로 | 언제 | 무엇을 |
|---|---|---|
| `deploy-server.yml` | main 에 `backend/**`, `docker-compose.prod.yml`, `deploy/swarm/**` 변경이 push 됨 | 백엔드 이미지 빌드 → **`alembic upgrade head`** → API·게임·Celery 재기동 |
| `deploy-web.yml` | main 에 `web_client/**`, `admin_web/**` 변경 | 두 웹 빌드·재기동 |
| `deploy-prod.yml` | `release/vX.Y.Z` 태그 (현재 꺼짐: `PROD_DEPLOY_ENABLED`) | 상용 서버 전체 |

- 바뀐 폴더에 해당하는 워크플로만 돈다. 문서(`docs/`)만 바꾸면 배포가 일어나지 않는다.
- 수동 실행: GitHub → Actions → `Deploy Server` / `Deploy Web` → Run workflow (Branch `main`). 또는 `gh workflow run deploy-server.yml --ref main`.
- **매일 20:30 은 데이터 수집 시간**이다. 백엔드 배포가 Celery 를 재시작하므로 이 시간대(20:30~21:30)는 피한다.
- 무중단 배포: Swarm 스택 `stock` 이 있으면 `deploy/swarm/deploy.sh` 로 순차 교체, 없으면 compose. 절차 [`docs/deploy/single-node-swarm.md`](../deploy/single-node-swarm.md).
- 앱(모바일)은 이 파이프라인과 별개다 — 빌드/OTA 는 [9장](./09-mobile.md).

## 10-4. 운영 환경변수(비밀값) 바꾸기

- 위치: 미니PC 의 **`/opt/stock_app/env/.env.production`** (배포할 때 `backend/.env.production` 으로 복사된다. 체크아웃 폴더 안의 파일을 고치면 다음 배포 때 덮어써진다).
- 바꾼 뒤 해당 서비스를 재배포(수동 Run workflow)해야 반영된다.
- 이 파일은 Git 에 없으므로 **바꾼 내용은 따로 안전한 곳에 기록**한다.

## 10-5. 장애 점검 순서 — "사이트가 안 돼요"

1. **어디가 안 되나** — 웹 전체? 특정 화면? 앱만? 로그인만?
2. **서비스가 살아 있나** — 브라우저로 열어 본다.
   ```
   https://auth.haezean.com/ready   https://blog.haezean.com/ready
   https://api.haezean.com/ready    https://game.haezean.com/ready
   ```
   `{"status":"ok"...}` 면 정상, 503 이면 DB/Redis 연결 문제, 아예 안 열리면 컨테이너 또는 터널 문제.
3. **미니PC 접속** — SSH (Termius 사용법: [`docs/cloudflare_termius_guide.md`](../cloudflare_termius_guide.md)).
4. **컨테이너 상태**
   ```bash
   docker ps --format 'table {{.Names}}\t{{.Status}}'      # Restarting / Exited 가 있으면 범인
   docker service ls 2>/dev/null                           # Swarm 모드일 때
   ```
5. **로그**
   ```bash
   docker logs --since 30m --tail 200 <컨테이너 이름>
   ```
6. **최근 배포 확인** — GitHub Actions 탭에서 실패한 워크플로가 있는지. 직전 배포가 원인이면 이전 커밋으로 되돌려 다시 배포(`git revert` 후 main 반영).
7. **디스크** — `df -h`. 가득 차면 `docker image prune` 등으로 정리.
8. **Cloudflare Tunnel** — 모든 도메인이 동시에 안 되면 터널(cloudflared) 상태 확인.

| 증상 | 먼저 볼 곳 |
|---|---|
| 전부 안 열림 | Cloudflare Tunnel, 미니PC 전원/네트워크 |
| 한 도메인만 502 | 그 컨테이너 상태·로그 |
| `/ready` 503 | postgres·redis 컨테이너 |
| 로그인은 되는데 다른 API 가 전부 401 | `JWT_SECRET_KEY` 가 서비스마다 다른지 |
| 오늘 주가 데이터가 없음 | [7장 장애 대응](./07-batch-celery.md#7-7-장애-대응--오늘-데이터가-안-들어왔어요) |
| 앱 푸시가 안 감 | `PUSH_BACKEND=expo` 인지, celery_worker 로그 |
| 배포 후 웹이 localhost 를 부름 | 빌드 args(`VITE_*`) 누락 — 빌드가 실패해야 정상이므로 워크플로 확인 |

트러블슈팅 추가 기록: [`docs/deployment_guide.md`](../deployment_guide.md) 5절.

## 10-6. 처음 서버를 만들 때 / 백업

- 미니PC 최초 세팅(러너·시크릿·터널·스키마 부트스트랩): [`docs/server_setup.md`](../server_setup.md), 인텔 맥미니: [`docs/intel_macmini_server_setup.md`](../intel_macmini_server_setup.md)
- ClickHouse 백업/복원: [`docs/deployment/clickhouse-backup.md`](../deployment/clickhouse-backup.md)
- 수평 확장(Swarm·K8s) 초보자 가이드: [`docs/deploy/README.md`](../deploy/README.md)

## 10-7. 정기 점검 체크리스트 (주 1회 권장)

- [ ] 관리자 웹 › 데이터 현황: 최근 파이프라인 단계가 모두 성공인가
- [ ] `docker ps`: 재시작 반복 중인 컨테이너가 없나
- [ ] `df -h`: 디스크 여유 20% 이상
- [ ] GitHub Actions: 실패한 배포가 방치돼 있지 않나
- [ ] KIS·Gemini·FRED 등 외부 키 만료일
- [ ] [`docs/pending_checks.md`](../pending_checks.md) 의 미해결 항목

## 직접 해보기

1. 4개 `/ready` 주소를 열어 지금 상태를 본다.
2. GitHub Actions 탭에서 최근 `Deploy Server` 실행을 하나 열어 단계(Checkout → env 로드 → 빌드 → 마이그레이션 → 기동)를 읽어 본다.
3. `.github/workflows/deploy-server.yml` 의 `paths:` 를 보고, "문서만 바꾸면 왜 배포가 안 되는지" 설명해 본다.

이전: [9. 모바일 앱](./09-mobile.md) · 다음: [11. 용어집·FAQ](./11-glossary-faq.md)

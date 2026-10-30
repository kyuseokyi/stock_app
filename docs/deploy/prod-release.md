# 상용 배포 — release 태그로 개발 서버와 분리

> 현재(2026-10-30) 배포된 서버는 **개발 서버**다. 상용 서버는 아직 없고, 이 문서는 상용 서버를 만들 때 따를 절차다.
> 워크플로 `.github/workflows/deploy-prod.yml` 은 미리 들어가 있지만 저장소 변수 `PROD_DEPLOY_ENABLED` 가 `true` 가 아니면
> job 이 건너뛰어져 아무 일도 하지 않는다.

## 한눈에

| 트리거 | 대상 | 워크플로 | 범위 |
|---|---|---|---|
| main push | 개발 서버 | `deploy-server.yml`, `deploy-web.yml` | 바뀐 경로만(백엔드 / 웹) |
| `release/vX.Y.Z` 태그 push | 상용 서버 | `deploy-prod.yml` | 백엔드 + 웹 전체 |
| Actions 화면 수동 실행(태그 입력) | 상용 서버 | `deploy-prod.yml` | 그 태그 버전으로 재배포·롤백 |

- `deploy/YYYY-MM-DD-N` 태그는 지금처럼 **개발 배포 기록**용이다. 접두사가 달라 상용 배포를 일으키지 않는다.
- 상용 배포는 태그 커밋이 **main 에 포함**돼야 하고(아니면 중단), GitHub Environment `production` 의 **승인**을 거쳐야 시작한다.

## 상용 서버를 만들 때 — 순서대로

### 1. 개발 러너에 `dev` 라벨을 먼저 붙인다 (⚠️ 가장 먼저)
GitHub 는 `runs-on` 라벨을 모두 가진 러너 아무에게나 job 을 준다. 지금 개발 워크플로는 `runs-on: self-hosted` 뿐이라,
상용 러너(`self-hosted, prod`)를 추가하는 순간 **개발 배포가 상용 서버에서 돌 수 있다.**
1. GitHub → Settings → Actions → Runners → 개발 서버 러너 → Labels 에 `dev` 추가
2. `deploy-server.yml`, `deploy-web.yml` 의 `runs-on: self-hosted` → `runs-on: [ self-hosted, dev ]` 로 바꿔 main 에 반영
3. 개발 배포가 한 번 정상으로 도는 것을 확인한 뒤 다음 단계로

### 2. 상용 서버 준비
- Docker 설치, 저장소 체크아웃이 가능한 러너 환경(개발 서버와 같은 구성 — `docs/server_setup.md`)
- `/opt/stock_app/env/.env.production`, `/opt/stock_app/env/compose.env` 에 **상용 값**(상용 DB·도메인·KIS 키). 저장소에는 넣지 않는다.
- (선택) 무중단 배포를 쓰려면 `deploy/swarm/cutover.sh` 로 Swarm 전환 — 워크플로가 스택 `stock` 이 있으면 Swarm, 없으면 compose 로 배포한다.

### 3. 상용 서버에 러너 설치 — 라벨 `prod`
- Settings → Actions → Runners → New self-hosted runner, 설치할 때 `--labels prod`
- 개발 러너와 **다른 서버**에 설치한다(같은 서버면 분리의 의미가 없다).

### 4. GitHub Environment `production`
Settings → Environments → New environment `production`
- **Required reviewers**: 본인(태그를 실수로 올려도 승인 전엔 배포 안 됨)
- **Deployment branches and tags** → Selected → 태그 규칙 `release/v*` + 브랜치 `main` 허용
  (수동 롤백은 Actions 화면에서 기본 ref 가 `main` 이라 main 도 허용해야 한다 — 태그 형식·main 포함 검사는 워크플로가 따로 한다)
- 상용 전용 시크릿·변수가 생기면 저장소가 아니라 이 환경에 넣는다.

### 5. 켜기
Settings → Secrets and variables → Actions → **Variables** → `PROD_DEPLOY_ENABLED` = `true`

### 6. 모바일(상용 앱)
- `mobile/.env.production` 의 `EXPO_PUBLIC_*_URL` 을 상용 도메인으로
- 첫 운영 빌드 `npm run build:android:prod` 때 EAS 가 Android 서명 키를 새로 만든다 → Expo 대시보드 Credentials 에서 **백업**
- 운영 OTA 는 `npm run ota:prod`(예약: `OTA_STAGE=1` → `npm run ota:prod:activate`). 앱은 지금처럼 사람이 시점을 정한다(태그와 묶지 않음).

## 릴리스 하는 법

```bash
# main 에 원하는 커밋이 있는 상태에서(개발 서버에서 확인 끝난 커밋)
git tag -a release/v1.0.0 main -m "상용 v1.0.0: 변경 요약"
git push origin release/v1.0.0
gh run watch          # Actions → Deploy Prod → production 승인 대기 → 승인하면 배포
```

- 버전은 `vMAJOR.MINOR.PATCH`. 같은 태그를 다시 쓰지 않는다(옮기지 말고 새 번호).
- ⚠️ release 태그는 **배포할 때 만들고 바로 push** 한다. 개발 배포 명령(`git push origin main dev --follow-tags`)은 main 에 붙은 annotated 태그를
  함께 올리므로, 미리 만들어 둔 release 태그가 다음 개발 배포 때 같이 올라가 상용 배포가 시작된다(승인 단계에서 멈추긴 한다).
- 배포 순서: 웹 단위 테스트 → 백엔드(마이그레이션 포함) → 웹. 어느 단계든 실패하면 그 뒤는 실행하지 않는다.

## 롤백

Actions → **Deploy Prod** → Run workflow → `tag` 에 이전 태그(예: `release/v1.0.0`) → 승인.

⚠️ **DB 마이그레이션은 되돌리지 않는다.** 이전 버전 코드가 새 스키마에서도 돌아가도록, 마이그레이션은 "추가는 먼저, 삭제는 다음 릴리스에"
원칙으로 쓴다(컬럼 삭제·이름 변경은 두 릴리스에 나눠서).

## 안전장치 요약 (`deploy-prod.yml`)

1. `vars.PROD_DEPLOY_ENABLED == 'true'` 일 때만 job 실행
2. `runs-on: [ self-hosted, prod ]` — 상용 러너만
3. `environment: production` — 승인자 승인 후 시작, 상용 전용 시크릿
4. 태그 형식 `release/vX.Y.Z` 검사, 태그 커밋이 `origin/main` 에 포함되는지 검사
5. 수동 입력값은 env 로만 읽고 형식 검사를 통과해야 쓴다(스크립트 주입 방지)

#!/usr/bin/env bash
# 단일 노드 Swarm 무중단 배포 — GitHub Actions(self-hosted)가 호출. 저장소 루트에서 실행.
#   사용: bash deploy/swarm/deploy.sh backend <tag>   # 백엔드 이미지 빌드 → 마이그레이션 → 스택 갱신
#         bash deploy/swarm/deploy.sh web <tag>       # 웹·관리자 이미지 빌드 → 스택 갱신
# 전제: cutover.sh 로 전환 완료(스택 stock 존재), backend/.env.production 복사 완료.
# 갱신은 start-first(새 컨테이너 healthy 뒤 옛 것 종료). 실패하면 Swarm 이 자동 롤백하고 이 스크립트는 1로 끝난다.
set -euo pipefail

STACK=stock
WHAT=${1:?backend|web}
TAG=${2:?tag}
cd "$(dirname "$0")/../.."

# 백엔드·웹 워크플로가 동시에 돌아도 스택 갱신이 겹치지 않게 서버 단위 잠금(먼저 온 쪽이 끝날 때까지 대기).
# 서버가 macOS(Mac mini)라 flock 이 없다 → mkdir 은 원자적이라 잠금으로 쓴다. 30분 넘은 잠금은 죽은 것으로 보고 치운다.
LOCK=/tmp/stock_stack_deploy.lock.d
until mkdir "$LOCK" 2>/dev/null; do
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null || true; continue; fi
  echo "⏳ 다른 배포가 진행 중 — 대기"; sleep 5
done
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# 지금 떠 있는 서비스의 이미지 태그(다른 쪽 배포가 바꾸지 않게 유지)
current_tag() {
  docker service inspect "${STACK}_$1" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null \
    | sed -E 's/@.*$//; s/^.*://' || true
}

# DB 컨테이너가 다시 만들어졌으면 stock_net 연결이 사라진다 — 매번 확인해 붙인다(멱등)
for pair in postgres:stock_postgres_prod clickhouse:stock_clickhouse_prod redis:stock_redis_prod; do
  alias=${pair%%:*}; c=${pair#*:}
  if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$c" | grep -q '"stock_net"'; then
    echo "🔌 $c → stock_net($alias)"; docker network connect --alias "$alias" stock_net "$c"
  fi
done

case "$WHAT" in
  backend)
    export BACKEND_TAG="$TAG"
    WEB_TAG=$(current_tag web_client); export WEB_TAG=${WEB_TAG:-latest}
    echo "🔨 백엔드 이미지 stock-app-backend:$TAG"
    TAG="$TAG" docker compose -f docker-compose.prod.yml build auth_api
    echo "🗄️  마이그레이션(alembic upgrade head) — 실패하면 여기서 중단되고 옛 컨테이너는 그대로"
    docker run --rm --network stock_net --env-file backend/.env.production "stock-app-backend:$TAG" alembic upgrade head
    ;;
  web)
    export WEB_TAG="$TAG"
    BACKEND_TAG=$(current_tag auth_api); export BACKEND_TAG=${BACKEND_TAG:-latest}
    echo "🔨 웹 이미지 stock-app-web:$TAG · stock-app-admin:$TAG"
    TAG="$TAG" docker compose -f docker-compose.prod.yml build web_client admin_web
    ;;
  *) echo "backend|web 중 하나" >&2; exit 2 ;;
esac

# 이번 배포에서 이미지가 실제로 바뀌는 서비스만 기다린다(같은 태그 재실행이면 Swarm 이 갱신하지 않으므로 대상 아님).
if [ "$WHAT" = backend ]; then
  CANDIDATES="auth_api stock_api blog_api trading_game game_ws celery_worker celery_beat"; NEW="$BACKEND_TAG"
else
  CANDIDATES="web_client admin_web"; NEW="$WEB_TAG"
fi
EXPECT=""
for s in $CANDIDATES; do
  [ "$(current_tag "$s")" != "$NEW" ] && EXPECT="$EXPECT ${STACK}_$s"
done

echo "🚀 스택 갱신(BACKEND_TAG=$BACKEND_TAG WEB_TAG=$WEB_TAG) 대상:${EXPECT:- 없음}"
since=$(date -u +%Y-%m-%dT%H:%M:%S)   # 이 시각 이후 시작된 갱신만 이번 배포로 본다(이전 배포의 completed·rollback 상태에 속지 않게)
# env_file(../../backend/.env.production)이 스택 파일 기준 상대경로라 그 폴더에서 실행
(cd deploy/swarm && docker stack deploy --resolve-image never -c single-node.yml "$STACK")

# 대상 서비스의 갱신이 끝날 때까지 대기(최대 5분). 롤백되면 실패.
deadline=$((SECONDS + 300))
while [ -n "$EXPECT" ]; do
  pending=0; failed=""
  for svc in $EXPECT; do
    started=$(docker service inspect "$svc" --format '{{if .UpdateStatus}}{{.UpdateStatus.StartedAt}}{{end}}')
    state=$(docker service inspect "$svc" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}')
    if [ -z "$started" ] || [[ "$started" < "$since" ]]; then pending=$((pending + 1)); continue; fi  # 아직 시작 전
    case "$state" in
      completed)
        # 실제로 새 태그 태스크가 Running 인지(start-first + healthcheck 통과 뒤에만 Running)
        docker service ps "$svc" --filter desired-state=running --format '{{.Image}} {{.CurrentState}}' \
          | grep -q ":$NEW Running" || pending=$((pending + 1)) ;;
      rollback_*|paused) failed="$failed $svc($state)" ;;
      *) pending=$((pending + 1)) ;;
    esac
  done
  if [ -n "$failed" ]; then echo "::error::갱신 실패 → 자동 롤백:$failed"; docker stack ps "$STACK" --no-trunc | head -40; exit 1; fi
  if [ "$pending" -eq 0 ]; then break; fi
  if [ "$SECONDS" -ge "$deadline" ]; then echo "::error::5분 안에 갱신이 끝나지 않음"; docker stack ps "$STACK" --no-trunc | head -40; exit 1; fi
  sleep 5
done
docker stack services "$STACK"

# 오래된 태그 정리(최근 3개 유지 — 롤백용). 사용 중이면 지우지 못해도 넘어간다.
for repo in stock-app-backend stock-app-web stock-app-admin; do
  docker images "$repo" --format '{{.Tag}}' | { grep -v '^latest$' || true; } | tail -n +4 | while read -r t; do
    docker rmi "$repo:$t" >/dev/null 2>&1 || true
  done
done
echo "✅ $WHAT 배포 완료($TAG)"

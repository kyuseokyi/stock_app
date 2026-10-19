#!/usr/bin/env bash
# compose → 단일 노드 Swarm 전환(1회). 서버에서 운영자가 직접 실행. 앱이 1~2분 멈춘다 — 접속이 적은 시간에.
#   사용(저장소 루트, backend/.env.production 이 있어야 함):
#     bash deploy/swarm/cutover.sh            # 확인 질문 후 진행
#   되돌리기: bash deploy/swarm/rollback-to-compose.sh
#
# DB(postgres·clickhouse·redis) 컨테이너와 볼륨은 그대로 둔다(재시작도 안 함) — 외부 overlay 망 stock_net 에
# 같은 이름(postgres/clickhouse/redis)으로 붙이기만 한다. 앱 9개만 compose 에서 내리고 스택으로 올린다.
set -euo pipefail
cd "$(dirname "$0")/../.."

STACK=stock
# compose 가 띄운 앱 컨테이너(container_name 고정)
APP_CONTAINERS="stock_auth_api stock_stock_api stock_blog_api stock_trading_game stock_game_ws stock_celery_worker stock_celery_beat stock_web_client stock_admin_web"
DBS="postgres:stock_postgres_prod clickhouse:stock_clickhouse_prod redis:stock_redis_prod"
TAG=${TAG:-$(git rev-parse --short=12 HEAD)}

[ -f backend/.env.production ] || { echo "backend/.env.production 없음 — /opt/stock_app/env/.env.production 을 복사하세요"; exit 1; }
[ -f .env ] || { [ -f /opt/stock_app/env/compose.env ] && cp /opt/stock_app/env/compose.env .env || true; }
for pair in $DBS; do
  c=${pair#*:}
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" = healthy ] || { echo "$c 가 healthy 가 아님 — 중단"; exit 1; }
done

echo "이 작업은 앱 컨테이너 9개를 내리고 Swarm 스택($STACK, 태그 $TAG)으로 다시 올립니다. 1~2분 접속이 끊깁니다."
echo "20:30~20:50(일일 수집) 은 피하세요. 계속하려면 yes 입력:"
read -r ok; [ "$ok" = yes ] || { echo "취소"; exit 1; }

# 1) Swarm·망 준비(이미 있으면 그대로)
if [ "$(docker info --format '{{.Swarm.LocalNodeState}}')" != active ]; then
  docker swarm init --advertise-addr "${ADVERTISE_ADDR:-127.0.0.1}"
fi
docker network inspect stock_net >/dev/null 2>&1 || docker network create -d overlay --attachable stock_net
for pair in $DBS; do
  alias=${pair%%:*}; c=${pair#*:}
  if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$c" | grep -q '"stock_net"'; then
    docker network connect --alias "$alias" stock_net "$c"
  fi
done

# 2) 이미지 미리 빌드 + 마이그레이션(아직 옛 앱이 서비스 중 — 여기까지는 중단 없음)
TAG="$TAG" docker compose -f docker-compose.prod.yml build auth_api web_client admin_web
docker run --rm --network stock_net --env-file backend/.env.production "stock-app-backend:$TAG" alembic upgrade head
# 망·DNS 확인: 새 망에서 DB 이름이 풀리는지
docker run --rm --network stock_net --env-file backend/.env.production "stock-app-backend:$TAG" \
  python -c "import socket;[socket.gethostbyname(h) for h in ('postgres','clickhouse','redis')];print('DB 이름 확인 OK')"

# 3) 전환(여기부터 중단)
start=$SECONDS
docker rm -f $APP_CONTAINERS >/dev/null 2>&1 || true   # 이름으로 지운다(실행 폴더·compose 프로젝트 이름과 무관)
(cd deploy/swarm && BACKEND_TAG="$TAG" WEB_TAG="$TAG" docker stack deploy --resolve-image never -c single-node.yml "$STACK")

echo "⏳ 앱이 뜨기를 기다리는 중(최대 3분)…"
deadline=$((SECONDS + 180))
for port in 8001 8002 8003 8004 3000 3001; do
  path=/health; [ "$port" -ge 3000 ] && [ "$port" -le 3001 ] && path=/
  until curl -fsS -o /dev/null "http://localhost:$port$path"; do
    [ "$SECONDS" -ge "$deadline" ] && { echo "포트 $port 가 응답하지 않음 — docker stack ps $STACK 확인, 되돌리려면 rollback-to-compose.sh"; exit 1; }
    sleep 2
  done
  echo "  ✓ $port"
done
echo "✅ 전환 완료 — 중단 약 $((SECONDS - start))초. 이후 배포는 GitHub Actions 가 start-first 로 무중단 진행."
docker stack services "$STACK"

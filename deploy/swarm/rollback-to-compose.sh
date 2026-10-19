#!/usr/bin/env bash
# 단일 노드 Swarm → compose 로 되돌리기. 서버에서 운영자가 직접 실행(앱 1~2분 중단).
#   사용(저장소 루트): bash deploy/swarm/rollback-to-compose.sh
# 스택을 지우면 워크플로는 다시 compose 방식으로 배포한다(스택 stock 이 있을 때만 Swarm 방식).
# DB 컨테이너는 건드리지 않는다(stock_net 연결은 남아도 무해).
set -euo pipefail
cd "$(dirname "$0")/../.."
APPS="auth_api stock_api blog_api trading_game game_ws celery_worker celery_beat web_client admin_web"
# DB 를 띄운 compose 프로젝트 이름을 그대로 써야 DB 컨테이너를 새로 만들려다 이름이 충돌하지 않는다
PROJECT=$(docker inspect stock_postgres_prod --format '{{index .Config.Labels "com.docker.compose.project"}}')

docker stack rm stock
echo "⏳ 스택 정리 대기(포트 반납)…"
for _ in $(seq 1 60); do
  [ -z "$(docker ps -q --filter label=com.docker.stack.namespace=stock)" ] && break
  sleep 2
done
docker compose -p "$PROJECT" -f docker-compose.prod.yml up -d $APPS
echo "✅ compose 로 되돌림(프로젝트 $PROJECT)"
docker compose -p "$PROJECT" -f docker-compose.prod.yml ps

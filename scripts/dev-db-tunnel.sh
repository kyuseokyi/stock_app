#!/usr/bin/env bash
# 로컬 개발 → 개발서버(미니PC) DB SSH 터널.
#
# 배경: DB 포트(5432/8123/9000/6379)는 LAN 전용이며 Cloudflare 터널에 노출하지 않는다
#       (docs/claude_system_context.md). 따라서 로컬에서 개발서버 DB에 붙는 안전한 방법은
#       이미 구축된 cloudflared SSH 경로(ssh.haezean.com → 127.0.0.1:2222) 위로 SSH
#       포트포워딩을 얹는 것뿐이다. DB를 새로 노출하지 않고 카페/외부에서도 동작한다.
#
# 포워딩(로컬 → 개발서버):
#   localhost:15432 → PostgreSQL(5432)
#   localhost:18123 → ClickHouse HTTP(8123, clickhouse_connect)
#   (Redis 는 로컬 유지 — Celery 브로커 공유 시 로컬/개발서버 워커가 작업을 가로채므로 제외)
#
# 사용: 별도 터미널에서 실행해 연결을 유지한 채 로컬 백엔드를 띄운다.
#   ./scripts/dev-db-tunnel.sh
# 종료: Ctrl+C. (cloudflared LaunchAgent 로 127.0.0.1:2222 가 열려 있어야 함)
#
# 선행조건:
#   - cloudflared access tcp (ssh.haezean.com → 127.0.0.1:2222) 실행 중
#     (docs/cloudflare_termius_guide.md 의 LaunchAgent)
#   - backend/.env.development 의 DB 가 localhost:15432 / :18123 을 가리키도록 설정
#   - 개발서버 DB 비밀번호가 .env.development 값과 일치(기본 stock_password / password)
set -euo pipefail

SSH_PORT="${DEV_SSH_PORT:-2222}"        # cloudflared access tcp 로 열린 로컬 포트
SSH_USER="${DEV_SSH_USER:-kyuseok}"  # 미니PC 우분투 계정
SSH_HOST="127.0.0.1"

# 2222 가 안 열려 있으면(=cloudflared 미실행) 바로 안내하고 종료
if ! nc -z -w3 "$SSH_HOST" "$SSH_PORT" 2>/dev/null; then
  echo "[dev-db-tunnel] ✗ ${SSH_HOST}:${SSH_PORT} 닫힘 — cloudflared LaunchAgent 를 먼저 실행하세요." >&2
  echo "  launchctl load ~/Library/LaunchAgents/com.user.cloudflared.ssh.plist" >&2
  exit 1
fi

echo "[dev-db-tunnel] 개발서버 DB 터널 시작: PG→localhost:15432, CH→localhost:18123"
echo "[dev-db-tunnel] 유지하려면 이 창을 열어두세요. 끊기면 자동으로 다시 연결합니다. 종료: Ctrl+C"

# 자동 재연결: cloudflared(WebSocket) 경로는 Cloudflare 엣지 재조정·Mac 절전·네트워크 변경으로 몇 시간마다 끊긴다.
#   ServerAlive 30초×3 무응답이면 ssh 가 스스로 종료 → 3초 뒤 다시 붙는다. Ctrl+C 는 루프까지 끝낸다.
trap 'echo; echo "[dev-db-tunnel] 종료"; exit 0' INT TERM
fails=0
while true; do
  started=$(date +%s)
  # ExitOnForwardFailure: 포트 바인드 실패 시 조용히 붙지 말고 즉시 실패(green-but-broken 방지)
  ssh -N \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
    -p "$SSH_PORT" "${SSH_USER}@${SSH_HOST}" \
    -L 15432:localhost:5432 \
    -L 18123:localhost:8123 || true
  # 붙자마자 바로 끊기기를 5번 반복하면(포트 점유·인증 실패 등) 무한 재시도 대신 멈춘다
  if [ $(( $(date +%s) - started )) -lt 10 ]; then fails=$((fails + 1)); else fails=0; fi
  if [ "$fails" -ge 5 ]; then
    echo "[dev-db-tunnel] ✗ 연결 직후 종료가 5번 반복 — 15432/18123 포트 사용 중이거나 인증·cloudflared 문제. 확인 후 다시 실행하세요." >&2
    exit 1
  fi
  echo "[dev-db-tunnel] $(date '+%H:%M:%S') 연결 끊김 — 3초 뒤 다시 연결"
  sleep 3
done

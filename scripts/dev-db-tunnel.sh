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
SSH_USER="${DEV_SSH_USER:-summersnow}"  # 미니PC 우분투 계정
SSH_HOST="127.0.0.1"

# 2222 가 안 열려 있으면(=cloudflared 미실행) 바로 안내하고 종료
if ! nc -z -w3 "$SSH_HOST" "$SSH_PORT" 2>/dev/null; then
  echo "[dev-db-tunnel] ✗ ${SSH_HOST}:${SSH_PORT} 닫힘 — cloudflared LaunchAgent 를 먼저 실행하세요." >&2
  echo "  launchctl load ~/Library/LaunchAgents/com.user.cloudflared.ssh.plist" >&2
  exit 1
fi

echo "[dev-db-tunnel] 개발서버 DB 터널 시작: PG→localhost:15432, CH→localhost:18123"
echo "[dev-db-tunnel] 유지하려면 이 창을 열어두세요. 종료: Ctrl+C"

# ExitOnForwardFailure: 포트 바인드 실패 시 조용히 붙지 말고 즉시 실패(green-but-broken 방지)
exec ssh -N \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  -p "$SSH_PORT" "${SSH_USER}@${SSH_HOST}" \
  -L 15432:localhost:5432 \
  -L 18123:localhost:8123

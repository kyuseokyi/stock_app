# 배포 전 점검 — deploy.sh 가 source 한다(bash 3.2·BSD 도구 호환: macOS 개발 서버, Ubuntu 상용 공용).
#
# 재부팅 뒤 DB·터널 컨테이너가 꺼져 있거나 stock_net 연결이 낡아 이름이 안 풀리면, 마이그레이션이
# "could not translate host name postgres" 로 실패하고 기존 API 는 502 가 된다(2026-11-25 개발 서버 장애).
# docker inspect 의 Networks 는 멈춘 컨테이너·낡은 연결도 '붙어 있음'으로 보여 주므로 그것만으로는 못 잡는다.
# 그래서 ① 실제 실행 상태 ② healthy ③ 같은 망에서 이름 해석까지 확인하고, 고칠 수 있는 것은 고친다.
#
# 고치는 것: 멈춘 컨테이너 시작, 망에서 빠졌거나 이름이 안 풀리는 연결 다시 붙이기(-f 분리 → 별칭으로 연결).
# 고치지 않는 것: 시작 실패(데이터 폴더·외장 디스크 문제) → 이유와 복구 문서를 알려 주고 멈춘다(옛 서비스는 그대로).

PREFLIGHT_DOC="docs/deploy/single-node-swarm.md 9절(재부팅 뒤 복구)"
PREFLIGHT_NET=${PREFLIGHT_NET:-stock_net}
PREFLIGHT_HEALTH_WAIT=${PREFLIGHT_HEALTH_WAIT:-120}   # DB healthy 대기(초)

# "별칭:컨테이너" 목록. 터널(개발 서버의 상용 CH 읽기 전용 사이드카)은 있을 때만 점검한다.
preflight_targets() {
  echo "postgres:stock_postgres_prod clickhouse:stock_clickhouse_prod redis:stock_redis_prod"
  if docker inspect stock_ch_ro_tunnel >/dev/null 2>&1; then echo "stock_ch_ro_tunnel:stock_ch_ro_tunnel"; fi
}

# 꺼져 있으면 시작. 없거나 시작 실패면 1.
preflight_running() {
  c=$1
  st=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)
  case "$st" in
    running) return 0 ;;
    missing) echo "::error::$c 컨테이너가 없습니다 — $PREFLIGHT_DOC"; return 1 ;;
  esac
  echo "▶️  $c 가 '$st' 상태 — 시작합니다"
  if ! docker start "$c" >/dev/null; then
    echo "::error::$c 를 시작하지 못했습니다. 데이터 폴더(외장 디스크 마운트 여부)와 'docker logs $c' 를 확인하세요 — $PREFLIGHT_DOC"
    return 1
  fi
}

# 헬스체크가 있는 컨테이너는 healthy 까지 기다린다(없으면 바로 통과).
preflight_healthy() {
  c=$1; waited=0
  while :; do
    h=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null || echo missing)
    case "$h" in healthy|none) return 0 ;; unhealthy) echo "::error::$c 가 unhealthy — 'docker logs $c' 확인 — $PREFLIGHT_DOC"; return 1 ;; esac
    if [ "$waited" -ge "$PREFLIGHT_HEALTH_WAIT" ]; then echo "::error::$c 가 ${PREFLIGHT_HEALTH_WAIT}초 안에 healthy 가 되지 않았습니다 — $PREFLIGHT_DOC"; return 1; fi
    sleep 3; waited=$((waited + 3))
  done
}

# 망에 (다시) 붙인다. 별칭이 컨테이너 이름과 같으면 별칭 없이 붙인다(이름으로 이미 풀린다).
preflight_attach() {
  alias=$1; c=$2
  docker network disconnect -f "$PREFLIGHT_NET" "$c" >/dev/null 2>&1 || true
  if [ "$alias" = "$c" ]; then docker network connect "$PREFLIGHT_NET" "$c"
  else docker network connect --alias "$alias" "$PREFLIGHT_NET" "$c"; fi
}

# 같은 망의 임시 컨테이너에서 이름이 풀리지 않는 별칭만 출력한다. 해석용 이미지가 없으면 아무것도 출력하지 않는다(점검 생략).
preflight_unresolved() {
  img=$1; shift
  [ -n "$img" ] && docker image inspect "$img" >/dev/null 2>&1 || return 0
  docker run --rm --network "$PREFLIGHT_NET" "$img" python -c '
import socket, sys
for n in sys.argv[1:]:
    try:
        socket.gethostbyname(n)
    except OSError:
        print(n)
' "$@"
}

# 진입점 — 모두 통과하면 0, 고칠 수 없는 문제면 1. $1 = 이름 해석에 쓸 이미지(지금 떠 있는 백엔드 이미지).
preflight() {
  img=$1; aliases=""
  for pair in $(preflight_targets); do
    alias=${pair%%:*}; c=${pair#*:}
    preflight_running "$c" || return 1
    if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$c" | grep -q "\"$PREFLIGHT_NET\""; then
      echo "🔌 $c → $PREFLIGHT_NET($alias)"; preflight_attach "$alias" "$c"
    fi
    aliases="$aliases $alias"
  done
  for pair in $(preflight_targets); do
    preflight_healthy "${pair#*:}" || return 1
  done

  # shellcheck disable=SC2086 — 별칭 목록을 단어로 나눠 넘긴다
  bad=$(preflight_unresolved "$img" $aliases) || { echo "::error::이름 확인용 임시 컨테이너를 실행하지 못했습니다($PREFLIGHT_NET 망 확인) — $PREFLIGHT_DOC"; return 1; }
  if [ -z "$img" ] || ! docker image inspect "$img" >/dev/null 2>&1; then
    echo "⚠️  이름 해석 점검 생략 — 해석에 쓸 이미지가 없습니다(첫 배포)"; return 0
  fi
  [ -z "$bad" ] && { echo "✅ 사전 점검 통과(${aliases# })"; return 0; }

  echo "🔁 이름이 안 풀리는 연결을 다시 붙입니다:" $bad
  for pair in $(preflight_targets); do
    alias=${pair%%:*}
    for b in $bad; do [ "$b" = "$alias" ] && preflight_attach "$alias" "${pair#*:}"; done
  done
  # shellcheck disable=SC2086
  bad=$(preflight_unresolved "$img" $bad) || { echo "::error::이름 확인용 임시 컨테이너를 실행하지 못했습니다 — $PREFLIGHT_DOC"; return 1; }
  if [ -n "$bad" ]; then
    echo "::error::다시 붙여도 이름이 안 풀립니다:" $bad "— $PREFLIGHT_DOC"; return 1
  fi
  echo "✅ 사전 점검 통과(연결 복구함)"
}

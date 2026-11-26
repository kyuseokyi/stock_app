#!/bin/bash
# 개발 서버(Mac mini) PostgreSQL 매일 백업 — 2026-11-25 외장 SSD 손상 재발 방지 A안.
#
# DB 는 내장 디스크(Docker 이름 있는 볼륨)에, 백업은 외장 SSD 에 둔다 — 한쪽 디스크가 깨져도 다른 쪽이 남는다.
# 외장 SSD 가 안 붙어 있으면 백업하지 않고 실패로 끝낸다(폴더를 새로 만들면 내장 디스크에 쌓여 의미가 없다).
#
# ⚠️ 외장 디스크 파일 쓰기는 **Docker 보조 컨테이너 안에서** 한다.
#   launchd 가 띄운 bash 는 macOS 개인정보 보호(외장 볼륨 접근)에 막혀 `Operation not permitted` 가 난다
#   (터미널에서 직접 돌릴 때는 터미널 앱 권한으로 통과 — 2026-11-26 확인). OrbStack 은 이미 외장 볼륨 권한이 있어
#   바인드 마운트로 쓰면 bash 에 '전체 디스크 접근'을 주지 않아도 된다. 호스트 쪽은 덤프를 파이프로 넘기기만 한다.
#
# 수동 실행:  bash deploy/dev/pg-backup.sh
# 자동 실행:  deploy/dev/com.stockapp.pg-backup.plist (설치법은 docs/deploy/single-node-swarm.md 10절)
# 복원:      gunzip -c <파일> | docker exec -i stock_postgres_prod sh -c 'psql -U "$POSTGRES_USER" -d postgres'
#
# bash 3.2·BSD 도구 호환(macOS).
set -euo pipefail

VOLUME_ROOT=${PG_BACKUP_VOLUME:-/Volumes/StockData}
SUBDIR=${PG_BACKUP_SUBDIR:-backups/postgres}
KEEP_DAYS=${PG_BACKUP_KEEP_DAYS:-14}
CONTAINER=${PG_BACKUP_CONTAINER:-stock_postgres_prod}
REQUIRE_MOUNT=${PG_BACKUP_REQUIRE_MOUNT:-1}   # 시험할 때만 0

log() { echo "[pg-backup $(date '+%F %T')] $*"; }

# 외장 SSD 가 실제로 마운트됐는지(빈 폴더가 아닌지) 확인한다. mount 목록 읽기는 권한 제한이 없다.
if [ "$REQUIRE_MOUNT" = 1 ] && ! mount | grep -q " on $VOLUME_ROOT "; then
  log "오류: $VOLUME_ROOT 가 마운트되어 있지 않아 백업을 건너뜁니다(diskutil list external 로 확인)."
  exit 1
fi

if [ "$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo missing)" != running ]; then
  log "오류: $CONTAINER 가 실행 중이 아닙니다."
  exit 1
fi
# 보조 컨테이너는 DB 와 같은 이미지(이미 받아 둠 — 새로 내려받지 않음, gzip·find 포함).
IMG=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")
NAME="pg_$(date +%Y%m%d_%H%M).sql.gz"

# 보조 컨테이너 안에서 실행 — $D=백업 폴더, $1=동작. 결과 줄은 stdout 으로.
helper() {
  docker run --rm -i -v "$VOLUME_ROOT:/vol" -e D="/vol/$SUBDIR" -e NAME="$NAME" -e KEEP="$KEEP_DAYS" \
    "$IMG" sh -c "$1"
}
WRITE='set -e; mkdir -p "$D"; t="$D/$NAME.part"; gzip -c > "$t"
n=$(gunzip -c "$t" | head -c 200 | wc -c)
if [ "$n" -lt 100 ]; then rm -f "$t"; echo "EMPTY"; exit 3; fi
mv "$t" "$D/$NAME"; echo "SIZE $(du -h "$D/$NAME" | cut -f1)"'
CLEAN='rm -f "$D/$NAME.part" "$D/$NAME"'
PRUNE='find "$D" -name "pg_*.sql.gz" -type f -mtime +"$KEEP" -print -delete'

# 계정 이름·비밀번호는 DB 컨테이너 안 환경 변수에서만 읽는다(화면·파일에 남기지 않음).
res=""
if res=$(docker exec "$CONTAINER" sh -c 'pg_dumpall -U "$POSTGRES_USER"' | helper "$WRITE"); then
  log "완료: $VOLUME_ROOT/$SUBDIR/$NAME (${res#SIZE })"
else
  # 덤프가 중간에 끊기면 일부만 쓰인 파일이 남을 수 있어 지운다.
  helper "$CLEAN" </dev/null >/dev/null 2>&1 || true
  case "$res" in
    *EMPTY*) log "오류: 덤프 결과가 비어 있습니다." ;;
    *) log "오류: 백업 실패(pg_dumpall 또는 외장 디스크 쓰기). 'docker logs $CONTAINER' 확인." ;;
  esac
  exit 1
fi

# 오래된 백업 정리(이 스크립트가 만든 이름 형식만).
helper "$PRUNE" </dev/null | while read -r f; do log "삭제(보관 ${KEEP_DAYS}일 초과): ${f/#\/vol/$VOLUME_ROOT}"; done

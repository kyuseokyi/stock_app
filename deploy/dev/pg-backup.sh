#!/bin/bash
# 개발 서버(Mac mini) PostgreSQL 매일 백업 — 2026-11-25 외장 SSD 손상 재발 방지 A안.
#
# DB 는 내장 디스크(Docker 이름 있는 볼륨)에, 백업은 외장 SSD 에 둔다 — 한쪽 디스크가 깨져도 다른 쪽이 남는다.
# 외장 SSD 가 안 붙어 있으면 백업하지 않고 실패로 끝낸다(폴더를 새로 만들면 내장 디스크에 쌓여 의미가 없다).
#
# 수동 실행:  bash deploy/dev/pg-backup.sh
# 자동 실행:  deploy/dev/com.stockapp.pg-backup.plist (설치법은 docs/deploy/single-node-swarm.md 10절)
# 복원:      gunzip -c <파일> | docker exec -i stock_postgres_prod sh -c 'psql -U "$POSTGRES_USER" -d postgres'
#
# bash 3.2·BSD 도구 호환(macOS).
set -euo pipefail

VOLUME_ROOT=${PG_BACKUP_VOLUME:-/Volumes/StockData}
BACKUP_DIR=${PG_BACKUP_DIR:-$VOLUME_ROOT/backups/postgres}
KEEP_DAYS=${PG_BACKUP_KEEP_DAYS:-14}
CONTAINER=${PG_BACKUP_CONTAINER:-stock_postgres_prod}

log() { echo "[pg-backup $(date '+%F %T')] $*"; }

# 외장 SSD 가 실제로 마운트됐는지(빈 폴더가 아닌지) 확인한다.
if ! mount | grep -q " on $VOLUME_ROOT "; then
  log "오류: $VOLUME_ROOT 가 마운트되어 있지 않아 백업을 건너뜁니다(diskutil list external 로 확인)."
  exit 1
fi
mkdir -p "$BACKUP_DIR"

if [ "$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo missing)" != running ]; then
  log "오류: $CONTAINER 가 실행 중이 아닙니다."
  exit 1
fi

out="$BACKUP_DIR/pg_$(date +%Y%m%d_%H%M).sql.gz"
tmp="$out.part"
# 계정 이름·비밀번호는 컨테이너 안 환경 변수에서만 읽는다(화면·파일에 남기지 않음).
if docker exec "$CONTAINER" sh -c 'pg_dumpall -U "$POSTGRES_USER"' | gzip -c > "$tmp"; then
  # 빈 덤프(연결 실패 등)를 정상 백업으로 남기지 않는다.
  if [ "$(gunzip -c "$tmp" | head -c 200 | wc -c | tr -d ' ')" -lt 100 ]; then
    rm -f "$tmp"
    log "오류: 덤프 결과가 비어 있습니다."
    exit 1
  fi
  mv "$tmp" "$out"
  log "완료: $out ($(du -h "$out" | cut -f1))"
else
  rm -f "$tmp"
  log "오류: pg_dumpall 실패."
  exit 1
fi

# 오래된 백업 정리(이 스크립트가 만든 이름 형식만).
find "$BACKUP_DIR" -name 'pg_*.sql.gz' -type f -mtime +"$KEEP_DAYS" -print -delete | while read -r f; do log "삭제(보관 ${KEEP_DAYS}일 초과): $f"; done

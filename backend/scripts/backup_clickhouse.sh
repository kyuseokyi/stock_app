#!/usr/bin/env bash
#
# ClickHouse stock_data 백업 스크립트
# - DB의 모든 테이블을 스키마(DDL) + 데이터(Native, ReplacingMergeTree는 FINAL로 중복제거)로 덤프
# - 타임스탬프 tar.gz 하나로 묶어 출력
#
# 사용법:
#   ./scripts/backup_clickhouse.sh
#   OUT_DIR=/data/backups ./scripts/backup_clickhouse.sh      # 출력 위치 지정
#   CH_DB=stock_data CH_PASSWORD=xxx ./scripts/backup_clickhouse.sh
#
# 환경변수(override 가능):
#   CH_CONTAINER  ClickHouse 도커 컨테이너명 (기본: 자동탐지)
#   CH_USER       기본 default
#   CH_PASSWORD   기본 password
#   CH_DB         기본 stock_data
#   OUT_DIR       백업 출력 디렉토리 (기본: ./backups)
set -euo pipefail

CH_CONTAINER="${CH_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -i clickhouse | head -1)}"
CH_USER="${CH_USER:-default}"
CH_PASSWORD="${CH_PASSWORD:-password}"
CH_DB="${CH_DB:-stock_data}"
OUT_DIR="${OUT_DIR:-./backups}"

[ -n "$CH_CONTAINER" ] || { echo "ERROR: ClickHouse 컨테이너를 찾을 수 없습니다. CH_CONTAINER 를 지정하세요." >&2; exit 1; }

chq() { docker exec -i "$CH_CONTAINER" clickhouse-client --user "$CH_USER" --password "$CH_PASSWORD" "$@"; }

TS="$(date +%Y%m%d_%H%M%S)"
DEST="${OUT_DIR}/${CH_DB}_${TS}"
mkdir -p "$DEST"
echo "[backup] container=$CH_CONTAINER db=$CH_DB → $DEST"

TABLES="$(chq --query "SELECT name FROM system.tables WHERE database='${CH_DB}' ORDER BY name")"
[ -n "$TABLES" ] || { echo "ERROR: '${CH_DB}' 에 테이블이 없습니다." >&2; exit 1; }

for T in $TABLES; do
  ENGINE="$(chq --query "SELECT engine FROM system.tables WHERE database='${CH_DB}' AND name='${T}'")"
  # 스키마 DDL (원문 그대로)
  chq --format TabSeparatedRaw --query "SHOW CREATE TABLE ${CH_DB}.${T}" > "${DEST}/${T}.schema.sql"
  # ReplacingMergeTree 는 FINAL 로 중복제거 후 덤프
  FINAL=""; case "$ENGINE" in *Replacing*) FINAL="FINAL";; esac
  chq --query "SELECT * FROM ${CH_DB}.${T} ${FINAL} FORMAT Native" | gzip > "${DEST}/${T}.native.gz"
  ROWS="$(chq --query "SELECT count() FROM ${CH_DB}.${T} ${FINAL}")"
  echo "  - ${T} (${ENGINE}): ${ROWS} rows → ${T}.native.gz"
done

TARBALL="${DEST}.tar.gz"
tar -czf "$TARBALL" -C "$OUT_DIR" "$(basename "$DEST")"
rm -rf "$DEST"
echo "[backup] 완료: ${TARBALL} ($(du -h "$TARBALL" | cut -f1))"

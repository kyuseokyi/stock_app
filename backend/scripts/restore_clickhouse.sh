#!/usr/bin/env bash
#
# ClickHouse stock_data 복원 스크립트
# - backup_clickhouse.sh 로 만든 tar.gz 를 받아 DB/테이블 생성 후 데이터 삽입
# - daily_prices 는 ReplacingMergeTree 라 재복원해도 (ticker,date) 멱등
#
# 사용법:
#   ./scripts/restore_clickhouse.sh backups/stock_data_20260806_170000.tar.gz
#   CH_PASSWORD=xxx ./scripts/restore_clickhouse.sh <백업.tar.gz>
#
# 환경변수(override 가능): CH_CONTAINER / CH_USER / CH_PASSWORD / CH_DB (백업과 동일 DB명 권장)
set -euo pipefail

TARBALL="${1:-}"
[ -n "$TARBALL" ] && [ -f "$TARBALL" ] || { echo "사용법: $0 <백업.tar.gz>" >&2; exit 1; }

CH_CONTAINER="${CH_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -i clickhouse | head -1)}"
CH_USER="${CH_USER:-default}"
CH_PASSWORD="${CH_PASSWORD:-password}"
CH_DB="${CH_DB:-stock_data}"

[ -n "$CH_CONTAINER" ] || { echo "ERROR: ClickHouse 컨테이너를 찾을 수 없습니다. CH_CONTAINER 를 지정하세요." >&2; exit 1; }

chq() { docker exec -i "$CH_CONTAINER" clickhouse-client --user "$CH_USER" --password "$CH_PASSWORD" "$@"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$TARBALL" -C "$WORK"
SRC="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$SRC" ] || { echo "ERROR: 백업 내용이 비어 있습니다." >&2; exit 1; }

echo "[restore] container=$CH_CONTAINER db=$CH_DB ← $TARBALL"
chq --query "CREATE DATABASE IF NOT EXISTS ${CH_DB}"

for SCHEMA in "$SRC"/*.schema.sql; do
  T="$(basename "$SCHEMA" .schema.sql)"
  EXISTS="$(chq --query "SELECT count() FROM system.tables WHERE database='${CH_DB}' AND name='${T}'")"
  if [ "$EXISTS" = "0" ]; then
    # SHOW CREATE 결과의 "CREATE TABLE <원본DB>.<T>" → "CREATE TABLE IF NOT EXISTS <CH_DB>.<T>"
    # (IF NOT EXISTS 주입 + 대상 DB명으로 치환하여 임의 DB명 복원 지원)
    sed -E "s/^CREATE TABLE [^ .\`]+\.${T}/CREATE TABLE IF NOT EXISTS ${CH_DB}.${T}/" "$SCHEMA" | chq --multiquery
    echo "  + 테이블 생성: ${T}"
  fi
  if [ "$(gunzip -c "${SRC}/${T}.native.gz" | wc -c)" -gt 0 ]; then
    gunzip -c "${SRC}/${T}.native.gz" | chq --query "INSERT INTO ${CH_DB}.${T} FORMAT Native"
    chq --query "OPTIMIZE TABLE ${CH_DB}.${T} FINAL" 2>/dev/null || true
    ROWS="$(chq --query "SELECT count() FROM ${CH_DB}.${T} FINAL")"
    echo "  - ${T}: 복원 후 ${ROWS} rows"
  else
    echo "  - ${T}: 빈 테이블(데이터 없음) — 스키마만 복원"
  fi
done
echo "[restore] 완료"

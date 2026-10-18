#!/usr/bin/env bash
# 펀드 core 복사본 동일 여부 검사 — 기준: mobile/src/features/fund/core, 복사본: web_client/src/lib/fundCore
#   검사:  scripts/check-fund-core-sync.sh          (다르면 diff 출력 후 exit 1)
#   복사:  scripts/check-fund-core-sync.sh --write  (기준 → 복사본, *.test.ts 제외)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/mobile/src/features/fund/core"
DST="$ROOT/web_client/src/lib/fundCore"

if [ "${1:-}" = "--write" ]; then
  mkdir -p "$DST"
  for f in "$SRC"/*.ts; do
    case "$f" in *.test.ts) continue ;; esac
    cp "$f" "$DST/"
  done
  echo "copied → $DST"
fi

status=0
for f in "$SRC"/*.ts; do
  case "$f" in *.test.ts) continue ;; esac
  name="$(basename "$f")"
  if ! diff -u "$f" "$DST/$name"; then status=1; fi
done
for f in "$DST"/*.ts; do
  [ -e "$SRC/$(basename "$f")" ] || { echo "복사본에만 있음: $f"; status=1; }
done
[ $status -eq 0 ] && echo "fund core: in sync"
exit $status

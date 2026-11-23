#!/usr/bin/env bash
# 빌드한 APK 이름에 런타임 지문(앞 7자리)을 붙인다 — stockapp-<dev|prod>-<YYYYMMDD-HHmm>-<지문7>.apk
#
# 왜: APK 는 자기 지문과 같은 OTA 만 받는다(다르면 오류 없이 무시). 이름에 지문이 있으면 OTA 발행 결과의
#   "Runtime version" 앞 7자리와 눈으로 비교해 이 APK 가 그 OTA 를 받는지 바로 안다(2026-11-23 두 번 겪은 '조용한 미수신').
# 지문은 빌드 전에 계산하지 않고 APK 안 assets/fingerprint(실제로 구워진 값)를 읽는다 — worktree 빌드처럼
#   계산값과 구운 값이 다를 수 있기 때문.
# plugins/with-apk-name.js(prebuild, 지문 계산 입력)는 건드리지 않는다 — 고치면 지문이 바뀌어 설치된 APK 가 OTA 를 못 받는다.
#   그 플러그인이 만든 이름(stockapp-<env>-<브랜치>-<일시>.apk)에서 환경·일시를 읽어 이름만 바꾼다.
#
# 사용: NEW=$(bash scripts/apk-fingerprint-name.sh <apk 경로>)   → 바뀐 경로를 stdout 으로(실패하면 원래 경로, 종료 0)
set -euo pipefail

APK="$1"
fp=$(unzip -p "$APK" assets/fingerprint 2>/dev/null | tr -d '[:space:]' || true)
if ! [[ "$fp" =~ ^[0-9a-f]{7,}$ ]]; then
  echo "[apk] ⚠ APK 에서 지문을 읽지 못해 이름을 그대로 둡니다: $(basename "$APK")" >&2
  echo "$APK"
  exit 0
fi
base=$(basename "$APK" .apk)
env=$(echo "$base" | grep -oE '^stockapp-(dev|prod)' | sed 's/^stockapp-//' || true)
stamp=$(echo "$base" | grep -oE '[0-9]{8}-[0-9]{4}$' || true)
[ -n "$env" ] || env=unknown
[ -n "$stamp" ] || stamp=$(date '+%Y%m%d-%H%M')
NEW="$(dirname "$APK")/stockapp-${env}-${stamp}-${fp:0:7}.apk"
[ "$NEW" = "$APK" ] || mv -f "$APK" "$NEW"
echo "$NEW"

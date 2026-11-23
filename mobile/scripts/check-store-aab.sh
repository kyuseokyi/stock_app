#!/usr/bin/env bash
# 스토어 AAB 검사 + 이름에 지문 7자리 — build-store-android.sh(eas build --local)·build-store-aab-local.sh(Gradle 직접) 공용.
# 하나라도 틀리면 실패(업로드 금지). 사용: NEW=$(bash scripts/check-store-aab.sh <aab> <태그>)  → 바뀐 경로를 stdout 으로
set -euo pipefail
AAB="$1"; TAG="${2:-store}"
fail() { echo "[$TAG] ✗ $*" >&2; exit 1; }
[ -f "$AAB" ] || fail "AAB 를 찾지 못함: $AAB"

# AAB = zip, 모듈 base/
URLS=$(unzip -p "$AAB" base/assets/index.android.bundle 2>/dev/null | LC_ALL=C grep -aoE 'https?://[a-z0-9.:-]+' | sort -u || true)
for host in api auth blog game; do
  echo "$URLS" | grep -qx "https://$host.funnotedaily.com" || fail "번들에 https://$host.funnotedaily.com 이 없음"
done
# 백엔드 개발 포트(8000~8009)·개발 도메인이 남으면 상용 앱이 개발 서버/자기 기기로 붙는다
# (localhost:8081 은 경로 파싱용 기준 주소라 제외 — 정상 상용 APK 에도 있다)
LEAK=$(echo "$URLS" | grep -E '//(localhost|127\.0\.0\.1|10\.0\.2\.2):800[0-9]$|haezean\.com' || true)
[ -z "$LEAK" ] || fail "번들에 개발 주소가 남아 있음: $(echo $LEAK)"
CONFIG=$(unzip -p "$AAB" base/assets/app.config 2>/dev/null || true)
echo "$CONFIG" | grep -q '"com.stocknote"' || fail "AAB 설정의 패키지가 com.stocknote 가 아님"
echo "$CONFIG" | grep -q '"projectId"' || fail "AAB 설정에 projectId 없음 — 푸시가 꺼진 앱"
echo "$CONFIG" | grep -q '"expo-channel-name":"production"' || fail "AAB 의 OTA 채널이 production 이 아님"
unzip -l "$AAB" | grep -q 'BUNDLE-METADATA\|base/manifest/AndroidManifest.xml' || fail "AAB 구조가 아님(base/manifest 없음)"

FP=$(unzip -p "$AAB" base/assets/fingerprint 2>/dev/null | tr -d '[:space:]' || true)
if [[ "$FP" =~ ^[0-9a-f]{7,}$ ]]; then
  base=$(basename "$AAB" .aab); base=${base%-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]}
  NEW="$(dirname "$AAB")/${base}-${FP:0:7}.aab"
  [ "$NEW" = "$AAB" ] || mv -f "$AAB" "$NEW"; AAB="$NEW"
  echo "[$TAG] 지문: ${FP:0:7} — 'npm run ota:prod' 발행 결과의 Android Runtime version 앞 7자리와 같아야 스토어 앱이 받는다" >&2
fi
echo "[$TAG] ✓ 검사 통과(상용 주소 4개·개발 주소 없음·com.stocknote·projectId·production 채널)" >&2
echo "$AAB"

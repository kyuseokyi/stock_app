#!/usr/bin/env bash
# 스토어 제출용 Android AAB(상용 com.stocknote, EAS production 프로필) — eas build --local + 결과 검사.
#
# 왜 스크립트인가(docs/deploy/store-release.md D9): eas build 는 저장소를 묶어 따로 빌드하는데, .gitignore 규칙 그대로면
#   mobile/.env.production·secrets/google-services.json 이 빠져 API 주소 localhost·푸시 꺼진 AAB 가 나온다.
#   → 저장소 루트 .easignore 가 두 파일만 예외로 넣는다. 이 스크립트는 그 전제를 확인하고, 빌드 결과(AAB)를 열어
#     상용 주소·패키지·projectId 를 검사한 뒤 이름에 지문 앞 7자리를 붙인다. 하나라도 틀리면 실패(업로드 금지).
#
# 사용: npm run build:android:prod
# 결과: build/store/stockapp-prod-store-<YYYYMMDD-HHmm>-<지문7>.aab   (build/ 는 git·EAS 묶음 제외)
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "[store] ✗ $*" >&2; exit 1; }
[ -f ../.easignore ] || fail "저장소 루트 .easignore 가 없음 — 상용 설정이 빌드 묶음에서 빠진다"
[ -f .env.production ] || fail "mobile/.env.production 이 없음"
[ -f secrets/google-services.json ] || fail "mobile/secrets/google-services.json 이 없음(Firebase 상용 앱 com.stocknote)"
grep -q '"com.stocknote"' secrets/google-services.json || fail "google-services.json 에 com.stocknote 앱이 없음"
# 다른 기기에서 localhost 는 그 기기 자신 — 상용 주소가 아니면 멈춘다(값은 출력하지 않고 키 이름만)
BAD=$(grep -E '^EXPO_PUBLIC_[A-Z_]*_URL=' .env.production | grep -vE '=https://[a-z0-9.-]*funnotedaily\.com' | cut -d= -f1 || true)
[ -z "$BAD" ] || fail ".env.production 의 주소가 상용(https://*.funnotedaily.com)이 아님: $BAD"

if command -v eas >/dev/null 2>&1; then EAS=(eas); else EAS=(npx --yes eas-cli); fi
STAMP=$(date '+%Y%m%d-%H%M')
mkdir -p build/store
OUT="build/store/stockapp-prod-store-$STAMP.aab"
"${EAS[@]}" build --platform android --profile production --local --output "$OUT"
[ -f "$OUT" ] || fail "AAB 를 찾지 못함: $OUT"

# ---- 결과 검사(AAB = zip, 모듈 base/) ----
BUNDLE_URLS=$(unzip -p "$OUT" base/assets/index.android.bundle 2>/dev/null | LC_ALL=C grep -aoE 'https?://[a-z0-9.:-]+' | sort -u || true)
for host in api auth blog game; do
  echo "$BUNDLE_URLS" | grep -qx "https://$host.funnotedaily.com" || fail "번들에 https://$host.funnotedaily.com 이 없음"
done
# 백엔드 개발 포트(8000~8009)·개발 도메인이 남아 있으면 상용 앱이 개발 서버/자기 기기로 붙는다
# (localhost:8081 은 경로 파싱용 기준 주소라 제외 — 정상 상용 APK 에도 있다)
LEAK=$(echo "$BUNDLE_URLS" | grep -E '//(localhost|127\.0\.0\.1|10\.0\.2\.2):800[0-9]$|haezean\.com' || true)
[ -z "$LEAK" ] || fail "번들에 개발 주소가 남아 있음: $(echo $LEAK)"
CONFIG=$(unzip -p "$OUT" base/assets/app.config 2>/dev/null || true)
echo "$CONFIG" | grep -q '"com.stocknote"' || fail "AAB 설정의 패키지가 com.stocknote 가 아님"
echo "$CONFIG" | grep -q '"projectId"' || fail "AAB 설정에 projectId 없음 — 푸시가 꺼진 앱"
echo "$CONFIG" | grep -q '"expo-channel-name":"production"' || fail "AAB 의 OTA 채널이 production 이 아님"

FP=$(unzip -p "$OUT" base/assets/fingerprint 2>/dev/null | tr -d '[:space:]' || true)
if [[ "$FP" =~ ^[0-9a-f]{7,}$ ]]; then
  NEW="build/store/stockapp-prod-store-$STAMP-${FP:0:7}.aab"
  mv -f "$OUT" "$NEW"; OUT="$NEW"
fi
echo "[store] ✓ $OUT"
echo "[store] 지문: ${FP:0:7} — 이후 'npm run ota:prod' 발행 결과의 Android Runtime version 앞 7자리와 같아야 스토어 앱이 받는다"
echo "[store] 다음: Play Console > 테스트 > 비공개 테스트 > 새 버전 만들기 에 이 AAB 업로드(서명 키 백업 확인)"

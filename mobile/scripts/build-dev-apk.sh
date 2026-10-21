#!/usr/bin/env bash
# 개발 앱(StockApp Dev, com.stockapp.dev) 독립실행형 APK — Metro 없이 혼자 실행, 다른 테스트 기기에 설치용.
#
# 왜 스크립트인가: release 번들(export:embed)은 Expo 가 NODE_ENV=production 으로 고정해 .env.production* 만 읽는다.
#   그대로 빌드하면 패키지는 dev 인데 JS 는 운영 env(게임 주소 없음·게스트 로그인 숨김)가 된다.
#   → 빌드 동안만 개발 env(.env.development.local > .env.development)를 .env.production.local 로 옮기고 끝나면 지운다.
#
# 다른 기기에서 localhost 는 그 기기 자신이라 접속 불가 → 주소가 localhost 면 빌드 전에 멈춘다.
#   개발 서버로 붙이려면 .env.development.local 에 EXPO_PUBLIC_*_URL 을 넣는다(git 제외 파일).
#
# 사용: npm run build:android:devapk
# 결과: android/app/build/outputs/apk/release/app-release.apk (debug 키 서명 — 내부 테스트용, 스토어 업로드 불가)
set -euo pipefail

cd "$(dirname "$0")/.."

BASE=.env.development
LOCAL=.env.development.local
TMP=.env.production.local
LOCALHOST_URL='^EXPO_PUBLIC_[A-Z_]*_URL=https?://(localhost|127\.0\.0\.1|10\.0\.2\.2)([:/]|$)'

[ -f "$BASE" ] || { echo "[devapk] ✗ $BASE 없음" >&2; exit 1; }
if [ -e "$TMP" ]; then
  echo "[devapk] ✗ $TMP 가 이미 있음 — 직접 만든 파일이면 옮긴 뒤 다시 실행하세요(덮어쓰지 않음)." >&2
  exit 1
fi
if ! grep -qE "applicationId ['\"]com\.stockapp\.dev['\"]" android/app/build.gradle 2>/dev/null; then
  echo "[devapk] ✗ android/ 가 개발 앱(com.stockapp.dev)으로 prebuild 돼 있지 않음 — npm run prebuild:dev:android 먼저." >&2
  exit 1
fi

trap 'rm -f "$TMP"' EXIT

# 먼저 나온 키가 이긴다: APP_ENV 고정 → .local → 기본. 주석·빈 줄 제외.
SOURCES=("$BASE")
[ -f "$LOCAL" ] && SOURCES=("$LOCAL" "$BASE")
{ echo "EXPO_PUBLIC_APP_ENV=development"; cat "${SOURCES[@]}"; } \
  | awk -F= '/^[A-Z_][A-Z0-9_]*=/ && !seen[$1]++' > "$TMP"

if grep -qE "$LOCALHOST_URL" "$TMP"; then
  echo "[devapk] ✗ 아래 주소가 localhost 라 다른 기기에서 접속할 수 없습니다 — $LOCAL 에 개발 서버 주소를 넣으세요:" >&2
  grep -E "$LOCALHOST_URL" "$TMP" | cut -d= -f1 | sed 's/^/  - /' >&2
  exit 1
fi
grep -q '^EXPO_PUBLIC_GAME_API_URL=' "$TMP" || echo "[devapk] ⚠ EXPO_PUBLIC_GAME_API_URL 없음 — 게임 탭이 연결되지 않습니다."
echo "[devapk] 적용 키: $(cut -d= -f1 "$TMP" | tr '\n' ' ')"

# 합친 env 를 Gradle 프로세스 환경변수로도 넘긴다 — expo-constants 가 빌드 중 app.config.js 를 평가해 assets/app.config 를
# 만들 때 env 파일만으로는 EAS_PROJECT_ID 가 안 보여 extra.eas.projectId 가 빠졌다(→ 앱이 푸시 미설정으로 보고 알림 탭 처리를 끔).
# ABI: 기본은 arm64-v8a 만 — 4종(armeabi-v7a·arm64-v8a·x86·x86_64)을 모두 넣으면 네이티브 라이브러리만 ~92MB 라 APK 가 ~120MB.
#   실제 폰과 Apple Silicon 에뮬레이터는 arm64 → ~50MB. 32비트 폰·인텔 에뮬레이터용이 필요하면 DEVAPK_ABIS=armeabi-v7a,arm64-v8a 처럼 지정.
#   android/ 는 prebuild 때 다시 생성되므로 gradle.properties 를 고치지 않고 -P 로 넘긴다.
ABIS="${DEVAPK_ABIS:-arm64-v8a}"
echo "[devapk] ABI: $ABIS"
(set -a; . "./$TMP"; set +a; cd android && APP_ENV=development ./gradlew assembleRelease -PreactNativeArchitectures="$ABIS")

# 푸시 설정이 실제로 들어갔는지 확인(값은 출력하지 않음)
APK=android/app/build/outputs/apk/release/app-release.apk
if grep -q '^EAS_PROJECT_ID=' "$TMP" && ! unzip -p "$APK" assets/app.config 2>/dev/null | grep -q '"projectId"'; then
  echo "[devapk] ✗ EAS_PROJECT_ID 가 있는데 APK 설정에 projectId 가 없음 — 푸시가 꺼진 앱이 된다." >&2
  exit 1
fi

echo "[devapk] ✓ android/app/build/outputs/apk/release/app-release.apk"

#!/usr/bin/env bash
# 상용 테스트 APK(FunNote, com.stockapp) — 상용 서버(.env.production)에 붙는 앱을 폰에 직접 설치해 확인하는 용도.
# OTA 채널은 preview(eas.json preview 프로필과 같은 APP_ENV=production·EXPO_UPDATES_CHANNEL=preview) → `npm run ota:preview`.
#
# 왜 eas build 가 아니라 Gradle 인가: eas build 는 --local 이어도 프로젝트를 .gitignore 규칙대로 복사해 빌드한다
#   (eas-cli vcs/local.js — .easignore 가 없으면 .gitignore 적용). .env.production 과 secrets/google-services.json 이
#   git 제외라 빠지고, 서버 주소·FCM 설정 없는 앱이 나온다. 여기서는 작업 폴더에서 바로 빌드해 두 파일을 그대로 쓴다.
#
# android/ 를 상용(com.stockapp·preview 채널)으로 다시 prebuild 한다. 개발 APK 를 다시 만들 때는
#   npm run prebuild:dev:android 먼저(build-dev-apk.sh 가 패키지를 검사해 알려 준다).
#
# 사용: npm run build:android:preview
# 결과: android/app/build/outputs/apk/release/stockapp-prod-<브랜치>-<YYYYMMDD-HHmm>.apk
#       (debug 키 서명 — 설치 확인용, 스토어 업로드 불가. 스토어용 AAB 는 별도)
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=.env.production
OVERRIDE=.env.production.local
GSF=secrets/google-services.json
LOCALHOST_URL='^EXPO_PUBLIC_[A-Z_]*_URL=https?://(localhost|127\.0\.0\.1|10\.0\.2\.2)([:/]|$)'

[ -f "$ENV_FILE" ] || { echo "[preview] ✗ $ENV_FILE 없음" >&2; exit 1; }
# 남아 있으면(중간에 죽은 개발 APK 빌드·dev OTA 발행) 상용 APK 에 개발 주소가 실린다
if [ -e "$OVERRIDE" ]; then
  echo "[preview] ✗ $OVERRIDE 가 있음 — 상용 주소를 덮어쓰므로 옮기거나 지운 뒤 다시 실행하세요." >&2
  exit 1
fi
[ -f "$GSF" ] || { echo "[preview] ✗ $GSF 없음 — 알림(FCM)이 동작하지 않는 앱이 됩니다." >&2; exit 1; }
grep -q '"com.stockapp"' "$GSF" || { echo "[preview] ✗ $GSF 에 com.stockapp 이 없음" >&2; exit 1; }
if grep -qE "$LOCALHOST_URL" "$ENV_FILE"; then
  echo "[preview] ✗ $ENV_FILE 에 localhost 주소가 있음 — 폰에서 접속할 수 없습니다." >&2
  exit 1
fi
echo "[preview] 서버: $(grep -oE '^EXPO_PUBLIC_AUTH_API_URL=.*' "$ENV_FILE" | cut -d= -f2)"

export APP_ENV=production EXPO_UPDATES_CHANNEL=preview

npx expo prebuild --platform android --clean
grep -qE "applicationId ['\"]com\.stockapp['\"]" android/app/build.gradle \
  || { echo "[preview] ✗ prebuild 결과가 com.stockapp 이 아님" >&2; exit 1; }

# ABI·메모리·fingerprint 재생성 이유는 build-dev-apk.sh 주석과 같다.
ABIS="${DEVAPK_ABIS:-arm64-v8a}"
JVMARGS="${DEVAPK_JVMARGS:--Xmx4096m -XX:MaxMetaspaceSize=1536m}"
echo "[preview] ABI: $ABIS"
(cd android && ./gradlew --stop >/dev/null 2>&1 || true)
# .env.production 을 Gradle 환경변수로도 넘긴다 — 빌드 중 app.config.js 평가(expo-constants)가 같은 값을 보게.
(set -a; . "./$ENV_FILE"; set +a; cd android && ./gradlew :app:createReleaseUpdatesResources --rerun assembleRelease \
  -PreactNativeArchitectures="$ABIS" "-Dorg.gradle.jvmargs=$JVMARGS")

APK=$(ls -t android/app/build/outputs/apk/release/*.apk 2>/dev/null | head -1 || true)
[ -n "$APK" ] || { echo "[preview] ✗ release APK 를 찾지 못함" >&2; exit 1; }
# 푸시·OTA 설정이 들어갔는지(값은 출력하지 않음)
CONFIG=$(unzip -p "$APK" assets/app.config 2>/dev/null || true)
echo "$CONFIG" | grep -q '"projectId"' || { echo "[preview] ✗ APK 설정에 projectId 없음 — 푸시가 꺼진 앱" >&2; exit 1; }
echo "$CONFIG" | grep -q '"com.stockapp"' || { echo "[preview] ✗ APK 설정의 패키지가 com.stockapp 이 아님" >&2; exit 1; }

echo "[preview] ✓ $APK"
echo "[preview] 설치: adb install -r \"$APK\"  ·  OTA: npm run ota:preview -- \"메시지\""
echo "[preview] 개발 APK 를 다시 만들기 전에: npm run prebuild:dev:android"

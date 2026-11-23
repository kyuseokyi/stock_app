#!/usr/bin/env bash
# 스토어 제출용 Android AAB 를 이 컴퓨터에서 Gradle 로 직접 빌드(상용 com.stocknote, OTA production 채널).
#
# build-store-android.sh(eas build --local)와의 차이: eas 는 저장소를 임시 폴더에 복사하고 npm ci·Gradle 을 새로 해서
#   디스크를 많이 쓴다(2026-11-23 여유 6GB 로도 ENOSPC). 여기서는 작업 폴더의 android/ 를 상용으로 prebuild 해서
#   preview APK 처럼 바로 빌드한다 — 이미 받은 Gradle 캐시·node_modules 를 그대로 쓴다.
#   지문은 fingerprint.config.js(라이브러리 매니페스트 제외) 덕분에 EAS 빌드·OTA 와 같은 값이 나온다.
#
# 준비(한 번): 업로드 키(EAS 에 있는 것)를 내려받아 정보 파일을 만든다 — git·EAS 묶음 모두 제외되는 secrets/ 아래.
#   npx eas-cli credentials -p android → production → Keystore → Download existing keystore
#   mobile/secrets/upload-keystore.properties (값은 따옴표 없이, 경로는 절대 경로):
#     storeFile=/Users/<나>/FunNote-keys/<내려받은 파일>.jks
#     storePassword=…
#     keyAlias=…
#     keyPassword=…
#
# versionCode: EAS 서버 값(appVersionSource: remote)+1 을 쓴다(STORE_VERSION_CODE 로 직접 지정 가능).
#   빌드 뒤 서버 값도 같은 번호로 올려야 다음 EAS 빌드와 번호가 겹치지 않는다(터미널이면 입력 창을 띄운다).
# ABI: Play 는 64비트 필수. 기본 armeabi-v7a,arm64-v8a(STORE_ABIS 로 바꿈, 에뮬레이터·크롬북까지면 x86_64 추가).
#
# 사용: npm run build:android:aab
# 결과: build/store/stockapp-prod-aab-<YYYYMMDD-HHmm>-v<versionCode>-<지문7>.aab
# 끝나면 android/ 는 상용으로 prebuild 된 상태 — 개발 APK 전에 npm run prebuild:dev:android.
set -euo pipefail
cd "$(dirname "$0")/.."

TAG=aab
fail() { echo "[$TAG] ✗ $*" >&2; exit 1; }
ENV_FILE=.env.production
KEYPROPS=secrets/upload-keystore.properties

[ -f "$ENV_FILE" ] || fail "$ENV_FILE 없음"
[ ! -e .env.production.local ] || fail ".env.production.local 이 있음 — 상용 주소를 덮어쓰므로 옮기거나 지운 뒤 다시"
[ -f secrets/google-services.json ] || fail "secrets/google-services.json 없음"
grep -q '"com.stocknote"' secrets/google-services.json || fail "google-services.json 에 com.stocknote 앱이 없음"
BAD=$(grep -E '^EXPO_PUBLIC_[A-Z_]*_URL=' "$ENV_FILE" | grep -vE '=https://[a-z0-9.-]*funnotedaily\.com' | cut -d= -f1 || true)
[ -z "$BAD" ] || fail "$ENV_FILE 의 주소가 상용(https://*.funnotedaily.com)이 아님: $BAD"

[ -f "$KEYPROPS" ] || fail "$KEYPROPS 없음 — 스크립트 맨 위 '준비' 참고(업로드 키 없이 만든 AAB 는 Play 가 받지 않는다)"
prop() { { grep -E "^$1=" "$KEYPROPS" || true; } | head -1 | cut -d= -f2- | sed 's/\r$//'; }  # 없으면 빈 값(아래에서 안내)
KS_FILE=$(prop storeFile); KS_PASS=$(prop storePassword); KEY_ALIAS=$(prop keyAlias); KEY_PASS=$(prop keyPassword)
[ -n "$KS_FILE" ] && [ -n "$KS_PASS" ] && [ -n "$KEY_ALIAS" ] && [ -n "$KEY_PASS" ] || fail "$KEYPROPS 에 storeFile·storePassword·keyAlias·keyPassword 가 모두 있어야 함"
[ -f "$KS_FILE" ] || fail "키 파일이 없음: $KS_FILE"
KS_DIR=$(cd "$(dirname "$KS_FILE")" && pwd); REPO=$(cd .. && pwd)
case "$KS_DIR/" in "$REPO/"*) fail "키 파일이 저장소 안에 있음 — 저장소 밖(예: ~/FunNote-keys)으로 옮기세요(저장소는 공개)";; esac

if command -v eas >/dev/null 2>&1; then EAS=(eas); else EAS=(npx --yes eas-cli); fi
if [ -n "${STORE_VERSION_CODE:-}" ]; then
  VC="$STORE_VERSION_CODE"
else
  REMOTE=$("${EAS[@]}" build:version:get -p android -e production --json 2>/dev/null | grep -oE '"versionCode"[^0-9]*[0-9]+' | grep -oE '[0-9]+$' || true)
  [ -n "$REMOTE" ] || fail "EAS 서버 versionCode 를 읽지 못함 — STORE_VERSION_CODE=<번호> 로 지정해 다시"
  VC=$((REMOTE + 1))
fi
[[ "$VC" =~ ^[0-9]+$ ]] || fail "versionCode 가 숫자가 아님: $VC"
echo "[$TAG] versionCode: $VC"

# 상용·production 채널로 prebuild(EXPO_UPDATES_CHANNEL 을 비워 app.config.js 기본값 production 을 쓰게)
unset EXPO_UPDATES_CHANNEL
export APP_ENV=production
npx expo prebuild --platform android --clean
grep -qE "applicationId ['\"]com\.stocknote['\"]" android/app/build.gradle || fail "prebuild 결과가 com.stocknote 가 아님"
# android/ 는 매번 생성되는 git 제외 폴더라 여기서 versionCode 만 바꾼다(지문 입력 아님)
sed -i '' -E "s/versionCode [0-9]+/versionCode $VC/" android/app/build.gradle
grep -qE "versionCode $VC\b" android/app/build.gradle || fail "build.gradle 의 versionCode 를 바꾸지 못함"

ABIS="${STORE_ABIS:-armeabi-v7a,arm64-v8a}"
JVMARGS="${STORE_JVMARGS:--Xmx4096m -XX:MaxMetaspaceSize=1536m}"
echo "[$TAG] ABI: $ABIS"
(cd android && ./gradlew --stop >/dev/null 2>&1 || true)
# 서명 정보는 명령줄(-P)이 아니라 환경 변수(ORG_GRADLE_PROJECT_*)로 — 프로세스 목록에 비밀번호가 보이지 않게.
# .env.production 도 Gradle 환경으로 넘겨 빌드 중 app.config.js 평가가 같은 값을 보게(build-preview-apk.sh 와 같다).
(set -a; . "./$ENV_FILE"; set +a; cd android && env \
  "ORG_GRADLE_PROJECT_android.injected.signing.store.file=$KS_FILE" \
  "ORG_GRADLE_PROJECT_android.injected.signing.store.password=$KS_PASS" \
  "ORG_GRADLE_PROJECT_android.injected.signing.key.alias=$KEY_ALIAS" \
  "ORG_GRADLE_PROJECT_android.injected.signing.key.password=$KEY_PASS" \
  ./gradlew :app:createReleaseUpdatesResources --rerun bundleRelease \
  -PreactNativeArchitectures="$ABIS" "-Dorg.gradle.jvmargs=$JVMARGS")

SRC=$(ls -t android/app/build/outputs/bundle/release/*.aab 2>/dev/null | head -1 || true)
[ -n "$SRC" ] || fail "AAB 를 찾지 못함(android/app/build/outputs/bundle/release)"
# 업로드 키로 서명됐는지(debug 키면 Play 가 거부) — 인증서 소유자만 보고 값은 출력하지 않는다
jarsigner -verify "$SRC" >/dev/null 2>&1 || fail "AAB 서명 검증 실패"
# 파이프 grep -q 는 pipefail 에서 SIGPIPE 로 거짓이 될 수 있어(=debug 서명을 놓침) here-string 으로
CERT=$(keytool -printcert -jarfile "$SRC" 2>/dev/null || true)
if grep -q "CN=Android Debug" <<< "$CERT"; then fail "debug 키로 서명됨 — 업로드 키 설정 확인"; fi

mkdir -p build/store
OUT="build/store/stockapp-prod-aab-$(date '+%Y%m%d-%H%M')-v$VC.aab"
cp "$SRC" "$OUT"
OUT=$(bash scripts/check-store-aab.sh "$OUT" "$TAG")
echo "[$TAG] ✓ $OUT"

echo "[$TAG] EAS 서버 versionCode 를 $VC 로 맞춥니다(다음 EAS 빌드와 번호가 겹치지 않게)."
if [ -t 0 ]; then
  echo "[$TAG]   입력 창이 뜨면 $VC 를 입력하세요."
  "${EAS[@]}" build:version:set -p android -e production || echo "[$TAG] ⚠ 실패 — 직접 실행: npx eas-cli build:version:set -p android -e production → $VC" >&2
else
  echo "[$TAG] ⚠ 터미널이 아니라 입력 창을 띄울 수 없음 — 직접 실행: npx eas-cli build:version:set -p android -e production → $VC" >&2
fi
echo "[$TAG] 다음: Play Console > 테스트 > 비공개 테스트 > 새 버전 만들기 에 업로드 · 개발 APK 전에 npm run prebuild:dev:android"

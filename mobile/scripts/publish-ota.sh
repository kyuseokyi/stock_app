#!/usr/bin/env bash
# OTA(EAS Update) 발행 — 채널별로 빌드 때와 같은 env 로 `eas update` 를 실행한다.
#
# 왜 스크립트인가(함정 두 가지):
#  1) fingerprint: app.config.js 가 APP_ENV 에 따라 패키지명·스킴·채널 헤더를 바꾸므로 runtimeVersion(fingerprint)도 달라진다.
#     빌드 때와 다른 APP_ENV 로 발행하면 그 바이너리와 runtimeVersion 이 어긋나 오류 없이 전달되지 않는다.
#  2) 번들 env: `eas update` 는 production 모드로 export 해서 .env.production* 의 EXPO_PUBLIC_* 를 번들에 넣는다
#     (.env.<mode> 파일이 셸 env 보다 우선). 개발 채널에 그대로 발행하면 개발 앱이 운영 서버에 붙는다.
#     → dev 는 발행 동안만 개발 env(.env.development.local > .env.development)를 .env.production.local 로 옮기고 끝나면 지운다
#       (build-dev-apk.sh 와 같은 방식·안전장치).
#
# eas-cli 24+ 는 비대화형 실행에 --environment 가 필수 — 채널과 같은 이름의 EAS 환경을 넘긴다(그 환경에 등록된 변수가 없으면 번들 env 는 위 .env 파일 그대로).
# 채널: dev → development(APP_ENV=development) · preview → preview(APP_ENV=production, EXPO_UPDATES_CHANNEL=preview,
#       eas.json preview 프로필 env 와 같음) · prod → production(APP_ENV=production)
#
# 플랫폼: eas update 기본(--platform all)은 web 까지 export 하는데, web 정적 렌더링(서버에서 화면 그리기)은 Unistyles 테마 설정 전에
#   StyleSheet.create 가 돌아 실패한다(OTA 대상도 아님) → 앱 플랫폼만 하나씩 발행. OTA_PLATFORMS="android" 처럼 줄일 수 있다.
#
# 사용: npm run ota:dev -- "변경 요약"   (ota:preview / ota:prod 도 같음)
#       DRY_RUN=1 → 확인만 하고 eas 명령은 출력만(파일을 만들지 않음)  ·  YES=1 → 확인 질문 생략
# 값은 출력하지 않는다(키 이름만).
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  echo "사용: bash scripts/publish-ota.sh <dev|preview|prod> \"<메시지>\"" >&2
  exit 1
}

TARGET="${1:-}"
MESSAGE="${2:-}"
[ -n "$TARGET" ] || usage
if [ -z "${MESSAGE//[[:space:]]/}" ]; then
  echo "[ota] ✗ --message 가 필요합니다(무엇을 바꿨는지 한 줄)." >&2
  usage
fi

case "$TARGET" in
  dev) APP_ENV_VALUE=development; CHANNEL=development; UPDATES_CHANNEL=""; EAS_ENV=development ;;
  preview) APP_ENV_VALUE=production; CHANNEL=preview; UPDATES_CHANNEL=preview; EAS_ENV=preview ;;
  prod) APP_ENV_VALUE=production; CHANNEL=production; UPDATES_CHANNEL=""; EAS_ENV=production ;;
  *) echo "[ota] ✗ 알 수 없는 대상: $TARGET" >&2; usage ;;
esac

DRY_RUN="${DRY_RUN:-0}"
OTA_PLATFORMS="${OTA_PLATFORMS:-android ios}"
for p in $OTA_PLATFORMS; do
  case "$p" in
    android | ios) ;;
    *) echo "[ota] ✗ OTA_PLATFORMS 에는 android·ios 만: $p" >&2; exit 1 ;;
  esac
done
TMP=.env.production.local
LOCALHOST_URL='^EXPO_PUBLIC_[A-Z_]*_URL=https?://(localhost|127\.0\.0\.1|10\.0\.2\.2)([:/]|$)'

# 대상과 상관없이 .env.production.local 이 이미 있으면 멈춘다:
#  - dev: 이 파일 이름으로 임시 env 를 만들어야 하므로 덮어쓰지 않는다.
#  - preview/prod: 남아 있으면(예: 중간에 죽은 dev 발행) 운영 OTA 에 개발 주소가 실린다.
if [ -e "$TMP" ]; then
  echo "[ota] ✗ $TMP 가 이미 있음 — 남은 임시 파일이거나 직접 만든 파일이면 옮긴 뒤 다시 실행하세요(덮어쓰지 않음)." >&2
  exit 1
fi

# 번들에 실릴 env 를 저장소 밖 임시 파일에 먼저 합친다(검사·키 목록용). 먼저 나온 키가 이긴다, 주석·빈 줄 제외.
MERGED="$(mktemp "${TMPDIR:-/tmp}/ota-env.XXXXXX")"
CREATED_TMP=0
cleanup() {
  rm -f "$MERGED"
  if [ "$CREATED_TMP" = 1 ]; then rm -f "$TMP"; fi
}
trap cleanup EXIT

if [ "$TARGET" = dev ]; then
  BASE=.env.development
  LOCAL=.env.development.local
  [ -f "$BASE" ] || { echo "[ota] ✗ $BASE 없음" >&2; exit 1; }
  SOURCES=("$BASE")
  [ -f "$LOCAL" ] && SOURCES=("$LOCAL" "$BASE")
  { echo "EXPO_PUBLIC_APP_ENV=development"; cat "${SOURCES[@]}"; } \
    | awk -F= '/^[A-Z_][A-Z0-9_]*=/ && !seen[$1]++' > "$MERGED"
  ENV_DESC="${SOURCES[*]} → $TMP(발행 동안만)"
else
  BASE=.env.production
  [ -f "$BASE" ] || { echo "[ota] ✗ $BASE 없음" >&2; exit 1; }
  awk -F= '/^[A-Z_][A-Z0-9_]*=/ && !seen[$1]++' "$BASE" > "$MERGED"
  ENV_DESC="$BASE"
fi

if ! grep -q '^EXPO_PUBLIC_APP_ENV=' "$MERGED"; then
  echo "[ota] ⚠ EXPO_PUBLIC_APP_ENV 없음 — 앱은 development 로 봅니다."
elif [ "$APP_ENV_VALUE" = production ] && ! grep -q '^EXPO_PUBLIC_APP_ENV=production$' "$MERGED"; then
  echo "[ota] ✗ $BASE 의 EXPO_PUBLIC_APP_ENV 가 production 이 아님 — 운영 앱에 다른 env 가 실립니다." >&2
  exit 1
fi

# OTA 는 다른 기기에서 받는다 — localhost 주소는 그 기기 자신이라 접속 불가
if grep -qE "$LOCALHOST_URL" "$MERGED"; then
  echo "[ota] ✗ 아래 주소가 localhost 라 다른 기기에서 접속할 수 없습니다:" >&2
  grep -E "$LOCALHOST_URL" "$MERGED" | cut -d= -f1 | sed 's/^/  - /' >&2
  [ "$TARGET" = dev ] && echo "  → .env.development.local 에 개발 서버 주소를 넣으세요." >&2
  exit 1
fi

echo "[ota] 대상 채널: $CHANNEL"
echo "[ota] APP_ENV=$APP_ENV_VALUE${UPDATES_CHANNEL:+ EXPO_UPDATES_CHANNEL=$UPDATES_CHANNEL}"
echo "[ota] 번들 env: $ENV_DESC"
echo "[ota] API 주소 키: $(grep -oE '^EXPO_PUBLIC_[A-Z_]*_URL' "$MERGED" | tr '\n' ' ')"
echo "[ota] 전체 키: $(cut -d= -f1 "$MERGED" | tr '\n' ' ')"
echo "[ota] 플랫폼: $OTA_PLATFORMS"
echo "[ota] 메시지: $MESSAGE"

if [ "$DRY_RUN" != 1 ] && [ "${YES:-0}" != 1 ]; then
  printf '[ota] 이 채널로 발행할까요? [y/N] '
  ans=""
  read -r ans || ans=""
  case "$ans" in
    y | Y | yes) ;;
    *) echo "[ota] 취소했습니다."; exit 1 ;;
  esac
fi

ENV_ARGS=(APP_ENV="$APP_ENV_VALUE")
[ -n "$UPDATES_CHANNEL" ] && ENV_ARGS+=(EXPO_UPDATES_CHANNEL="$UPDATES_CHANNEL")

if [ "$DRY_RUN" = 1 ]; then
  [ "$TARGET" = dev ] && echo "[ota] (DRY_RUN) $TMP 생성·적용 후 삭제 — 실제로는 만들지 않음"
  for p in $OTA_PLATFORMS; do
    echo "[ota] (DRY_RUN) env ${ENV_ARGS[*]} eas update --channel $CHANNEL --environment $EAS_ENV --platform $p --message \"$MESSAGE\""
  done
  exit 0
fi

if command -v eas >/dev/null 2>&1; then
  EAS=(eas)
else
  EAS=(npx --yes eas-cli)
fi

if [ "$TARGET" = dev ]; then
  cp "$MERGED" "$TMP"
  CREATED_TMP=1
  # build-dev-apk.sh 처럼 합친 env 를 프로세스 env 로도 넘긴다 — app.config.js 평가(EAS_PROJECT_ID·GOOGLE_SERVICES_JSON 등)가
  #   빌드 때와 같아야 fingerprint 가 같다.
  for p in $OTA_PLATFORMS; do
    (set -a; . "./$TMP"; set +a; env "${ENV_ARGS[@]}" "${EAS[@]}" update --channel "$CHANNEL" --environment "$EAS_ENV" --platform "$p" --message "$MESSAGE")
  done
else
  for p in $OTA_PLATFORMS; do
    env "${ENV_ARGS[@]}" "${EAS[@]}" update --channel "$CHANNEL" --environment "$EAS_ENV" --platform "$p" --message "$MESSAGE"
  done
fi

echo "[ota] ✓ $CHANNEL 채널 발행 완료"

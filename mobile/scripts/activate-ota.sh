#!/usr/bin/env bash
# 예약 OTA 활성화 — publish-ota.sh 를 OTA_STAGE=1 로 실행해 `<채널>-staged` 브랜치에 올려 둔 업데이트를
#   채널로 재발행(eas update:republish)한다. CodePush 의 `patch --disabled false` 에 해당.
#
# 재발행은 다시 빌드하지 않고 올려 둔 번들·runtimeVersion 을 그대로 복사한다 → env·fingerprint 는 예약 발행 때 이미 맞춰졌다.
# eas-cli 는 비대화형 재발행에 --group 이 필수 → 그룹 ID 를 주지 않으면 update:list 로 플랫폼별 최신 그룹을 찾아 넘긴다.
#
# 사용: npm run ota:dev:activate                     → development-staged 의 플랫폼별 최신 업데이트를 활성화
#       npm run ota:dev:activate -- <그룹ID> [그룹ID…] → 지정한 업데이트 그룹만(eas 출력의 "Update group ID")
#       OTA_PLATFORMS="android"  → 그룹 ID 를 주지 않을 때 찾을 플랫폼(기본 android ios)
#       OTA_ROLLOUT=20           → 사용자 20% 에게만(나머지는 직전 업데이트 유지)
#       DRY_RUN=1 → 찾기·확인만 하고 eas 재발행 명령은 출력만  ·  YES=1 → 확인 질문 생략
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  echo "사용: bash scripts/activate-ota.sh <dev|preview|prod> [업데이트 그룹 ID …]" >&2
  exit 1
}

TARGET="${1:-}"
[ -n "$TARGET" ] || usage
shift

case "$TARGET" in
  dev) CHANNEL=development ;;
  preview) CHANNEL=preview ;;
  prod) CHANNEL=production ;;
  *) echo "[ota] ✗ 알 수 없는 대상: $TARGET" >&2; usage ;;
esac
STAGED_BRANCH="$CHANNEL-staged"

DRY_RUN="${DRY_RUN:-0}"
OTA_PLATFORMS="${OTA_PLATFORMS:-android ios}"
for p in $OTA_PLATFORMS; do
  case "$p" in
    android | ios) ;;
    *) echo "[ota] ✗ OTA_PLATFORMS 에는 android·ios 만: $p" >&2; exit 1 ;;
  esac
done

ROLLOUT_ARGS=()
if [ -n "${OTA_ROLLOUT:-}" ]; then
  if ! [[ "$OTA_ROLLOUT" =~ ^[0-9]+$ ]] || [ "$OTA_ROLLOUT" -lt 1 ] || [ "$OTA_ROLLOUT" -gt 100 ]; then
    echo "[ota] ✗ OTA_ROLLOUT 은 1~100 정수: $OTA_ROLLOUT" >&2
    exit 1
  fi
  ROLLOUT_ARGS=(--rollout-percentage "$OTA_ROLLOUT")
fi

if command -v eas >/dev/null 2>&1; then
  EAS=(eas)
else
  EAS=(npx --yes eas-cli)
fi

# 활성화할 목록: "플랫폼<TAB>그룹<TAB>runtimeVersion<TAB>메시지" 한 줄씩. 플랫폼 '-' = 그룹 ID 로 지정(그룹에 든 플랫폼 그대로)
PLAN=()
if [ "$#" -gt 0 ]; then
  for g in "$@"; do
    [[ "$g" =~ ^[0-9a-f-]{36}$ ]] || { echo "[ota] ✗ 그룹 ID 형식이 아님: $g" >&2; exit 1; }
    PLAN+=("-	$g	-	예약 업데이트 활성화")
  done
else
  ERR="$(mktemp "${TMPDIR:-/tmp}/ota-activate.XXXXXX")"
  trap 'rm -f "$ERR"' EXIT
  if ! LIST_JSON="$("${EAS[@]}" update:list --branch "$STAGED_BRANCH" --json --non-interactive --limit 50 2>"$ERR")"; then
    echo "[ota] ✗ $STAGED_BRANCH 브랜치 목록을 못 읽음 — 예약 발행(OTA_STAGE=1 npm run ota:$TARGET -- \"메시지\")을 먼저 했는지 확인하세요." >&2
    grep -v '^[[:space:]]*$' "$ERR" | tail -3 >&2 || true
    exit 1
  fi
  # 플랫폼마다 가장 최근 그룹 하나(목록은 최신순). 메시지는 '"원문" (N minutes ago by …)' 형식이라 원문만 꺼낸다
  while IFS= read -r line; do
    [ -n "$line" ] && PLAN+=("$line")
  done < <(printf '%s' "$LIST_JSON" | node -e '
    const platforms = process.argv[1].split(/\s+/).filter(Boolean);
    let raw = "";
    process.stdin.on("data", (c) => (raw += c)).on("end", () => {
      const page = JSON.parse(raw).currentPage || [];
      for (const p of platforms) {
        const u = page.find((x) => String(x.platforms).split(/,\s*/).includes(p));
        if (!u) continue;
        const m = /^"([\s\S]*)" \(.*\)$/.exec(u.message || "");
        const msg = (m ? m[1] : u.message || "").replace(/[\t\n]/g, " ");
        console.log([p, u.group, u.runtimeVersion, msg].join("\t"));
      }
    });' "$OTA_PLATFORMS")
  if [ "${#PLAN[@]}" -eq 0 ]; then
    echo "[ota] ✗ $STAGED_BRANCH 에 $OTA_PLATFORMS 업데이트가 없습니다." >&2
    exit 1
  fi
fi

echo "[ota] 활성화: $STAGED_BRANCH → 채널 $CHANNEL${OTA_ROLLOUT:+ (사용자 ${OTA_ROLLOUT}%)}"
for row in "${PLAN[@]}"; do
  IFS=$'\t' read -r p g rv msg <<<"$row"
  echo "[ota]   - 플랫폼 $p · 그룹 $g · runtime $rv · \"$msg\""
done

if [ "$DRY_RUN" != 1 ] && [ "${YES:-0}" != 1 ]; then
  printf '[ota] 이 업데이트를 활성화할까요? [y/N] '
  ans=""
  read -r ans || ans=""
  case "$ans" in
    y | Y | yes) ;;
    *) echo "[ota] 취소했습니다."; exit 1 ;;
  esac
fi

for row in "${PLAN[@]}"; do
  IFS=$'\t' read -r p g rv msg <<<"$row"
  CMD=("${EAS[@]}" update:republish --group "$g" --destination-channel "$CHANNEL")
  [ "$p" != - ] && CMD+=(--platform "$p")
  [ "${#ROLLOUT_ARGS[@]}" -gt 0 ] && CMD+=("${ROLLOUT_ARGS[@]}")
  CMD+=(--message "예약 활성화: $msg" --non-interactive)
  if [ "$DRY_RUN" = 1 ]; then
    echo "[ota] (DRY_RUN) ${CMD[*]}"
  else
    "${CMD[@]}"
  fi
done

[ "$DRY_RUN" = 1 ] || echo "[ota] ✓ 채널 $CHANNEL 활성화 완료 — 앱이 다음 확인 때(새로 켤 때·복귀 후 1시간) 받습니다."

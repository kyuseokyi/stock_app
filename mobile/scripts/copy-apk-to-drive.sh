#!/usr/bin/env bash
# 빌드한 APK 를 Google Drive 데스크톱 앱의 동기화 폴더에 복사 → 드라이브 앱이 업로드한다(API 키·로그인 설정 없음).
# build-dev-apk.sh·build-preview-apk.sh 가 마지막에 부른다. 실패해도 빌드는 성공으로 둔다(경고만).
#
# 위치: <드라이브 루트>/FunNote APK/  — 드라이브 루트는 ~/Library/CloudStorage/GoogleDrive-*/(내 드라이브|My Drive) 중 첫 번째.
#   APK_DRIVE_DIR=<폴더>  저장 폴더 직접 지정(계정이 여러 개일 때 등)
#   APK_DRIVE=0           복사하지 않음
#
# 사용: bash scripts/copy-apk-to-drive.sh <apk 경로>
set -uo pipefail

APK="${1:-}"
[ "${APK_DRIVE:-1}" = "0" ] && { echo "[drive] 건너뜀(APK_DRIVE=0)"; exit 0; }
[ -f "$APK" ] || { echo "[drive] ⚠ APK 없음: $APK" >&2; exit 0; }

DEST="${APK_DRIVE_DIR:-}"
if [ -z "$DEST" ]; then
  for root in "$HOME"/Library/CloudStorage/GoogleDrive-*/"내 드라이브" "$HOME"/Library/CloudStorage/GoogleDrive-*/"My Drive"; do
    [ -d "$root" ] && { DEST="$root/FunNote APK"; break; }
  done
fi
if [ -z "$DEST" ]; then
  echo "[drive] ⚠ Google Drive 동기화 폴더를 찾지 못함 — Google Drive 데스크톱 앱 설치·로그인, 또는 APK_DRIVE_DIR 지정" >&2
  exit 0
fi

if mkdir -p "$DEST" && cp "$APK" "$DEST/"; then
  echo "[drive] ✓ $DEST/$(basename "$APK") — 드라이브 앱이 백그라운드로 업로드합니다"
else
  echo "[drive] ⚠ 복사 실패: $DEST" >&2
fi
exit 0

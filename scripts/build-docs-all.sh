#!/usr/bin/env bash
# docs/ 및 모든 하위 폴더의 Markdown 문서를 경로 제목과 함께 하나로 합쳐
# 리포 루트에 docs_all.md 를 생성한다(원본을 그대로 이어붙이므로 변형·누락 없음).
#
# 사용: bash scripts/build-docs-all.sh        # 어느 디렉터리에서 실행해도 됨
#       DOCS_DIR=docs OUT=docs_all.md 로 경로 override 가능
#
# 주의: 이 파일은 그 시점의 스냅샷이다. docs 가 바뀌면 다시 실행해 최신화한다.
set -euo pipefail

# 스크립트 위치 기준으로 리포 루트 계산(어디서 실행하든 동일 동작)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

DOCS_DIR="${DOCS_DIR:-docs}"
OUT="${OUT:-docs_all.md}"

if [ ! -d "$DOCS_DIR" ]; then
  echo "[build-docs-all] ✗ '$DOCS_DIR' 폴더가 없습니다 (리포 루트: $ROOT)" >&2
  exit 1
fi

# 대상 파일 목록(정렬) — 생성물 자신은 docs/ 밖이라 포함되지 않음
count="$(find "$DOCS_DIR" -type f -name '*.md' | wc -l | tr -d ' ')"
if [ "$count" -eq 0 ]; then
  echo "[build-docs-all] ✗ '$DOCS_DIR' 아래 .md 문서가 없습니다" >&2
  exit 1
fi

{
  echo "# 📚 docs 통합 문서 (docs_all.md)"
  echo
  echo "> 생성일: $(date +%Y-%m-%d) · \`$DOCS_DIR/\` 및 모든 하위 폴더의 Markdown 문서 ${count}개를 경로 제목과 함께 하나로 합친 파일입니다."
  echo "> 각 문서는 \`# 📄 <파일 경로>\` 제목 아래에 원본 그대로 수록됩니다. (스냅샷 — docs 변경 시 \`bash scripts/build-docs-all.sh\` 로 재생성)"
  echo
  echo "## 목차"
  echo
  i=0
  while IFS= read -r f; do i=$((i + 1)); echo "$i. \`$f\`"; done < <(find "$DOCS_DIR" -type f -name '*.md' | sort)
  while IFS= read -r f; do
    echo; echo "---"; echo
    echo "# 📄 \`$f\`"
    echo
    cat "$f"
    echo
  done < <(find "$DOCS_DIR" -type f -name '*.md' | sort)
} > "$OUT"

echo "[build-docs-all] ✓ $OUT 생성 완료 — ${count}개 문서, $(wc -l < "$OUT" | tr -d ' ')줄"

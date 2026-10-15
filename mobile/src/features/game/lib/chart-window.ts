// 게임 차트 좌우 이동 — 표시 구간 계산(순수 함수). offset = 오른쪽 끝(최신)에서 과거로 몇 봉 밀었는지.
// 지표는 받은 전체로 계산한 뒤 이 구간만 잘라 그려서 화면 왼쪽 끝에서 선이 다시 시작하지 않게 한다.

/** offset 을 0 ~ (전체 - visible) 로 제한 */
export function clampOffset(offset: number, total: number, visible: number): number {
  return Math.min(Math.max(0, offset), Math.max(0, total - visible));
}

/** 표시 구간 [start, end) */
export function windowRange(total: number, visible: number, offset: number): { start: number; end: number } {
  const end = total - clampOffset(offset, total, visible);
  return { start: Math.max(0, end - visible), end };
}

/** 드래그 dx(px, 오른쪽 +) → offset. 오른쪽으로 끌면 과거가 보인다. slot = 캔들 1개 폭 */
export function dragOffset(startOffset: number, dx: number, slot: number): number {
  if (slot <= 0) return startOffset;
  return startOffset + Math.round(dx / slot);
}

/** 캔들이 늘었을 때 offset — 최신(0)이면 따라가고, 과거를 보는 중이면 늘어난 만큼 밀어 화면을 고정 */
export function offsetAfterGrowth(offset: number, prevTotal: number, nextTotal: number): number {
  if (offset === 0 || nextTotal <= prevTotal) return offset;
  return offset + (nextTotal - prevTotal);
}

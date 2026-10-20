/**
 * 요청 번호 — 조건(기간·정렬·분류)을 빠르게 바꿀 때 늦게 도착한 옛 응답이 새 목록을 덮지 않게 한다.
 * 사용: const id = gate.next(); const r = await fetch(); if (!gate.isLatest(id)) return;
 */
export function createLatest() {
  let seq = 0;
  return {
    next(): number {
      seq += 1;
      return seq;
    },
    current(): number {
      return seq;
    },
    isLatest(id: number): boolean {
      return id === seq;
    },
  };
}

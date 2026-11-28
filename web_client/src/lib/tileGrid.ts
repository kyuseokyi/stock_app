// 작은 카드(타일) 격자 도우미 — 카드 개수가 그날 데이터에 따라 바뀌는 곳에서 빈칸·외톨이 카드를 막는다.
// Tailwind 는 소스의 글자 그대로를 찾아 CSS 를 만들므로, 클래스 이름은 조합하지 말고 아래처럼 통째로 적는다.

/** 휴대폰 2열에서 개수가 홀수면 마지막 카드가 줄 전체를 쓴다(sm 이상은 원래대로 한 칸) */
export const ODD_LAST_FULL = '[&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1'

const SM_COLS = ['sm:grid-cols-1', 'sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3', 'sm:grid-cols-4'] as const

/** sm 이상 열 수 = 카드 개수(최대 4) — 2개뿐인데 4열이면 줄 오른쪽 절반이 빈다 */
export function smColsFor(count: number): string {
  return SM_COLS[Math.max(0, Math.min(count, 4))]
}

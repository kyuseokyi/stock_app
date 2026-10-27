// 청산 버튼 문구 — 평가손익이 0 이상이면 익절, 음수면 손절(설계 2026-10-27 §6.1). 앱 close-action.ts 와 같은 코드.
// 사유 기록은 서버가 체결 가격으로 정한다(이 함수는 화면 표시만).
export type CloseKind = 'tp' | 'sl' | 'neutral'

export interface CloseAction {
  kind: CloseKind
  label: string
}

export function closeActionOf(pnl: number | null): CloseAction {
  if (pnl === null) return { kind: 'neutral', label: '청산하기' }
  return pnl >= 0 ? { kind: 'tp', label: '💰 익절하기' } : { kind: 'sl', label: '🛡️ 손절하기' }
}

/** 손익 버튼 글자색(Tailwind) — 손익 글자와 같은 상승·하락 색 */
export const closeActionClass = (kind: CloseKind): string => (kind === 'tp' ? 'text-up' : kind === 'sl' ? 'text-down' : '')

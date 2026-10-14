import type { Side } from '../types/game'

// 방향 표시 용어 — 화면에는 한국어(상승/하락)만 노출한다. API·DB 값(LONG/SHORT)은 그대로.

export type SideLabel = '상승' | '하락'

/** 'LONG' → '상승', 'SHORT' → '하락' */
export const sideLabel = (side: Side): SideLabel => (side === 'LONG' ? '상승' : '하락')

/** 방향 색 클래스(상승=핑크/up, 하락=블루/down) */
export const sideClass = (side: Side): string => (side === 'LONG' ? 'text-up' : 'text-down')

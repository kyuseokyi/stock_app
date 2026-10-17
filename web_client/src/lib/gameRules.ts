import type { GameRules } from '../types/game'

// 규칙 화면용 순수 포맷 함수 — 숫자는 모두 /rules 응답에서 받아 계산한다(문구 하드코딩 금지).

const MINUS = '−' // U+2212 (표시용 마이너스)

/** 소수 최대 2자리, 불필요한 0 제거: 0.03 → '0.03', 16 → '16', 26.666 → '26.67' */
export const trimNum = (n: number): string => String(Math.round(n * 100) / 100)

/** 0.03 → '0.03%' */
export const feeText = (feePct: number): string => `${trimNum(feePct)}%`

/** 진입 직후 수익률: 0.03 → '−0.03%' */
export const entryRoiText = (feePct: number): string => `${MINUS}${feeText(feePct)}`

/** -80 → '−80%' */
export const marginCallText = (roiPct: number): string => `${MINUS}${trimNum(Math.abs(roiPct))}%`

/** [["09:00","15:30"],["16:00","20:00"]] → '평일 09:00~15:30 · 16:00~20:00 (공휴일·대체공휴일·연말 휴장 제외)' — 서버 거래일 달력과 같은 기준 */
export const tradingWindowsText = (windows: [string, string][]): string =>
  `평일 ${windows.map(([s, e]) => `${s}~${e}`).join(' · ')} (공휴일·대체공휴일·연말 휴장 제외)`

/** 배율 L 에서 자동 청산까지의 주가 변동 % = |margin_call| / L (예: −80 / 2 = 40) */
export const liquidationMovePct = (marginCallRoiPct: number, leverage: number): number =>
  Math.abs(marginCallRoiPct) / leverage

/** '1배 약 −80% · 2배 −40% · 5배 −16%' */
export function liquidationMovesText(rules: Pick<GameRules, 'leverages' | 'margin_call_roi_pct'>): string {
  return rules.leverages
    .map((l, i) => `${l}배 ${i === 0 ? '약 ' : ''}${MINUS}${trimNum(liquidationMovePct(rules.margin_call_roi_pct, l))}%`)
    .join(' · ')
}

/** 해금 조건 코드 → 문구 */
const UNLOCK_LABEL: Record<string, string> = { academy: '아카데미 통과 후' }

/** {"5":"academy"} → [{ leverage: 5, label: '아카데미 통과 후' }] */
export function leverageUnlockList(unlock: Record<string, string>): { leverage: number; label: string }[] {
  return Object.entries(unlock)
    .map(([lev, cond]) => ({ leverage: Number(lev), label: UNLOCK_LABEL[cond] ?? '조건 충족 후' }))
    .filter((x) => Number.isFinite(x.leverage))
    .sort((a, b) => a.leverage - b.leverage)
}

/** 예시 표: 주가가 movePct% 움직였을 때 배율별 손익 % (수수료 제외) */
export const leverageExample = (leverages: number[], movePct = 1): { leverage: number; roiPct: number }[] =>
  leverages.map((leverage) => ({ leverage, roiPct: movePct * leverage }))

/** 부호 포함 %: 2 → '+2%', -5 → '−5%' */
export const signedPct = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? MINUS : ''}${trimNum(Math.abs(n))}%`

/** 연속 출석 보상 키 정렬: {"7":..,"3":..} → [[3, n], [7, n]] */
export const streakMilestones = (streak: Record<string, number>): [number, number][] =>
  Object.entries(streak)
    .map(([d, amt]) => [Number(d), amt] as [number, number])
    .filter(([d, amt]) => Number.isFinite(d) && Number.isFinite(amt))
    .sort((a, b) => a[0] - b[0])

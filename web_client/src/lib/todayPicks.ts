// '오늘 볼 10개' 고르기(순수 함수) — 주도주 점수와 차트 패턴을 겹친다.
// 고정 기준(예: 70점 + 피벗 ±5%)은 하락장에서 0개가 되어(2026-10-22 실측) 넉넉한 후보 안에서 순위로 고른다.
import type { CanslimItem } from '../types/screener'
import type { PatternItem } from '../types/patterns'

export const PICK_COUNT = 10
export const PICK_MIN_SCORE = 50
export const PICK_PIVOT_MIN = -15 // 피벗까지 거리 % — 아래로 15%까지(베이스 안쪽)
export const PICK_PIVOT_MAX = 5 // 위로 5%까지(막 돌파해 아직 매수 구간)

export interface TodayPick {
  ticker: string
  name: string
  score: number
  close: number
  pattern: PatternItem
}

/** 점수 높은 순 → 같으면 피벗에 가까운 순. 종목에 패턴이 여럿이면 피벗에 가장 가까운 것 하나. */
export function pickToday(canslim: CanslimItem[], patterns: PatternItem[], n = PICK_COUNT): TodayPick[] {
  const nearest = new Map<string, PatternItem>()
  for (const p of patterns) {
    const d = p.pivotDistPct
    if (!p.isActive || d === null || d < PICK_PIVOT_MIN || d > PICK_PIVOT_MAX) continue
    const cur = nearest.get(p.ticker)
    if (!cur || Math.abs(d) < Math.abs(cur.pivotDistPct ?? Infinity)) nearest.set(p.ticker, p)
  }
  const picks: TodayPick[] = []
  for (const c of canslim) {
    const pattern = nearest.get(c.ticker)
    if (c.score >= PICK_MIN_SCORE && pattern) picks.push({ ticker: c.ticker, name: c.name, score: c.score, close: c.close, pattern })
  }
  picks.sort(
    (a, b) =>
      b.score - a.score ||
      Math.abs(a.pattern.pivotDistPct ?? 0) - Math.abs(b.pattern.pivotDistPct ?? 0) ||
      a.ticker.localeCompare(b.ticker),
  )
  return picks.slice(0, n)
}

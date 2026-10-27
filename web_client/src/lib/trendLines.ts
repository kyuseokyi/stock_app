// 차트 게임 지지·저항 추세선 — 스윙 고점·저점 2개를 잇는 사선(설계 2026-10-27 chart-game-sr-trendlines §2).
// 앱 features/game/lib/trend-lines.ts 와 같은 코드.
export const TREND_PIVOT = 3
export const TREND_LOOKBACK = 120

export interface TrendLine {
  i1: number
  p1: number
  i2: number
  p2: number
}

export interface TrendBar {
  high: number
  low: number
}

export interface TrendOptions {
  pivot?: number
  lookback?: number
}

/** i 번 캔들 위치의 선 값(연장 포함) */
export function valueAt(line: TrendLine, i: number): number {
  return line.p1 + ((line.p2 - line.p1) * (i - line.i1)) / (line.i2 - line.i1)
}

/** 마지막 lookback 개 안에서, 앞뒤 pivot 개 이상(같으면 나중 것)인 극점 순번들 */
function swings(bars: TrendBar[], start: number, pivot: number, pick: (b: TrendBar) => number, high: boolean): number[] {
  const out: number[] = []
  for (let i = start + pivot; i <= bars.length - 1 - pivot; i++) {
    const v = pick(bars[i])
    let ok = true
    for (let k = 1; k <= pivot && ok; k++) {
      const l = pick(bars[i - k])
      const r = pick(bars[i + k])
      // 왼쪽은 크거나 같음(≥), 오른쪽은 엄격히 큼 → 같은 값이 이어지면 나중 것만 남는다
      ok = high ? v >= l && v > r : v <= l && v < r
    }
    if (ok) out.push(i)
  }
  return out
}

function lineOf(bars: TrendBar[], idx: number[], pick: (b: TrendBar) => number): TrendLine | null {
  if (idx.length < 2) return null
  const i1 = idx[idx.length - 2]
  const i2 = idx[idx.length - 1]
  return { i1, p1: pick(bars[i1]), i2, p2: pick(bars[i2]) }
}

export function trendLines(
  bars: TrendBar[],
  opts: TrendOptions = {},
): { resistance: TrendLine | null; support: TrendLine | null } {
  const pivot = opts.pivot ?? TREND_PIVOT
  const lookback = opts.lookback ?? TREND_LOOKBACK
  const start = Math.max(0, bars.length - lookback)
  const hi = (b: TrendBar) => b.high
  const lo = (b: TrendBar) => b.low
  return {
    resistance: lineOf(bars, swings(bars, start, pivot, hi, true), hi),
    support: lineOf(bars, swings(bars, start, pivot, lo, false), lo),
  }
}

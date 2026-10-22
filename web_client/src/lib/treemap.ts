// 트리맵 배치(squarified) + 등락률 색 — 순수 함수. 컴포넌트는 크기만 재서 넘긴다.
// squarified: 큰 것부터 짧은 변을 따라 한 줄씩 채우고, 하나 더 넣었을 때 가장 길쭉한 타일이 더 나빠지면 줄을 바꾼다.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Placed extends Rect {
  id: string
}

interface Item {
  id: string
  size: number
}

/** 한 줄의 가장 나쁜 가로세로 비율 — 짧은 변 길이 side */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0)
  const max = Math.max(...areas)
  const min = Math.min(...areas)
  const s2 = side * side
  const sum2 = sum * sum
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min))
}

/** 줄 하나를 rect 의 짧은 변을 따라 배치하고 남은 사각형을 돌려준다 */
function layoutRow(row: { id: string; area: number }[], rect: Rect, out: Placed[]): Rect {
  const sum = row.reduce((a, r) => a + r.area, 0)
  if (rect.w >= rect.h) {
    // 세로 줄(왼쪽에 쌓기)
    const colW = rect.h > 0 ? sum / rect.h : 0
    let y = rect.y
    for (const r of row) {
      const h = colW > 0 ? r.area / colW : 0
      out.push({ id: r.id, x: rect.x, y, w: colW, h })
      y += h
    }
    return { x: rect.x + colW, y: rect.y, w: rect.w - colW, h: rect.h }
  }
  // 가로 줄(위에 쌓기)
  const rowH = rect.w > 0 ? sum / rect.w : 0
  let x = rect.x
  for (const r of row) {
    const w = rowH > 0 ? r.area / rowH : 0
    out.push({ id: r.id, x, y: rect.y, w, h: rowH })
    x += w
  }
  return { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH }
}

/** 크기 비례 타일 좌표. size ≤ 0 은 빠진다. 결과는 큰 순서. */
export function squarify(items: Item[], rect: Rect): Placed[] {
  const valid = items.filter((i) => i.size > 0).sort((a, b) => b.size - a.size)
  const total = valid.reduce((a, i) => a + i.size, 0)
  const area = rect.w * rect.h
  if (!valid.length || total <= 0 || area <= 0) return []
  const scaled = valid.map((i) => ({ id: i.id, area: (i.size / total) * area }))
  const out: Placed[] = []
  let remaining = rect
  let row: { id: string; area: number }[] = []
  for (const item of scaled) {
    const side = Math.min(remaining.w, remaining.h)
    const next = [...row, item]
    if (row.length === 0 || worst(next.map((r) => r.area), side) <= worst(row.map((r) => r.area), side)) {
      row = next
    } else {
      remaining = layoutRow(row, remaining, out)
      row = [item]
    }
  }
  if (row.length) layoutRow(row, remaining, out)
  return out
}

// 등락률 색 — 기간별 상한에서 가장 진하다(1일 ±5%, 5일 ±10%, 20일 ±20%). 상승 빨강·하락 파랑(앱 공통 규칙, tailwind up/down 토큰).
const CAP: Record<string, number> = { '1d': 5, '5d': 10, '20d': 20 }
const UP = ['#fbd6e4', '#f0aec7', '#e384a8', '#de6491', '#b6265d']
const DOWN = ['#d8e3fd', '#b3c5f5', '#8fa8ec', '#6c8ce2', '#3c5dc1']
const FLAT = '#efebfb'

function step(chg: number, period: string): number {
  const cap = CAP[period] ?? 5
  return Math.min(UP.length - 1, Math.floor((Math.min(Math.abs(chg), cap) / cap) * UP.length - 1e-9))
}

export function chgColor(chg: number | null | undefined, period: string): string {
  if (chg == null || Math.abs(chg) < 0.05) return FLAT
  return chg > 0 ? UP[step(chg, period)] : DOWN[step(chg, period)]
}

/** 가장 진한 칸(마지막 단계)만 흰 글씨, 나머지는 본문색(ink) — 각 칸에서 4.5:1 이상이 되는 쪽(3단계는 ink 기준으로 색을 맞춤) */
export function chgTextColor(chg: number | null | undefined, period: string): string {
  if (chg == null || Math.abs(chg) < 0.05) return '#25223a'
  return step(chg, period) >= UP.length - 1 ? '#ffffff' : '#25223a'
}

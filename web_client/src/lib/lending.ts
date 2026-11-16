import type { LendingBar, LendingPoint, LendingView } from '../types/lending'

// 대차잔고 섹션 순수 함수 — 응답 정규화·숨김 조건·미니 차트 좌표(모바일 features/leaders/lending.ts 와 같은 규칙).

/** 섹션 설명 한 줄(설계 문구 그대로) */
export const LENDING_NOTE = '대차잔고는 빌려 간 주식 수예요. 줄어들면 공매도 물량이 상환되는 중일 수 있어요(참고용).'
/** 요청 행 수(거래일) */
export const LENDING_DAYS = 120

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function int(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/** 응답 → 날짜 오름차순·날짜당 1행. 배열이 아니거나 필드가 틀린 행은 버린다 */
export function normalizeLending(raw: unknown): LendingPoint[] {
  if (!Array.isArray(raw)) return []
  const byDate = new Map<string, LendingPoint>()
  for (const r of raw) {
    if (!isObj(r) || typeof r.date !== 'string' || !DATE_RE.test(r.date)) continue
    const balanceQty = int(r.balance_qty)
    const netQty = int(r.net_qty)
    const balanceAmt = int(r.balance_amt)
    if (balanceQty === null || netQty === null || balanceAmt === null) continue
    byDate.set(r.date, { date: r.date, balanceQty, netQty, balanceAmt })
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * 미니 차트 좌표 — 위 62%는 잔고 선, 아래는 일별 증감 막대(0 기준선 위=증가, 아래=감소).
 * 2점 미만이거나 잔고가 전부 0이면 null(섹션 숨김).
 */
export function lendingView(points: LendingPoint[], width = 240, height = 64): LendingView | null {
  if (points.length < 2 || points.every((p) => p.balanceQty === 0)) return null
  const n = points.length
  const slot = width / n
  const cx = (i: number) => (i + 0.5) * slot
  const lineH = height * 0.62
  const barTop = lineH + 4
  const barH = height - barTop

  const qs = points.map((p) => p.balanceQty)
  const qMin = Math.min(...qs)
  const qMax = Math.max(...qs)
  const span = qMax - qMin
  const ly = (q: number) => (span === 0 ? lineH / 2 : 2 + (1 - (q - qMin) / span) * (lineH - 4))
  const line = points.map((p, i) => `${r1(cx(i))},${r1(ly(p.balanceQty))}`).join(' ')

  const pos = Math.max(0, ...points.map((p) => p.netQty))
  const neg = Math.max(0, ...points.map((p) => -p.netQty))
  const total = pos + neg
  const zeroY = total === 0 ? height : barTop + (barH * pos) / total
  const unit = total === 0 ? 0 : barH / total
  const bw = Math.max(0.5, slot * 0.7)
  const bars: LendingBar[] = points.map((p, i) => {
    const up = p.netQty >= 0
    const h = Math.abs(p.netQty) * unit
    return { x: r1(cx(i) - bw / 2), y: r1(up ? zeroY - h : zeroY), w: r1(bw), h: r1(h), up }
  })

  const first = points[0]
  const last = points[n - 1]
  const chgPct = first.balanceQty > 0 ? ((last.balanceQty - first.balanceQty) / first.balanceQty) * 100 : null
  return { first, last, chgPct, line, bars, zeroY: r1(zeroY), width, height }
}

/** 주 수 표기 — 1억 이상은 '억 주', 1만 이상은 '만 주'(소수 한 자리), 그 밖은 그대로 */
export function formatShares(n: number): string {
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  if (a >= 1e8) return `${sign}${(Math.round(a / 1e7) / 10).toLocaleString('ko-KR')}억 주`
  if (a >= 1e4) return `${sign}${(Math.round(a / 1e3) / 10).toLocaleString('ko-KR')}만 주`
  return `${sign}${a.toLocaleString('ko-KR')}주`
}

import { describe, expect, it } from 'vitest'
import { formatShares, lendingView, normalizeLending } from './lending'

const row = (date: string, balance_qty: unknown, net_qty: unknown = 0, balance_amt: unknown = 0) => ({
  date, balance_qty, net_qty, balance_amt,
})

describe('normalizeLending', () => {
  it('오래된 순·날짜당 1행, 잘못된 행은 버린다', () => {
    const out = normalizeLending([
      row('2026-11-13', 98242435, -1482754, 5452455000000),
      row('2026-11-12', '99725189', '-520696', '5564666000000'),
      row('2026-11-12', 1, 1, 1), // 같은 날짜는 뒤 행
      row('20261111', 1),
      row('2026-11-10', null),
      'x',
      null,
    ])
    expect(out).toEqual([
      { date: '2026-11-12', balanceQty: 1, netQty: 1, balanceAmt: 1 },
      { date: '2026-11-13', balanceQty: 98242435, netQty: -1482754, balanceAmt: 5452455000000 },
    ])
  })

  it('배열이 아니면 빈 목록', () => {
    expect(normalizeLending(null)).toEqual([])
    expect(normalizeLending({ items: [] })).toEqual([])
  })
})

describe('lendingView (섹션 숨김 조건·좌표)', () => {
  const p = (date: string, balanceQty: number, netQty = 0) => ({ date, balanceQty, netQty, balanceAmt: 0 })

  it('데이터 없음·1점·잔고 전부 0이면 null(숨김)', () => {
    expect(lendingView([])).toBeNull()
    expect(lendingView([p('2026-11-13', 100)])).toBeNull()
    expect(lendingView([p('2026-11-12', 0), p('2026-11-13', 0)])).toBeNull()
  })

  it('잔고 선·증감 막대·증감률', () => {
    const v = lendingView([p('2026-11-12', 1000, 200), p('2026-11-13', 800, -200)], 240, 64)!
    expect(v.chgPct).toBeCloseTo(-20)
    expect(v.line.split(' ')).toHaveLength(2)
    const [x0, y0] = v.line.split(' ')[0].split(',').map(Number)
    const [, y1] = v.line.split(' ')[1].split(',').map(Number)
    expect(x0).toBe(60) // 첫 칸 가운데
    expect(y0).toBeLessThan(y1) // 잔고가 줄면 선이 내려간다
    expect(v.bars.map((b) => b.up)).toEqual([true, false])
    expect(v.bars[0].y + v.bars[0].h).toBeCloseTo(v.zeroY, 0) // 증가 막대는 0선 위
    expect(v.bars[1].y).toBeCloseTo(v.zeroY, 0) // 감소 막대는 0선 아래
    expect(v.bars.every((b) => b.y >= 0 && b.y + b.h <= 64.1)).toBe(true)
  })

  it('첫날 잔고 0이면 증감률 null, 증감이 모두 0이면 막대 높이 0', () => {
    const v = lendingView([p('2026-11-12', 0), p('2026-11-13', 10)])!
    expect(v.chgPct).toBeNull()
    expect(v.bars.every((b) => b.h === 0)).toBe(true)
  })
})

describe('formatShares', () => {
  it('억·만 단위', () => {
    expect(formatShares(98242435)).toBe('9,824.2만 주')
    expect(formatShares(123456789)).toBe('1.2억 주')
    expect(formatShares(-1482754)).toBe('-148.3만 주')
    expect(formatShares(950)).toBe('950주')
  })
})

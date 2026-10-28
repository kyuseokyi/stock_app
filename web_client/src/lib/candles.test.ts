import { describe, test, it, expect } from 'vitest'
import { mergeTick, withSessionBar } from './candles'
import type { DailyCandle } from '../types/game'

const c = (date: string, o: number, h: number, l: number, cl: number): DailyCandle => ({
  date,
  open: o,
  high: h,
  low: l,
  close: cl,
})

describe('mergeTick', () => {
  test('마지막 캔들 없음 → 오늘 캔들 신규(OHLC 모두 price)', () => {
    expect(mergeTick(null, '2026-10-13', 100)).toEqual(c('2026-10-13', 100, 100, 100, 100))
  })
  test('오늘 캔들에 병합 — 고가/저가 확장, 종가 갱신, 원본 불변', () => {
    const last = c('2026-10-13', 100, 105, 95, 101)
    expect(mergeTick(last, '2026-10-13', 110)).toEqual(c('2026-10-13', 100, 110, 95, 110))
    expect(mergeTick(last, '2026-10-13', 90)).toEqual(c('2026-10-13', 100, 105, 90, 90))
    expect(last).toEqual(c('2026-10-13', 100, 105, 95, 101))
  })
  test('마지막 캔들이 과거 → 오늘 캔들 신규', () => {
    expect(mergeTick(c('2026-10-12', 1, 2, 1, 2), '2026-10-13', 50)).toEqual(c('2026-10-13', 50, 50, 50, 50))
  })
  test('시계 오차로 마지막 캔들이 더 최신 → 그 캔들에 병합(날짜 유지)', () => {
    expect(mergeTick(c('2026-10-14', 100, 100, 100, 100), '2026-10-13', 120)).toEqual(
      c('2026-10-14', 100, 120, 100, 120),
    )
  })
})


describe('withSessionBar', () => {
  const rows = [c('2026-10-15', 1, 2, 1, 2), c('2026-10-16', 2, 3, 1, 2)]

  it('마지막 일봉보다 나중 날짜면 뒤에 붙인다(원본 불변)', () => {
    const bar = c('2026-10-17', 2, 5, 1, 4)
    const out = withSessionBar(rows, bar)
    expect(out).toEqual([...rows, bar])
    expect(rows).toHaveLength(2)
  })

  it('같은 날짜 일봉이 이미 있으면(수집 완료) 일봉 그대로', () => {
    expect(withSessionBar(rows, c('2026-10-16', 9, 9, 9, 9))).toBe(rows)
  })

  it('이전 날짜·없음·빈 일봉·비정상 값이면 그대로', () => {
    expect(withSessionBar(rows, c('2026-10-14', 1, 1, 1, 1))).toBe(rows)
    expect(withSessionBar(rows, null)).toBe(rows)
    expect(withSessionBar([], c('2026-10-17', 1, 1, 1, 1))).toEqual([])
    expect(withSessionBar(rows, c('2026-10-17', NaN, 1, 1, 1))).toBe(rows)
  })

  it('붙인 오늘 봉에 틱이 이어서 병합된다', () => {
    // 웹엔 applyTick 이 없어 마지막 봉에 mergeTick 을 직접 적용
    const out = withSessionBar(rows, c('2026-10-17', 2, 5, 1, 4))
    expect(out).toHaveLength(3)
    expect(mergeTick(out[out.length - 1], '2026-10-17', 6)).toEqual(c('2026-10-17', 2, 6, 1, 6))
  })
})

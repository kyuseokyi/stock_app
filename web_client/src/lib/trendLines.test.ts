import { describe, test, expect } from 'vitest'
import { horizontalLevels, nearestSwings, TREND_LOOKBACK, TREND_PIVOT } from './trendLines'

// high 배열로 봉 만들기(low 는 high - 1)
const barsOf = (highs: number[], lows?: number[]) =>
  highs.map((h, i) => ({ high: h, low: lows ? lows[i] : h - 1 }))

describe('horizontalLevels', () => {
  test('상수', () => {
    expect(TREND_PIVOT).toBe(3)
    expect(TREND_LOOKBACK).toBe(120)
  })

  // 스윙 고점: 3번(high 10)·9번(high 12) / 스윙 저점은 low = high-1 이라 같은 순번에서 아래쪽(low 9·11)은 고점 쪽이 아님
  const highs = [1, 2, 3, 10, 3, 2, 1, 2, 3, 12, 3, 2, 1, 1, 1, 1]

  test('현재가 위에서 가장 낮은 후보 = 저항, 아래에서 가장 높은 후보 = 지지', () => {
    // 후보: 고점 10(i3)·12(i9), 저점 low=h-1 중 스윙 저점 6번(low 0)
    const r = horizontalLevels(barsOf(highs), 8, { pivot: 3 })
    expect(r.resistance).toEqual({ i: 3, price: 10 })
    expect(r.support).toEqual({ i: 6, price: 0 })
  })

  test('고점·저점을 섞음 — 돌파된 옛 고점이 지지가 된다', () => {
    const r = horizontalLevels(barsOf(highs), 13, { pivot: 3 })
    expect(r.support).toEqual({ i: 9, price: 12 })
    expect(r.resistance).toBeNull()
  })

  test('깨진 옛 저점은 저항이 된다', () => {
    const lows = [9, 8, 7, 5, 7, 8, 9, 9, 9, 9, 9, 9]
    const r = horizontalLevels(barsOf(lows.map((l) => l + 1), lows), 4, { pivot: 3 })
    expect(r.resistance).toEqual({ i: 3, price: 5 })
  })

  test('현재가와 같은 가격은 저항', () => {
    const r = horizontalLevels(barsOf(highs), 10, { pivot: 3 })
    expect(r.resistance).toEqual({ i: 3, price: 10 })
  })

  test('같은 가격이면 더 최근 것', () => {
    const h = [1, 2, 3, 10, 3, 2, 1, 2, 3, 10, 3, 2, 1, 1, 1, 1]
    expect(horizontalLevels(barsOf(h), 8, { pivot: 3 }).resistance).toEqual({ i: 9, price: 10 })
  })

  test('위나 아래에 후보가 없으면 null', () => {
    expect(horizontalLevels(barsOf(highs), 100, { pivot: 3 }).resistance).toBeNull()
    expect(horizontalLevels(barsOf(highs), -5, { pivot: 3 }).support).toBeNull()
    expect(horizontalLevels([], 10, { pivot: 3 })).toEqual({ resistance: null, support: null, candidates: [] })
  })

  test('오른쪽 pivot 개가 없는 최근 캔들은 제외', () => {
    const h = [1, 2, 3, 10, 3, 2, 1, 2, 3, 12, 3, 2] // 9번은 오른쪽 2개뿐
    expect(horizontalLevels(barsOf(h), 11, { pivot: 3 }).support).not.toEqual({ i: 9, price: 12 })
    expect(horizontalLevels(barsOf(h), 11, { pivot: 3 }).resistance).toBeNull()
  })

  test('lookback 밖은 무시하되 i 는 전체 bars 기준', () => {
    const long = [...Array(20).fill(1), ...highs] // 길이 36, 고점은 23·29
    // lookback 15 → 시작 21: 23번은 왼쪽 pivot 이 범위 밖이라 후보 아님
    expect(horizontalLevels(barsOf(long), 8, { pivot: 3, lookback: 15 }).resistance).toEqual({ i: 29, price: 12 })
    expect(horizontalLevels(barsOf(long), 8, { pivot: 3, lookback: 16 }).resistance).toEqual({ i: 23, price: 10 })
    expect(horizontalLevels(barsOf(long), 8).resistance).toEqual({ i: 23, price: 10 })
  })

  describe('매물대 POC 후보', () => {
    test('POC 가 스윙보다 현재가에 가까우면 저항으로 선택', () => {
      const r = horizontalLevels(barsOf(highs), 8, { pivot: 3, poc: 9 })
      expect(r.resistance).toEqual({ i: 0, price: 9 })
      expect(r.support).toEqual({ i: 6, price: 0 })
    })
    test('POC 가 아래에서 더 가까우면 지지로 선택', () => {
      expect(horizontalLevels(barsOf(highs), 8, { pivot: 3, poc: 5 }).support).toEqual({ i: 0, price: 5 })
    })
    test('poc 없음·null 이면 기존과 같음', () => {
      const base = horizontalLevels(barsOf(highs), 8, { pivot: 3 })
      expect(horizontalLevels(barsOf(highs), 8, { pivot: 3, poc: null })).toEqual(base)
      expect(horizontalLevels(barsOf(highs), 8, { pivot: 3, poc: undefined })).toEqual(base)
    })
    test('POC 와 스윙이 같은 가격이면 스윙 우선', () => {
      expect(horizontalLevels(barsOf(highs), 8, { pivot: 3, poc: 10 }).resistance).toEqual({ i: 3, price: 10 })
    })
    test('POC 의 i 는 lookback 시작', () => {
      const long = [...Array(20).fill(1), ...highs] // 길이 36
      expect(horizontalLevels(barsOf(long), 8, { pivot: 3, lookback: 16, poc: 9 }).resistance).toEqual({ i: 20, price: 9 })
    })
  })

  describe('candidates(감지용 전체 후보)', () => {
    test('스윙 고점·저점·POC 가 모두 있고 같은 가격은 하나(i 큰 것)', () => {
      const h = [1, 2, 3, 10, 3, 2, 1, 2, 3, 10, 3, 2, 1, 1, 1, 1]
      const { candidates } = horizontalLevels(barsOf(h), 8, { pivot: 3, poc: 5 })
      expect(candidates).toContainEqual({ i: 9, price: 10 })
      expect(candidates).not.toContainEqual({ i: 3, price: 10 })
      expect(candidates).toContainEqual({ i: 6, price: 0 })
      expect(candidates).toContainEqual({ i: 0, price: 5 })
      expect(new Set(candidates.map((c) => c.price)).size).toBe(candidates.length)
    })
    test('POC 가 스윙과 같은 가격이면 스윙 하나만', () => {
      const { candidates } = horizontalLevels(barsOf(highs), 8, { pivot: 3, poc: 10 })
      expect(candidates.filter((c) => c.price === 10)).toEqual([{ i: 3, price: 10 }])
    })
    test('후보가 없으면 빈 배열', () => {
      expect(horizontalLevels([], 8).candidates).toEqual([])
    })
  })
})

describe('nearestSwings', () => {
  // 고가·저가가 같은 캔들 — 인덱스 3 고점 110, 7 고점 130, 5 저점 90, 9 저점 95 (pivot 3, 앞뒤 3개)
  const v = [100, 101, 102, 110, 100, 90, 100, 130, 100, 95, 100, 101, 102, 103]
  const bars = v.map((x) => ({ high: x, low: x }))

  test('고점·저점 각각 현재가 바로 위·아래', () => {
    expect(nearestSwings(bars, 120)).toEqual({
      highAbove: { i: 7, price: 130 }, highBelow: { i: 3, price: 110 },
      lowAbove: null, lowBelow: { i: 9, price: 95 },
    })
  })
  test('현재가와 같은 가격은 위(≥)', () => {
    expect(nearestSwings(bars, 110).highAbove).toEqual({ i: 3, price: 110 })
    expect(nearestSwings(bars, 92).lowAbove).toEqual({ i: 9, price: 95 })
    expect(nearestSwings(bars, 92).lowBelow).toEqual({ i: 5, price: 90 })
  })
  test('확정 전(오른쪽 3개 없음) 캔들은 후보 아님', () => {
    const late = [...bars.slice(0, 11), { high: 200, low: 200 }, { high: 100, low: 100 }]
    expect(nearestSwings(late, 150).highAbove).toBeNull()
  })
})

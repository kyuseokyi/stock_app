import { describe, test, expect } from 'vitest'
import { krxTick, roundToTick } from './krxTick'

describe('krxTick', () => {
  test.each([
    [1_999, 1],
    [2_000, 5],
    [4_999, 5],
    [5_000, 10],
    [19_999, 10],
    [20_000, 50],
    [49_999, 50],
    [50_000, 100],
    [199_999, 100],
    [200_000, 500],
    [499_999, 500],
    [500_000, 1_000],
  ])('%d원 → 호가 %d원', (price, tick) => {
    expect(krxTick(price)).toBe(tick)
  })
})

describe('roundToTick', () => {
  test('가까운 호가로 반올림', () => {
    expect(roundToTick(71_249)).toBe(71_200)
    expect(roundToTick(71_250)).toBe(71_300)
    expect(roundToTick(1_234.4)).toBe(1_234)
  })
})

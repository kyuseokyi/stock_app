import { describe, test, expect } from 'vitest'
import { canPartialClose, partialClosePreview } from './partialClose'

describe('partialClosePreview', () => {
  test('원금 100만·수익 25만(ROI 25%) — 절반 / 원금 회수', () => {
    const p = partialClosePreview(1_000_000, 250_000)
    expect(p).not.toBeNull()
    expect(p!.half.returned).toBeCloseTo(625_000, 2)
    expect(p!.half.remain).toBe(500_000)
    // f = 1/1.25 = 0.8 → close 80만, remain 20만, 평가금 25만(= 수익금)
    expect(p!.principal!.returned).toBeCloseTo(1_000_000, 2)
    expect(p!.principal!.remainValue).toBeCloseTo(250_000, 2)
  })

  test('나눠 떨어지지 않으면 0.01 반올림 — 돌려받는 돈은 원금과 1원 이내', () => {
    const p = partialClosePreview(333_333.33, 12_345.67)!
    expect(Math.abs(p.principal!.returned - 333_333.33)).toBeLessThan(1)
    expect(p.principal!.remainValue).toBeCloseTo(12_345.67, 0)
    expect(p.half.remain).toBeCloseTo(166_666.66, 2)
  })

  test('손실·0·손익 모름이면 null', () => {
    expect(partialClosePreview(1_000_000, 0)).toBeNull()
    expect(partialClosePreview(1_000_000, -1)).toBeNull()
    expect(partialClosePreview(0, 100)).toBeNull()
  })

  test('수익이 너무 작아 남길 원금이 0 이하면 원금 회수는 null', () => {
    const p = partialClosePreview(100, 0.001)!
    expect(p.principal).toBeNull()
    expect(p.half.remain).toBe(50)
  })
})

describe('canPartialClose', () => {
  test('partial_close true + 수익일 때만', () => {
    expect(canPartialClose({ partial_close: true }, 1)).toBe(true)
    expect(canPartialClose({ partial_close: true }, 0)).toBe(false)
    expect(canPartialClose({ partial_close: true }, -5)).toBe(false)
    expect(canPartialClose({ partial_close: true }, null)).toBe(false)
  })
  test('옛 서버(값 없음)·규칙 로드 전이면 숨김', () => {
    expect(canPartialClose({}, 10_000)).toBe(false)
    expect(canPartialClose({ partial_close: false }, 10_000)).toBe(false)
    expect(canPartialClose(null, 10_000)).toBe(false)
  })
})

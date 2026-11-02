import { describe, expect, test } from 'vitest'
import { RETURN_REFRESH_MS, shouldRefetchOnReturn } from './marketLive'

describe('shouldRefetchOnReturn', () => {
  const t0 = 1_000_000
  test('기준은 10분', () => {
    expect(RETURN_REFRESH_MS).toBe(600_000)
  })
  test('9분 59초면 다시 받지 않는다', () => {
    expect(shouldRefetchOnReturn(t0, t0 + 599_000)).toBe(false)
  })
  test('정확히 10분이면 다시 받는다', () => {
    expect(shouldRefetchOnReturn(t0, t0 + 600_000)).toBe(true)
  })
  test('첫 진입(아직 조회 전)은 첫 로딩과 겹치지 않게 다시 받지 않는다', () => {
    expect(shouldRefetchOnReturn(null, t0)).toBe(false)
  })
  test('시계가 거꾸로 갔으면 다시 받는다', () => {
    expect(shouldRefetchOnReturn(t0, t0 - 1)).toBe(true)
  })
})

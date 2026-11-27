// @vitest-environment node
// 서버(window 없음) — SSR 을 붙였을 때 요청 간 캐시가 섞이지 않게 매번 새 클라이언트
import { describe, expect, it } from 'vitest'
import { getQueryClient } from './queryClient'

describe('queryClient (서버)', () => {
  it('window 가 없으면 매번 새 인스턴스', () => {
    expect(typeof window).toBe('undefined')
    expect(getQueryClient()).not.toBe(getQueryClient())
  })
})

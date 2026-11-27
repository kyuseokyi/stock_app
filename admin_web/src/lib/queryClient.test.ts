// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { makeQueryClient, getQueryClient, shouldRetry } from './queryClient'

const httpErr = (status: number) => Object.assign(new Error(String(status)), { response: { status } })

describe('queryClient', () => {
  it('4xx 는 재시도하지 않는다', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) expect(shouldRetry(0, httpErr(s))).toBe(false)
  })
  it('5xx·네트워크 오류는 1회만 재시도', () => {
    expect(shouldRetry(0, httpErr(503))).toBe(true)
    expect(shouldRetry(1, httpErr(503))).toBe(false)
    expect(shouldRetry(0, new Error('network'))).toBe(true)
  })
  it('기본값: 창 포커스 재조회 끔', () => {
    expect(makeQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
  })
  it('브라우저에서는 싱글톤', () => {
    expect(getQueryClient()).toBe(getQueryClient())
  })
})

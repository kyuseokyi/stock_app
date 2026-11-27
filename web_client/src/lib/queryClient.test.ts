// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { makeQueryClient, getQueryClient, shouldRetry } from './queryClient'

const httpErr = (status: number) => Object.assign(new Error(String(status)), { response: { status } })

describe('queryClient', () => {
  it('4xx 는 재시도하지 않는다', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) expect(shouldRetry(0, httpErr(s))).toBe(false)
  })
  it('5xx·네트워크 오류는 최대 횟수까지만 재시도(기본 1, 0 이면 안 함)', () => {
    expect(shouldRetry(0, httpErr(503))).toBe(true)
    expect(shouldRetry(1, httpErr(503))).toBe(false)
    expect(shouldRetry(0, new Error('network'))).toBe(true)
    expect(shouldRetry(0, httpErr(503), 0)).toBe(false)
  })
  it('기본값: 창 포커스·재연결 재조회 끔', () => {
    const q = makeQueryClient().getDefaultOptions().queries
    expect(q?.refetchOnWindowFocus).toBe(false)
    expect(q?.refetchOnReconnect).toBe(false)
  })
  it('web 기본 재시도: axios installRetry 와 겹치지 않게 4xx·5xx·네트워크 모두 재시도 안 함', () => {
    const retry = makeQueryClient().getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean
    expect(retry(0, httpErr(404))).toBe(false)
    expect(retry(0, httpErr(503))).toBe(false)
    expect(retry(0, new Error('network'))).toBe(false)
  })
  it('브라우저에서는 싱글톤', () => {
    expect(getQueryClient()).toBe(getQueryClient())
  })
})

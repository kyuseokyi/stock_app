import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { isNotFound } from './errorCode'

function httpError(status: number): AxiosError {
  const headers = new AxiosHeaders()
  return new AxiosError('fail', 'ERR_BAD_REQUEST', { headers }, null, {
    status,
    statusText: '',
    headers,
    config: { headers },
    data: {},
  })
}

describe('isNotFound', () => {
  it('404 응답이면 없는 것으로 본다', () => {
    expect(isNotFound(httpError(404))).toBe(true)
  })

  it('다른 상태 코드·네트워크 오류·일반 오류는 아니다', () => {
    expect(isNotFound(httpError(500))).toBe(false)
    expect(isNotFound(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(false)
    expect(isNotFound(new Error('x'))).toBe(false)
  })
})

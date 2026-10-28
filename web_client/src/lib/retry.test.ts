import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { RETRY_DELAYS_MS, installRetry, isGraphqlQuery, isIdempotent, isTransient } from './retry'

// 앱 retry.test.ts 이식. 앱은 fetch 기반 createHttpClient + withRetry, 웹은 axios 인스턴스에 installRetry(응답 인터셉터).
// fetch 가짜 대신 axios adapter 가짜로 같은 상황(502·연결 실패·POST·타임아웃·GraphQL)을 만든다.

type Step = number | 'network' | 'timeout'

/** 단계마다 응답 상태(숫자) 또는 오류를 돌려주는 가짜 adapter 를 붙인 axios 인스턴스 */
function client(steps: Step[]) {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const step = steps[Math.min(adapter.mock.calls.length - 1, steps.length - 1)]
    if (step === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config, {})
    if (step === 'timeout') throw new AxiosError('timeout', 'ECONNABORTED', config, {})
    const response = { data: { ok: 1 }, status: step, statusText: '', headers: {}, config } as AxiosResponse
    if (step >= 400) throw new AxiosError(`HTTP ${step}`, 'ERR_BAD_RESPONSE', config, {}, response)
    return response
  })
  const instance = axios.create({ baseURL: 'https://x.test', adapter })
  installRetry(instance)
  return { instance, adapter }
}

describe('조회 재시도(배포 순간 공백)', () => {
  const saved = [...RETRY_DELAYS_MS]
  beforeEach(() => {
    RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, 1, 1, 1)
  })
  afterEach(() => {
    RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, ...saved)
  })

  it('GET 은 502·503 뒤 성공하면 결과를 돌려준다', async () => {
    const { instance, adapter } = client([502, 503, 200])
    await expect(instance.get('/a').then((r) => r.data)).resolves.toEqual({ ok: 1 })
    expect(adapter).toHaveBeenCalledTimes(3)
  })

  it('연결 실패(응답 없음)도 재시도, 계속 실패하면 3번 재시도 후 포기', async () => {
    const { instance, adapter } = client(['network'])
    await expect(instance.get('/a')).rejects.toThrow('Network Error')
    expect(adapter).toHaveBeenCalledTimes(4)
  })

  it('POST(주문 등)는 502 여도 다시 보내지 않는다', async () => {
    const { instance, adapter } = client([502])
    await expect(instance.post('/orders', { qty: 1 })).rejects.toThrow('HTTP 502')
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('400·401·500 은 일시 장애가 아니라 재시도하지 않는다', async () => {
    for (const status of [400, 401, 500]) {
      const { instance, adapter } = client([status])
      await expect(instance.get('/a')).rejects.toThrow(`HTTP ${status}`)
      expect(adapter).toHaveBeenCalledTimes(1)
    }
  })

  it('시간 초과로 끊긴 GET 은 다시 보내지 않는다', async () => {
    const { instance, adapter } = client(['timeout'])
    await expect(instance.get('/slow')).rejects.toThrow('timeout')
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('GraphQL query(POST)는 502 를 재시도하고 mutation 은 다시 보내지 않는다', async () => {
    const q = client([502, 200])
    await expect(q.instance.post('/graphql', { query: 'query Chart { a }' }).then((r) => r.data)).resolves.toEqual({ ok: 1 })
    expect(q.adapter).toHaveBeenCalledTimes(2)

    const m = client([502])
    await expect(m.instance.post('/graphql', { query: 'mutation Buy { b }' })).rejects.toThrow('HTTP 502')
    expect(m.adapter).toHaveBeenCalledTimes(1)
  })

  it('두 번 설치해도 재시도는 한 벌만', async () => {
    const { instance, adapter } = client(['network'])
    installRetry(instance)
    await expect(instance.get('/a')).rejects.toThrow('Network Error')
    expect(adapter).toHaveBeenCalledTimes(4)
  })
})

describe('판별 함수', () => {
  it('GraphQL 문서 판별 — query 만 재시도 대상(웹은 요청 본문 객체·JSON 문자열을 받는다)', () => {
    expect(isGraphqlQuery({ query: 'query Chart { a }' })).toBe(true)
    expect(isGraphqlQuery({ query: '{ searchStocks(query: "삼성") { symbol } }' })).toBe(true)
    expect(isGraphqlQuery({ query: '  # 주석\n  mutation Buy { b }' })).toBe(false)
    expect(isGraphqlQuery({ query: 'subscription S { c }' })).toBe(false)
    expect(isGraphqlQuery(JSON.stringify({ query: 'query Q { a }' }))).toBe(true)
    expect(isGraphqlQuery('{oops')).toBe(false)
    expect(isGraphqlQuery({ qty: 1 })).toBe(false)
  })

  it('다시 보내도 안전한 요청 — GET·HEAD·OPTIONS 와 GraphQL query POST', () => {
    expect(isIdempotent(undefined, undefined)).toBe(true)
    expect(isIdempotent('GET', undefined)).toBe(true)
    expect(isIdempotent('head', undefined)).toBe(true)
    expect(isIdempotent('post', { query: 'query Q { a }' })).toBe(true)
    expect(isIdempotent('post', { qty: 1 })).toBe(false)
    expect(isIdempotent('put', undefined)).toBe(false)
    expect(isIdempotent('delete', undefined)).toBe(false)
  })

  it('일시 장애 — 502/503/504·응답 없음, 시간 초과는 제외', () => {
    const res = (status: number) => ({ status }) as AxiosResponse
    expect(isTransient(new AxiosError('x', 'ERR_BAD_RESPONSE', undefined, {}, res(502)))).toBe(true)
    expect(isTransient(new AxiosError('x', 'ERR_BAD_RESPONSE', undefined, {}, res(400)))).toBe(false)
    expect(isTransient(new AxiosError('x', 'ERR_NETWORK'))).toBe(true)
    expect(isTransient(new AxiosError('x', 'ECONNABORTED', undefined, {}))).toBe(false)
    expect(isTransient(new AxiosError('x', 'ETIMEDOUT', undefined, {}))).toBe(false)
  })
})

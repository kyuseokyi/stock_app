import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'

// 배포·재시작 순간의 짧은 공백(연결 거부·502/503/504)을 가리는 조회 재시도.
// 조회만 다시 보낸다 — GET/HEAD 와 GraphQL query. 주문·보상·글쓰기 같은 쓰기(POST·mutation 등)는
// 서버가 이미 처리했을 수 있어 두 번 실행될 위험이 있으므로 절대 재시도하지 않는다.

export const RETRY_DELAYS_MS = [1000, 3000, 6000] // 최대 3번, 합 10초
const RETRY_STATUS = new Set([502, 503, 504])

/** GraphQL 요청 본문이 조회(query)인지 — 'mutation'·'subscription' 이면 false */
export function isGraphqlQuery(data: unknown): boolean {
  let body = data
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return false
    }
  }
  const q = (body as { query?: unknown } | null)?.query
  if (typeof q !== 'string') return false
  const head = q.replace(/#[^\n]*/g, '').trimStart()
  return !/^(mutation|subscription)\b/.test(head)
}

/** 다시 보내도 안전한 요청인가 */
export function isIdempotent(method: string | undefined, data: unknown): boolean {
  const m = (method ?? 'get').toLowerCase()
  if (m === 'get' || m === 'head' || m === 'options') return true
  return m === 'post' && isGraphqlQuery(data)
}

/** 일시적 장애인가 — 응답 없음(연결 거부·네트워크 끊김) 또는 502/503/504. 시간 초과·취소는 제외 */
export function isTransient(err: AxiosError): boolean {
  if (axios.isCancel(err) || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return false
  if (!err.response) return err.code === 'ERR_NETWORK' || err.request != null
  return RETRY_STATUS.has(err.response.status)
}

type RetryConfig = InternalAxiosRequestConfig & { __retryCount?: number }

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** axios 인스턴스(또는 기본 axios)에 조회 재시도를 붙인다. 이미 붙어 있으면 다시 붙이지 않는다 */
export function installRetry(instance: AxiosInstance): void {
  const marked = instance as AxiosInstance & { __retryInstalled?: boolean }
  if (marked.__retryInstalled) return
  marked.__retryInstalled = true
  instance.interceptors.response.use(undefined, async (err: unknown) => {
    if (!axios.isAxiosError(err) || !err.config) throw err
    const config = err.config as RetryConfig
    const n = config.__retryCount ?? 0
    if (n >= RETRY_DELAYS_MS.length || !isIdempotent(config.method, config.data) || !isTransient(err)) throw err
    config.__retryCount = n + 1
    await wait(RETRY_DELAYS_MS[n])
    return instance.request(config)
  })
}

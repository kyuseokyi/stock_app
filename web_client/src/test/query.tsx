// 화면 테스트 도우미 — 테스트마다 새 QueryClient(재시도 끔)·라우터로 감싸 그린다.
// 화면이 Query 를 쓰기 전에도 같은 도우미로 그려, 전환 전후에 같은 테스트를 그대로 돌린다.
import { act, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { RETURN_REFRESH_MS } from '../lib/marketLive'

export function renderWithClient(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
  return { client, ...view }
}

export function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 탭 복귀 — 마지막 조회 뒤 RETURN_REFRESH_MS 이상 지난 것처럼 시계를 앞당기고 visibilitychange 를 보낸다(부를 때마다 더 앞당김).
 *  시계는 afterEach 의 vi.restoreAllMocks() 로 되돌린다 */
let skew = 0
export async function returnToTabAfterIdle() {
  const real = Date.now.bind(Date)
  skew += RETURN_REFRESH_MS + 60_000
  const at = skew
  vi.spyOn(Date, 'now').mockImplementation(() => real() + at)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

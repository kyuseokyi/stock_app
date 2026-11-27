// 화면 테스트 도우미 — 테스트마다 새 QueryClient(재시도 끔)·라우터로 감싸 그린다.
// 화면이 Query 를 쓰기 전에도 같은 도우미로 그려, 전환 전후에 같은 테스트를 그대로 돌린다.
import { act, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

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

/** 캐시된 데이터가 있을 때 재조회가 실패하는 상황 — fail() 로 api 를 실패하게 바꾼 뒤 보이는 조회를 모두 다시 받는다 */
export async function refetchActiveFailing(client: QueryClient, fail: () => void) {
  fail()
  await act(async () => {
    await client.refetchQueries({ type: 'active' })
  })
  // Query 의 화면 알림은 setTimeout 으로 나간다 — 실패 상태가 화면에 반영될 때까지 한 박자 기다린다
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
}

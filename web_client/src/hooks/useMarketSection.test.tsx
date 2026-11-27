// @vitest-environment jsdom
// 시황 섹션 훅 동작 고정 — 내부를 TanStack Query 로 바꾼 뒤에도 이 테스트는 고치지 않고 그대로 통과해야 한다.
// 가짜 타이머는 쓰지 않는다(Query 알림이 setTimeout 으로 나간다). 응답 순서는 직접 resolve 하는 deferred 로 정한다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useMarketSection } from './useMarketSection'
import { MARKET_REQUEST_TIMEOUT_MS } from '../lib/marketLive'

afterEach(() => cleanup())

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type V = { v: number }

describe('useMarketSection', () => {
  it('첫 로딩 성공 → data 채움, loading false', async () => {
    const fetcher = vi.fn(async () => ({ v: 1 }))
    const { result } = renderHook(() => useMarketSection<V>(fetcher), { wrapper: wrapper() })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    expect(result.current.loading).toBe(false)
    expect(result.current.failed).toBe(false)
  })

  it('첫 로딩 실패 → failed, reload 성공 → failed false', async () => {
    let fail = true
    const fetcher = vi.fn(async () => {
      if (fail) throw new Error('x')
      return { v: 2 }
    })
    const { result } = renderHook(() => useMarketSection<V>(fetcher), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
    fail = false
    await act(async () => {
      await result.current.reload()
    })
    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }))
    expect(result.current.failed).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  it('reload 중에는 data 가 있어도 loading true', async () => {
    const d = deferred<V>()
    let n = 0
    const fetcher = vi.fn(() => (++n === 1 ? Promise.resolve({ v: 1 }) : d.promise))
    const { result } = renderHook(() => useMarketSection<V>(fetcher), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    act(() => {
      void result.current.reload()
    })
    await waitFor(() => expect(result.current.loading).toBe(true))
    expect(result.current.data).toEqual({ v: 1 })
    await act(async () => d.resolve({ v: 9 }))
    await waitFor(() => expect(result.current.data).toEqual({ v: 9 }))
    expect(result.current.loading).toBe(false)
  })

  it('silentRefresh 실패 → 이전 data 유지, failed false', async () => {
    let fail = false
    const fetcher = vi.fn(async () => {
      if (fail) throw new Error('x')
      return { v: 1 }
    })
    const { result } = renderHook(() => useMarketSection<V>(fetcher), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    fail = true
    await act(async () => {
      await result.current.silentRefresh()
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.current.data).toEqual({ v: 1 })
    expect(result.current.failed).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  it('첫 로딩 실패 뒤 silentRefresh 성공 → failed false·data 채움, 실패면 failed 그대로', async () => {
    let mode: 'fail' | 'ok' = 'fail'
    const fetcher = vi.fn(async () => {
      if (mode === 'fail') throw new Error('x')
      return { v: 3 }
    })
    const { result } = renderHook(() => useMarketSection<V>(fetcher), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.failed).toBe(true))
    await act(async () => {
      await result.current.silentRefresh()
    })
    expect(result.current.failed).toBe(true)
    mode = 'ok'
    await act(async () => {
      await result.current.silentRefresh()
    })
    await waitFor(() => expect(result.current.data).toEqual({ v: 3 }))
    expect(result.current.failed).toBe(false)
  })

  it('enabled=false → 요청 없음·빈 상태, true 가 되면 조회', async () => {
    const fetcher = vi.fn(async () => ({ v: 1 }))
    const { result, rerender } = renderHook(({ on }) => useMarketSection<V>(fetcher, undefined, on), {
      wrapper: wrapper(),
      initialProps: { on: false },
    })
    expect(fetcher).toHaveBeenCalledTimes(0)
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.failed).toBe(false)
    await act(async () => {
      await result.current.silentRefresh()
      await result.current.reload()
    })
    expect(fetcher).toHaveBeenCalledTimes(0)
    rerender({ on: true })
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('enabled 가 true→false 가 되면 빈 상태로', async () => {
    const fetcher = vi.fn(async () => ({ v: 1 }))
    const { result, rerender } = renderHook(({ on }) => useMarketSection<V>(fetcher, undefined, on), {
      wrapper: wrapper(),
      initialProps: { on: true },
    })
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    rerender({ on: false })
    await waitFor(() => expect(result.current.data).toBeNull())
    expect(result.current.loading).toBe(false)
    expect(result.current.failed).toBe(false)
  })

  it('keepCurrent 가 true 면 silentRefresh 뒤에도 이전 객체 그대로', async () => {
    let n = 0
    const fetcher = vi.fn(async () => ({ v: ++n }))
    const keep = vi.fn(() => true)
    const { result } = renderHook(() => useMarketSection<V>(fetcher, keep), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    const first = result.current.data
    await act(async () => {
      await result.current.silentRefresh()
    })
    expect(keep).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBe(first)
  })

  it('keepCurrent 가 false 면 silentRefresh 결과로 바꾼다', async () => {
    let n = 0
    const fetcher = vi.fn(async () => ({ v: ++n }))
    const { result } = renderHook(() => useMarketSection<V>(fetcher, () => false), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    await act(async () => {
      await result.current.silentRefresh()
    })
    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }))
  })

  it('silentRefresh 두 번 연달아(첫 요청 미완) → 추가 호출 1번만', async () => {
    const d = deferred<V>()
    let n = 0
    const fetcher = vi.fn(() => (++n === 1 ? Promise.resolve({ v: 1 }) : d.promise))
    const { result } = renderHook(() => useMarketSection<V>(fetcher), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    let p1: Promise<void> | undefined
    act(() => {
      p1 = result.current.silentRefresh()
      void result.current.silentRefresh()
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await act(async () => {
      d.resolve({ v: 5 })
      await p1
    })
    await waitFor(() => expect(result.current.data).toEqual({ v: 5 }))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('silentRefresh 는 MARKET_REQUEST_TIMEOUT_MS 를 넘기고, 첫 로딩·reload 는 인자 없이 부른다', async () => {
    const fetcher = vi.fn(async (timeoutMs?: number) => ({ v: timeoutMs === undefined ? 1 : 1 }))
    const { result } = renderHook(() => useMarketSection<V>(fetcher), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    expect(fetcher.mock.calls[0]).toEqual([])
    await act(async () => {
      await result.current.reload()
    })
    expect(fetcher.mock.calls[1]).toEqual([])
    await act(async () => {
      await result.current.silentRefresh()
    })
    expect(fetcher.mock.calls[2]).toEqual([MARKET_REQUEST_TIMEOUT_MS])
  })

  it('fetchedAt 은 실패 뒤에도 찍힌다(첫 로딩·조용한 갱신 모두)', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('x')
    })
    const { result } = renderHook(() => useMarketSection<V>(fetcher), { wrapper: wrapper() })
    expect(result.current.fetchedAt.current).toBeNull()
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(typeof result.current.fetchedAt.current).toBe('number')
    const first = result.current.fetchedAt.current as number
    await new Promise((r) => setTimeout(r, 5))
    await act(async () => {
      await result.current.silentRefresh()
    })
    expect(result.current.fetchedAt.current as number).toBeGreaterThan(first)
  })

  it('늦게 온 옛 응답은 버린다 — reload 두 번, 첫 응답이 나중에 와도 최종 data 는 두 번째 값', async () => {
    const a = deferred<V>()
    const b = deferred<V>()
    let n = 0
    const fetcher = vi.fn(() => {
      n += 1
      if (n === 1) return Promise.resolve({ v: 0 })
      return n === 2 ? a.promise : b.promise
    })
    const { result } = renderHook(() => useMarketSection<V>(fetcher), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual({ v: 0 }))
    let pa: Promise<void> | undefined
    let pb: Promise<void> | undefined
    act(() => {
      pa = result.current.reload()
    })
    act(() => {
      pb = result.current.reload()
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
    await act(async () => {
      b.resolve({ v: 2 })
      await pb
    })
    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }))
    await act(async () => {
      a.resolve({ v: 1 })
      await pa
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.data).toEqual({ v: 2 })
    expect(result.current.loading).toBe(false)
  })

  it('reload 가 진행 중일 때 시작한 silentRefresh 결과가 나중에 와도 화면은 reload 결과 뒤의 값을 따른다', async () => {
    // 지금 구현: silentRefresh 는 시작 시점의 요청 번호를 기억하고, 그 뒤 reload 가 새로 시작되면 결과를 버린다
    const s = deferred<V>()
    const r = deferred<V>()
    let n = 0
    const fetcher = vi.fn(() => {
      n += 1
      if (n === 1) return Promise.resolve({ v: 0 })
      return n === 2 ? s.promise : r.promise
    })
    const { result } = renderHook(() => useMarketSection<V>(fetcher), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual({ v: 0 }))
    let ps: Promise<void> | undefined
    let pr: Promise<void> | undefined
    act(() => {
      ps = result.current.silentRefresh()
    })
    act(() => {
      pr = result.current.reload()
    })
    await act(async () => {
      r.resolve({ v: 2 })
      await pr
    })
    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }))
    await act(async () => {
      s.resolve({ v: 1 })
      await ps
    })
    await new Promise((res) => setTimeout(res, 10))
    expect(result.current.data).toEqual({ v: 2 })
  })

  it('fetcher 가 바뀌면 다시 불러온다', async () => {
    const f1 = vi.fn(async () => ({ v: 1 }))
    const f2 = vi.fn(async () => ({ v: 2 }))
    const { result, rerender } = renderHook(({ f }) => useMarketSection<V>(f), {
      wrapper: wrapper(),
      initialProps: { f: f1 },
    })
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    rerender({ f: f2 })
    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }))
    expect(f2).toHaveBeenCalledTimes(1)
  })
})

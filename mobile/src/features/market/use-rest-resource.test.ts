/**
 * useRestResource 동작 고정 테스트 — 내부를 TanStack Query 로 바꾸기 전 코드에서 먼저 통과시키고,
 * 바꾼 뒤에도 그대로 통과해야 한다(입출력·동작 불변). 화면 렌더 없이 renderHook 만 쓴다.
 */
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useRestResource } from './use-rest-resource';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

describe('useRestResource', () => {
  it('처음엔 loading 이고, 받으면 data 를 채우고 fetchedAt 을 찍는다', async () => {
    const first = deferred<{ v: number }>();
    const fetcher = jest.fn().mockReturnValue(first.promise);
    const { result } = await renderHook(() => useRestResource(fetcher), { wrapper: wrapper() });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await act(async () => first.resolve({ v: 1 }));
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.fetchedAt.current).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('enabled=false 면 요청하지 않고 빈 상태, true 로 바뀌면 그때 불러온다', async () => {
    const fetcher = jest.fn().mockResolvedValue('ok');
    const { result, rerender } = await renderHook(({ on }: { on: boolean }) => useRestResource(fetcher, on), {
      wrapper: wrapper(),
      initialProps: { on: false },
    });
    expect(result.current).toMatchObject({ data: null, loading: false, error: null });
    await act(async () => {
      await result.current.refresh();
      await result.current.silentRefresh();
    });
    expect(fetcher).not.toHaveBeenCalled();
    await rerender({ on: true });
    await waitFor(() => expect(result.current.data).toBe('ok'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reload 가 실패하면 이전 data 는 남기고 오류 코드만 기록하며, fetchedAt 은 실패해도 찍는다', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce('first').mockRejectedValueOnce(httpError(500));
    const { result } = await renderHook(() => useRestResource(fetcher), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBe('first'));
    result.current.fetchedAt.current = null;
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current).toMatchObject({ data: 'first', loading: false, error: 'HTTP 500' });
    expect(result.current.fetchedAt.current).not.toBeNull();
  });

  it('첫 로딩이 네트워크 오류면 error=NETWORK, [다시 시도](reload) 성공 시 오류가 지워진다', async () => {
    const fetcher = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('back');
    const { result } = await renderHook(() => useRestResource(fetcher), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toBe('NETWORK'));
    expect(result.current.data).toBeNull();
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current).toMatchObject({ data: 'back', loading: false, error: null });
  });

  it('refresh(당겨서 새로고침)는 실패하면 throw 하고 보이던 data 는 그대로 둔다', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce('a').mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce('b');
    const { result } = await renderHook(() => useRestResource(fetcher), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBe('a'));
    await act(async () => {
      await expect(result.current.refresh()).rejects.toBeTruthy();
    });
    expect(result.current.data).toBe('a');
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current).toMatchObject({ data: 'b', error: null, loading: false });
  });

  it('silentRefresh 는 실패하면 throw 하고 data 는 그대로, 성공하면 data 를 바꾸고 오류를 지운다', async () => {
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('y'))
      .mockResolvedValueOnce('fresh');
    const { result } = await renderHook(() => useRestResource(fetcher), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toBe('NETWORK'));
    await act(async () => {
      await expect(result.current.silentRefresh()).rejects.toBeTruthy();
    });
    expect(result.current.data).toBeNull();
    await act(async () => {
      await result.current.silentRefresh();
    });
    expect(result.current).toMatchObject({ data: 'fresh', error: null });
  });

  it('reload 전에 시작한 silentRefresh 응답은 버린다(늦게 온 옛 응답이 새 결과를 덮지 않음)', async () => {
    const slow = deferred<string>();
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce('initial')
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce('reloaded');
    const { result } = await renderHook(() => useRestResource(fetcher), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBe('initial'));
    let silent!: Promise<void>;
    await act(async () => {
      silent = result.current.silentRefresh();
    });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBe('reloaded');
    await act(async () => {
      slow.resolve('stale');
      await silent;
    });
    expect(result.current.data).toBe('reloaded');
  });

  it('fetcher 가 바뀌면(히트맵 기준 전환) 새 fetcher 로 다시 불러온다', async () => {
    const a = jest.fn().mockResolvedValue('A');
    const b = jest.fn().mockResolvedValue('B');
    const { result, rerender } = await renderHook(({ f }: { f: () => Promise<string> }) => useRestResource(f), {
      wrapper: wrapper(),
      initialProps: { f: a },
    });
    await waitFor(() => expect(result.current.data).toBe('A'));
    await rerender({ f: b });
    await waitFor(() => expect(result.current.data).toBe('B'));
    expect(b).toHaveBeenCalledTimes(1);
  });
});

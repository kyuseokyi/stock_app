/**
 * useGroupDetail 동작 고정 테스트 — 내부를 TanStack Query 로 바꾸기 전 코드에서 먼저 통과시키고,
 * 바꾼 뒤에도 그대로 통과해야 한다(입출력·동작 불변). 마지막 테스트 하나만 의도된 차이(30초 안 같은 그룹 복귀 시 저장된 결과)다.
 */
import { createElement, type ReactNode } from 'react';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { makeQueryClient } from '@/lib/query-client';

import { fetchMarketGroup } from './api';
import type { GroupDetail, GroupKind } from './types';
import { useGroupDetail } from './use-group-detail';

jest.mock('./api', () => ({ fetchMarketGroup: jest.fn() }));

const fetchMock = fetchMarketGroup as jest.MockedFunction<typeof fetchMarketGroup>;

let qc: QueryClient;
function wrapper() {
  qc = makeQueryClient();
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
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

/** 늦춰진 알림(Query 는 setTimeout 0 으로 묶어 알린다)까지 흘려보낸다 — "바뀌지 않아야 함"을 확인할 때 */
const flush = () => act(async () => new Promise<void>((r) => setTimeout(r, 20)));

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

const detail = (id: string, name = id): GroupDetail => ({ kind: 'theme', id, name }) as unknown as GroupDetail;

type Props = { kind: GroupKind; id: string };

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  qc?.clear();
});

describe('useGroupDetail', () => {
  it('처음엔 loading 이고, 받으면 data 를 채운다', async () => {
    const first = deferred<GroupDetail | null>();
    fetchMock.mockReturnValueOnce(first.promise);
    const { result } = await renderHook(() => useGroupDetail('theme', 't1'), { wrapper: wrapper() });
    expect(result.current).toMatchObject({ data: null, loading: true, error: null, notFound: false });
    await act(async () => first.resolve(detail('t1')));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ data: detail('t1'), error: null, notFound: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('theme', 't1');
  });

  it('응답이 null 이면 notFound=true, data=null', async () => {
    fetchMock.mockResolvedValueOnce(null);
    const { result } = await renderHook(() => useGroupDetail('sector', 'x'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toMatchObject({ data: null, loading: false, error: null, notFound: true }));
  });

  it('reload 하는 동안은 보이던 data 를 둔 채 loading, 실패하면 data 를 비우고 오류 코드, 다시 성공하면 오류가 지워진다', async () => {
    const second = deferred<GroupDetail | null>();
    fetchMock.mockResolvedValueOnce(detail('t1')).mockReturnValueOnce(second.promise).mockResolvedValueOnce(detail('t1', '새 이름'));
    const { result } = await renderHook(() => useGroupDetail('theme', 't1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual(detail('t1')));
    let p!: Promise<void>;
    await act(async () => {
      p = result.current.reload();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current).toMatchObject({ data: detail('t1'), error: null });
    await act(async () => {
      second.reject(httpError(500));
      await p;
    });
    await waitFor(() => expect(result.current).toMatchObject({ data: null, loading: false, error: 'HTTP 500', notFound: false }));
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current).toMatchObject({ data: detail('t1', '새 이름'), loading: false, error: null }));
  });

  it('첫 로딩이 네트워크 오류면 error=NETWORK, data=null', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    const { result } = await renderHook(() => useGroupDetail('theme', 't1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toMatchObject({ data: null, loading: false, error: 'NETWORK', notFound: false }));
  });

  it('refresh 는 실패하면 throw 하고 보이던 data 는 그대로, 성공하면 교체하고 null 이면 notFound', async () => {
    fetchMock
      .mockResolvedValueOnce(detail('t1'))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(detail('t1', '갱신'))
      .mockResolvedValueOnce(null);
    const { result } = await renderHook(() => useGroupDetail('theme', 't1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual(detail('t1')));
    await act(async () => {
      await expect(result.current.refresh()).rejects.toBeTruthy();
    });
    await flush();
    expect(result.current).toMatchObject({ data: detail('t1'), loading: false, error: null, notFound: false });
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.data).toEqual(detail('t1', '갱신')));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current).toMatchObject({ data: null, notFound: true, error: null }));
  });

  it('오류 화면에서 refresh 가 성공하면 오류가 지워진다', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(detail('t1'));
    const { result } = await renderHook(() => useGroupDetail('theme', 't1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toBe('NETWORK'));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current).toMatchObject({ data: detail('t1'), loading: false, error: null }));
  });

  it('종류·id 가 바뀌면 새로 받는다', async () => {
    fetchMock.mockResolvedValueOnce(detail('t1')).mockResolvedValueOnce(detail('s9'));
    const { result, rerender } = await renderHook(({ kind, id }: Props) => useGroupDetail(kind, id), {
      wrapper: wrapper(),
      initialProps: { kind: 'theme', id: 't1' } as Props,
    });
    await waitFor(() => expect(result.current.data).toEqual(detail('t1')));
    await rerender({ kind: 'sector', id: 's9' });
    await waitFor(() => expect(result.current.data).toEqual(detail('s9')));
    expect(fetchMock).toHaveBeenLastCalledWith('sector', 's9');
  });

  it('[의도된 차이] 30초 안에 같은 그룹으로 돌아오면 저장된 결과를 다시 받지 않고 바로 보여 준다(전환 전 코드에선 실패가 정상)', async () => {
    fetchMock.mockResolvedValueOnce(detail('t1')).mockResolvedValueOnce(detail('t2')).mockResolvedValue(detail('zz'));
    const { result, rerender } = await renderHook(({ kind, id }: Props) => useGroupDetail(kind, id), {
      wrapper: wrapper(),
      initialProps: { kind: 'theme', id: 't1' } as Props,
    });
    await waitFor(() => expect(result.current.data).toEqual(detail('t1')));
    await rerender({ kind: 'theme', id: 't2' });
    await waitFor(() => expect(result.current.data).toEqual(detail('t2')));
    await rerender({ kind: 'theme', id: 't1' });
    expect(result.current).toMatchObject({ data: detail('t1'), loading: false, error: null });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

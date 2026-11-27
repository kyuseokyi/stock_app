/**
 * useGroupRanking 동작 고정 테스트 — 내부를 TanStack Query 로 바꾸기 전 코드에서 먼저 통과시키고,
 * 바꾼 뒤에도 그대로 통과해야 한다(입출력·동작 불변). 마지막 테스트 하나만 의도된 차이(30초 안 같은 조건 복귀 시 저장된 결과)다.
 */
import { createElement, type ReactNode } from 'react';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { makeQueryClient } from '@/lib/query-client';

import { fetchMarketGroups } from './api';
import type { GroupItem, GroupRanking } from './types';
import { useGroupRanking } from './use-group-ranking';

jest.mock('./api', () => ({ fetchMarketGroups: jest.fn() }));

const fetchMock = fetchMarketGroups as jest.MockedFunction<typeof fetchMarketGroups>;

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

const item = (id: string): GroupItem =>
  ({ id, name: id, members: 1, chg: 0, value: 0, up: 0, down: 0, flat: 0, leader: null, rank: 1, streak: 0 }) as GroupItem;

/** prefix-0 ~ prefix-(n-1) 항목, 전체 total, 기준일 date */
function page(prefix: string, n: number, total: number, date: string | null = '2026-11-26', from = 0): GroupRanking {
  return { date, total, items: Array.from({ length: n }, (_, i) => item(`${prefix}-${from + i}`)) };
}

const ids = (items: GroupItem[]) => items.map((x) => x.id);

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  qc?.clear();
});

describe('useGroupRanking', () => {
  it('처음엔 loading·빈 목록이고, 첫 30개를 받으면 목록·전체 수·기준일·더 있음을 채우고 fetchedAt 을 찍는다', async () => {
    const first = deferred<GroupRanking>();
    fetchMock.mockReturnValueOnce(first.promise);
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    expect(result.current).toMatchObject({
      items: [], total: 0, date: null, hasMore: false, loading: true, error: null, loadingMore: false, moreFailed: false,
      period: '1d', sort: 'chg',
    });
    await act(async () => first.resolve(page('a', 30, 50)));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ total: 50, date: '2026-11-26', hasMore: true, error: null });
    expect(result.current.items).toHaveLength(30);
    expect(result.current.fetchedAt.current).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('theme', '1d', 'chg', 0);
  });

  it('기간·정렬을 바꾸면 새 조건으로 다시 받고, 받는 동안은 이전 목록을 둔 채 loading 이다', async () => {
    const next = deferred<GroupRanking>();
    fetchMock.mockResolvedValueOnce(page('a', 3, 3)).mockReturnValueOnce(next.promise).mockResolvedValueOnce(page('c', 2, 2));
    const { result } = await renderHook(() => useGroupRanking('sector'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    await act(async () => result.current.setPeriod('5d'));
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current).toMatchObject({ period: '5d', error: null });
    expect(ids(result.current.items)).toEqual(['a-0', 'a-1', 'a-2']);
    expect(fetchMock).toHaveBeenLastCalledWith('sector', '5d', 'chg', 0);
    await act(async () => next.resolve(page('b', 1, 1)));
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, total: 1, hasMore: false }));
    expect(ids(result.current.items)).toEqual(['b-0']);
    await act(async () => result.current.setSort('value'));
    await waitFor(() => expect(ids(result.current.items)).toEqual(['c-0', 'c-1']));
    expect(fetchMock).toHaveBeenLastCalledWith('sector', '5d', 'value', 0);
  });

  it('조건을 빠르게 바꾸면 늦게 온 옛 조건 응답은 버리고 마지막 조건 결과만 남긴다', async () => {
    const p5 = deferred<GroupRanking>();
    const p20 = deferred<GroupRanking>();
    fetchMock.mockResolvedValueOnce(page('a', 1, 1)).mockReturnValueOnce(p5.promise).mockReturnValueOnce(p20.promise);
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => result.current.setPeriod('5d'));
    await act(async () => result.current.setPeriod('20d'));
    await act(async () => p20.resolve(page('c', 2, 2)));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ids(result.current.items)).toEqual(['c-0', 'c-1']);
    await act(async () => p5.resolve(page('b', 5, 5)));
    await flush();
    expect(result.current).toMatchObject({ period: '20d', loading: false, total: 2, error: null });
    expect(ids(result.current.items)).toEqual(['c-0', 'c-1']);
  });

  it('reload 가 실패하면 목록을 비우고(처음 상태) 오류 코드를 남기며, fetchedAt 은 실패해도 찍는다', async () => {
    fetchMock.mockResolvedValueOnce(page('a', 30, 50)).mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce(page('b', 1, 1));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.items).toHaveLength(30));
    result.current.fetchedAt.current = null;
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() =>
      expect(result.current).toMatchObject({ items: [], total: 0, date: null, hasMore: false, loading: false, error: 'HTTP 500' }),
    );
    expect(result.current.fetchedAt.current).not.toBeNull();
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, error: null, total: 1 }));
  });

  it('첫 로딩이 네트워크 오류면 error=NETWORK 이고 목록은 비어 있다', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toBe('NETWORK'));
    expect(result.current).toMatchObject({ loading: false, items: [], total: 0, date: null, hasMore: false });
  });

  it('loadMore 는 다음 30개를 이어 붙이고(겹친 id 제외), 끝에 닿으면 hasMore=false 이며 더 부르지 않는다', async () => {
    const more = deferred<GroupRanking>();
    fetchMock.mockResolvedValueOnce(page('a', 30, 40)).mockReturnValueOnce(more.promise);
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    let p!: Promise<void>;
    await act(async () => {
      p = result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith('theme', '1d', 'chg', 30, 30);
    await act(async () => {
      more.resolve({ date: '2026-11-26', total: 40, items: [item('a-29'), ...page('a', 10, 40, '2026-11-26', 30).items] });
      await p;
    });
    await waitFor(() => expect(result.current.items).toHaveLength(40));
    expect(result.current).toMatchObject({ loadingMore: false, moreFailed: false, hasMore: false, total: 40 });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loadMore 가 실패하면 목록은 두고 moreFailed, 다시 시도해 성공하면 지운다', async () => {
    fetchMock
      .mockResolvedValueOnce(page('a', 30, 60))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(page('a', 30, 60, '2026-11-26', 30));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current).toMatchObject({ loadingMore: false, moreFailed: true, error: null }));
    expect(result.current.items).toHaveLength(30);
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(60));
    expect(result.current).toMatchObject({ loadingMore: false, moreFailed: false, hasMore: false });
  });

  it('조건을 바꾼 뒤 늦게 온 loadMore 응답은 버린다', async () => {
    const more = deferred<GroupRanking>();
    fetchMock.mockResolvedValueOnce(page('a', 30, 60)).mockReturnValueOnce(more.promise).mockResolvedValueOnce(page('b', 2, 2));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    let p!: Promise<void>;
    await act(async () => {
      p = result.current.loadMore();
    });
    await act(async () => result.current.setSort('value'));
    await waitFor(() => expect(ids(result.current.items)).toEqual(['b-0', 'b-1']));
    await act(async () => {
      more.resolve(page('a', 30, 60, '2026-11-26', 30));
      await p;
    });
    await flush();
    expect(ids(result.current.items)).toEqual(['b-0', 'b-1']);
    expect(result.current).toMatchObject({ loading: false, loadingMore: false, moreFailed: false, total: 2 });
  });

  it('refresh 는 실패하면 throw 하고 더 불러온 목록·오류 표시는 그대로, 성공하면 첫 페이지로 교체한다', async () => {
    fetchMock
      .mockResolvedValueOnce(page('a', 30, 60))
      .mockResolvedValueOnce(page('a', 30, 60, '2026-11-26', 30))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(page('n', 30, 70));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(60));
    await act(async () => {
      await expect(result.current.refresh()).rejects.toBeTruthy();
    });
    await flush();
    expect(result.current).toMatchObject({ loading: false, error: null, loadingMore: false });
    expect(result.current.items).toHaveLength(60);
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.total).toBe(70));
    expect(result.current.items).toHaveLength(30);
    expect(result.current.items[0].id).toBe('n-0');
    expect(result.current).toMatchObject({ loading: false, error: null, hasMore: true });
  });

  it('더 불러오는 중에 refresh 가 실패하면 목록은 두고 더 불러오기 표시만 끄며, 늦은 더 불러오기 응답은 버린다', async () => {
    const more = deferred<GroupRanking>();
    fetchMock.mockResolvedValueOnce(page('a', 30, 60)).mockReturnValueOnce(more.promise).mockRejectedValueOnce(httpError(502));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    let p!: Promise<void>;
    await act(async () => {
      p = result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);
    await act(async () => {
      await expect(result.current.refresh()).rejects.toBeTruthy();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current).toMatchObject({ error: null, moreFailed: false });
    await act(async () => {
      more.resolve(page('a', 30, 60, '2026-11-26', 30));
      await p;
    });
    await flush();
    expect(result.current.items).toHaveLength(30);
  });

  it('조건을 바꿔 받는 중에 refresh 가 실패하면 목록을 비우고 오류 코드, loading 해제, throw — 늦게 온 조건 응답은 버린다', async () => {
    const next = deferred<GroupRanking>();
    fetchMock.mockResolvedValueOnce(page('a', 3, 3)).mockReturnValueOnce(next.promise).mockRejectedValueOnce(httpError(502));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    await act(async () => result.current.setPeriod('5d'));
    await waitFor(() => expect(result.current.loading).toBe(true));
    await act(async () => {
      await expect(result.current.refresh()).rejects.toBeTruthy();
    });
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, error: 'HTTP 502', items: [], total: 0, date: null }));
    await act(async () => next.resolve(page('b', 1, 1)));
    await flush();
    expect(result.current).toMatchObject({ loading: false, error: 'HTTP 502', items: [] });
  });

  it('silentRefresh 는 기준일이 같으면 더 불러온 목록을 그대로 두고, 바뀌었으면 첫 페이지로 교체한다', async () => {
    fetchMock
      .mockResolvedValueOnce(page('a', 30, 60))
      .mockResolvedValueOnce(page('a', 30, 60, '2026-11-26', 30))
      .mockResolvedValueOnce(page('z', 30, 99))
      .mockResolvedValueOnce(page('n', 30, 80, '2026-11-27'));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(60));
    await act(async () => {
      await result.current.silentRefresh();
    });
    await flush();
    expect(result.current.items).toHaveLength(60);
    expect(result.current).toMatchObject({ total: 60, date: '2026-11-26', hasMore: false });
    await act(async () => {
      await result.current.silentRefresh();
    });
    await waitFor(() => expect(result.current.date).toBe('2026-11-27'));
    expect(result.current.items).toHaveLength(30);
    expect(result.current).toMatchObject({ total: 80, hasMore: true, loading: false, error: null });
  });

  it('silentRefresh 는 실패하면 throw 하고 상태 그대로, 오류 화면에서 성공하면 목록을 채우고 오류를 지운다', async () => {
    fetchMock.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('y')).mockResolvedValueOnce(page('a', 2, 2));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toBe('NETWORK'));
    await act(async () => {
      await expect(result.current.silentRefresh()).rejects.toBeTruthy();
    });
    await flush();
    expect(result.current).toMatchObject({ error: 'NETWORK', items: [] });
    await act(async () => {
      await result.current.silentRefresh();
    });
    await waitFor(() => expect(result.current).toMatchObject({ error: null, total: 2, loading: false }));
  });

  it('기준일이 바뀐 silentRefresh 는 진행 중인 더 불러오기 응답을 버린다', async () => {
    const more = deferred<GroupRanking>();
    fetchMock
      .mockResolvedValueOnce(page('a', 30, 60))
      .mockReturnValueOnce(more.promise)
      .mockResolvedValueOnce(page('n', 30, 80, '2026-11-27'));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    let p!: Promise<void>;
    await act(async () => {
      p = result.current.loadMore();
    });
    await act(async () => {
      await result.current.silentRefresh();
    });
    await waitFor(() => expect(result.current.date).toBe('2026-11-27'));
    expect(result.current).toMatchObject({ loadingMore: false, moreFailed: false });
    await act(async () => {
      more.resolve(page('a', 30, 60, '2026-11-26', 30));
      await p;
    });
    await flush();
    expect(result.current.items).toHaveLength(30);
    expect(result.current.items[0].id).toBe('n-0');
  });

  it('[의도된 차이] 30초 안에 같은 조건으로 돌아오면 저장된 결과를 다시 받지 않고 바로 보여 준다(전환 전 코드에선 실패가 정상)', async () => {
    fetchMock.mockResolvedValueOnce(page('a', 3, 3)).mockResolvedValueOnce(page('b', 1, 1)).mockResolvedValue(page('z', 9, 9));
    const { result } = await renderHook(() => useGroupRanking('theme'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    await act(async () => result.current.setPeriod('5d'));
    await waitFor(() => expect(ids(result.current.items)).toEqual(['b-0']));
    await act(async () => result.current.setPeriod('1d'));
    expect(result.current).toMatchObject({ period: '1d', loading: false, total: 3 });
    expect(ids(result.current.items)).toEqual(['a-0', 'a-1', 'a-2']);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

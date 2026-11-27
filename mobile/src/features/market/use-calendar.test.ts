/**
 * useCalendar 동작 고정 테스트 — 내부를 TanStack Query 로 바꾸기 전 코드에서 먼저 통과시키고,
 * 바꾼 뒤에도 그대로 통과해야 한다(입출력·동작 불변). 마지막 테스트 하나만 의도된 차이(30초 안 같은 조건 복귀 시 저장된 결과)다.
 */
import { createElement, type ReactNode } from 'react';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { makeQueryClient } from '@/lib/query-client';

import { fetchMarketCalendar } from './api';
import type { CalendarEvent } from './types';
import { useCalendar } from './use-calendar';

jest.mock('./api', () => ({ fetchMarketCalendar: jest.fn() }));
jest.mock('@/features/game/lib/format', () => ({
  ...jest.requireActual('@/features/game/lib/format'),
  kstDateString: () => '2026-11-27',
}));

const fetchMock = fetchMarketCalendar as jest.MockedFunction<typeof fetchMarketCalendar>;

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

const ev = (date: string, title: string): CalendarEvent =>
  ({ date, title, category: '공모주', ticker: null, name: null, detail: null }) as unknown as CalendarEvent;

const PAST = ev('2026-11-25', '지난');
const UP = ev('2026-11-27', '오늘');
const IPO = ev('2026-12-01', '공모');
const ECO = ev('2026-12-02', '지표');

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  qc?.clear();
});

describe('useCalendar', () => {
  it('처음엔 loading 이고, 지난 7일~앞으로 60일·분류 없음으로 받아 지난/앞으로로 나누고 fetchedAt 을 찍는다', async () => {
    const first = deferred<CalendarEvent[]>();
    fetchMock.mockReturnValueOnce(first.promise);
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    expect(result.current).toMatchObject({ loading: true, error: null, past: [], upcoming: [], category: '전체', today: '2026-11-27' });
    expect(result.current.fetchedAt.current).toBeNull();
    await act(async () => first.resolve([PAST, UP]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ past: [PAST], upcoming: [UP], error: null });
    expect(result.current.fetchedAt.current).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('2026-11-20', '2027-01-26', undefined);
  });

  it('분류를 바꾸면 새 분류로 다시 받고, 받는 동안은 이전 목록을 둔 채 loading 이다', async () => {
    const ipo = deferred<CalendarEvent[]>();
    fetchMock.mockResolvedValueOnce([PAST, UP]).mockReturnValueOnce(ipo.promise);
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.upcoming).toEqual([UP]));
    await act(async () => result.current.setCategory('공모주'));
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current).toMatchObject({ category: '공모주', past: [PAST], upcoming: [UP], error: null });
    expect(fetchMock).toHaveBeenLastCalledWith('2026-11-20', '2027-01-26', '공모주');
    await act(async () => ipo.resolve([IPO]));
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, past: [], upcoming: [IPO] }));
  });

  it('분류를 빠르게 바꾸면 늦게 온 옛 분류 응답은 버리고 마지막 분류 결과만 남긴다', async () => {
    const ipo = deferred<CalendarEvent[]>();
    const eco = deferred<CalendarEvent[]>();
    fetchMock.mockResolvedValueOnce([UP]).mockReturnValueOnce(ipo.promise).mockReturnValueOnce(eco.promise);
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.upcoming).toEqual([UP]));
    await act(async () => result.current.setCategory('공모주'));
    await act(async () => result.current.setCategory('경제지표'));
    await act(async () => eco.resolve([ECO]));
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, upcoming: [ECO] }));
    await act(async () => ipo.resolve([IPO]));
    await flush();
    expect(result.current).toMatchObject({ category: '경제지표', loading: false, upcoming: [ECO], error: null });
  });

  it('reload 가 실패하면 목록을 비우고 오류 코드를 남기며, fetchedAt 은 실패해도 찍는다. 다시 성공하면 오류가 지워진다', async () => {
    fetchMock.mockResolvedValueOnce([PAST, UP]).mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce([UP]);
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.upcoming).toEqual([UP]));
    result.current.fetchedAt.current = null;
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, error: 'HTTP 500', past: [], upcoming: [] }));
    expect(result.current.fetchedAt.current).not.toBeNull();
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, error: null, upcoming: [UP] }));
  });

  it('첫 로딩이 네트워크 오류면 error=NETWORK 이고 목록은 비어 있다', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toBe('NETWORK'));
    expect(result.current).toMatchObject({ loading: false, past: [], upcoming: [] });
  });

  it('refresh(당겨서 새로고침)는 실패하면 throw 하고 보이던 목록·오류 표시는 그대로, 성공하면 교체한다', async () => {
    fetchMock.mockResolvedValueOnce([UP]).mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce([PAST, IPO]);
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.upcoming).toEqual([UP]));
    await act(async () => {
      await expect(result.current.refresh()).rejects.toBeTruthy();
    });
    await flush();
    expect(result.current).toMatchObject({ loading: false, error: null, upcoming: [UP] });
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, error: null, past: [PAST], upcoming: [IPO] }));
  });

  it('오류 화면에서 refresh 가 성공하면 오류가 지워진다', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([UP]);
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toBe('NETWORK'));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, error: null, upcoming: [UP] }));
  });

  it('분류를 바꿔 받는 중에 refresh 가 실패하면 목록을 비우고 오류 코드, loading 해제, throw — 늦게 온 분류 응답은 버린다', async () => {
    const ipo = deferred<CalendarEvent[]>();
    fetchMock.mockResolvedValueOnce([PAST, UP]).mockReturnValueOnce(ipo.promise).mockRejectedValueOnce(httpError(502));
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.upcoming).toEqual([UP]));
    await act(async () => result.current.setCategory('공모주'));
    await waitFor(() => expect(result.current.loading).toBe(true));
    await act(async () => {
      await expect(result.current.refresh()).rejects.toBeTruthy();
    });
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, error: 'HTTP 502', past: [], upcoming: [] }));
    await act(async () => ipo.resolve([IPO]));
    await flush();
    expect(result.current).toMatchObject({ loading: false, error: 'HTTP 502', past: [], upcoming: [] });
  });

  it('silentRefresh 는 실패하면 throw 하고 상태 그대로, 성공하면 목록을 바꾸고 오류를 지운다', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('y'))
      .mockResolvedValueOnce([IPO]);
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toBe('NETWORK'));
    await act(async () => {
      await expect(result.current.silentRefresh()).rejects.toBeTruthy();
    });
    await flush();
    expect(result.current).toMatchObject({ loading: false, error: 'NETWORK', upcoming: [] });
    await act(async () => {
      await result.current.silentRefresh();
    });
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, error: null, upcoming: [IPO] }));
  });

  it('reload 전에 시작한 silentRefresh 응답은 버린다(늦게 온 옛 응답이 새 결과를 덮지 않음)', async () => {
    const slow = deferred<CalendarEvent[]>();
    fetchMock.mockResolvedValueOnce([UP]).mockReturnValueOnce(slow.promise).mockResolvedValueOnce([IPO]);
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.upcoming).toEqual([UP]));
    let silent!: Promise<void>;
    await act(async () => {
      silent = result.current.silentRefresh();
    });
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current.upcoming).toEqual([IPO]));
    await act(async () => {
      slow.resolve([ECO]);
      await silent;
    });
    await flush();
    expect(result.current.upcoming).toEqual([IPO]);
  });

  it('[의도된 차이] 30초 안에 같은 분류로 돌아오면 저장된 결과를 다시 받지 않고 바로 보여 준다(전환 전 코드에선 실패가 정상)', async () => {
    const ipo = deferred<CalendarEvent[]>();
    fetchMock.mockResolvedValueOnce([PAST, UP]).mockReturnValueOnce(ipo.promise).mockResolvedValue([ECO]);
    const { result } = await renderHook(() => useCalendar(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.upcoming).toEqual([UP]));
    await act(async () => result.current.setCategory('공모주'));
    await act(async () => ipo.resolve([IPO]));
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, upcoming: [IPO] }));
    await act(async () => result.current.setCategory('전체'));
    expect(result.current).toMatchObject({ category: '전체', loading: false, past: [PAST], upcoming: [UP] });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * useBlogList 동작 고정 테스트 — 내부를 TanStack Query 로 바꾸기 전 코드에서 먼저 통과시키고,
 * 바꾼 뒤에도 그대로 통과해야 한다(입출력·동작 불변). 화면 렌더 없이 renderHook 만 쓴다.
 * 맨 아래 '의도된 차이' 묶음은 Query 전환으로 새로 생기는 동작이라 전환 전 코드에서는 실패하는 게 정상이다.
 */
import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/lib/api';
import { makeQueryClient } from '@/lib/query-client';

import { fetchBlogList } from './api';
import type { BlogListResponse, BlogPost } from './types';
import { useBlogList } from './use-blog-list';

jest.mock('./api', () => ({ fetchBlogList: jest.fn() }));
const mockFetch = fetchBlogList as jest.MockedFunction<typeof fetchBlogList>;

const clients: ReturnType<typeof makeQueryClient>[] = [];
function wrapper() {
  const qc = makeQueryClient(); // 앱과 같은 기본값(staleTime 30초 등)
  clients.push(qc);
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

afterEach(() => {
  clients.splice(0).forEach((qc) => qc.clear());
  mockFetch.mockReset();
});

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

const post = (id: number): BlogPost => ({
  id, boardId: 1, title: `글${id}`, content: '', thumbnailUrl: null, authorId: null,
  viewCount: 0, featuredAt: null, createdAt: '2026-11-27', updatedAt: '2026-11-27',
});
const res = (ids: number[], page = 1, total = 100): BlogListResponse => ({ total, page, size: 20, items: ids.map(post) });
const ids = (data: BlogPost[]) => data.map((p) => p.id);

type Props = { boardId?: number | null; page?: number };
async function setup(initialProps: Props) {
  return renderHook((p: Props) => useBlogList({ boardId: p.boardId, page: p.page, size: 20 }), {
    wrapper: wrapper(),
    initialProps,
  });
}

describe('useBlogList', () => {
  it('처음엔 loading, 받으면 글·전체 수·응답 쪽 번호를 채운다', async () => {
    const d = deferred<BlogListResponse>();
    mockFetch.mockReturnValueOnce(d.promise);
    const { result } = await setup({ boardId: 3, page: 1 });
    expect(result.current).toMatchObject({ data: [], total: 0, page: 1, loading: true, error: null });
    await act(async () => d.resolve(res([1, 2], 1, 42)));
    await waitFor(() => expect(ids(result.current.data)).toEqual([1, 2]));
    expect(result.current).toMatchObject({ total: 42, page: 1, loading: false, error: null });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith({ boardId: 3, page: 1, size: 20 });
  });

  it('boardId=null 이면 활성 게시판 전체로 조회한다', async () => {
    mockFetch.mockResolvedValueOnce(res([7]));
    const { result } = await setup({ boardId: null, page: 2 });
    await waitFor(() => expect(ids(result.current.data)).toEqual([7]));
    expect(mockFetch).toHaveBeenCalledWith({ activeBoardsOnly: true, page: 2, size: 20 });
  });

  it('boardId 가 아직 없으면(undefined) 요청하지 않고 빈 목록·loading 으로 두며, 정해지면 그때 받는다', async () => {
    mockFetch.mockResolvedValueOnce(res([5]));
    const { result, rerender } = await setup({ boardId: undefined, page: 3 });
    await flush();
    expect(result.current).toMatchObject({ data: [], total: 0, page: 3, loading: true, error: null });
    await act(async () => {
      await result.current.reload();
      await result.current.refresh();
    });
    expect(mockFetch).not.toHaveBeenCalled();
    await rerender({ boardId: 1, page: 3 });
    await waitFor(() => expect(ids(result.current.data)).toEqual([5]));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('게시판을 바꾸면 다시 받고, 받는 동안은 이전 목록을 그대로 보여 준다', async () => {
    mockFetch.mockResolvedValueOnce(res([1, 2]));
    const { result, rerender } = await setup({ boardId: 1, page: 1 });
    await waitFor(() => expect(ids(result.current.data)).toEqual([1, 2]));
    const d = deferred<BlogListResponse>();
    mockFetch.mockReturnValueOnce(d.promise);
    await rerender({ boardId: 2, page: 1 });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(ids(result.current.data)).toEqual([1, 2]);
    expect(result.current.error).toBeNull();
    await act(async () => d.resolve(res([9], 1, 1)));
    await waitFor(() => expect(ids(result.current.data)).toEqual([9]));
    expect(result.current).toMatchObject({ total: 1, loading: false });
    expect(mockFetch).toHaveBeenLastCalledWith({ boardId: 2, page: 1, size: 20 });
  });

  it('쪽을 옮기면 다음 쪽을 받는 동안 이전 쪽(쪽 번호 포함)을 보여 주고, 받으면 바꾼다', async () => {
    mockFetch.mockResolvedValueOnce(res([1, 2], 1));
    const { result, rerender } = await setup({ boardId: 1, page: 1 });
    await waitFor(() => expect(ids(result.current.data)).toEqual([1, 2]));
    const d = deferred<BlogListResponse>();
    mockFetch.mockReturnValueOnce(d.promise);
    await rerender({ boardId: 1, page: 2 });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(ids(result.current.data)).toEqual([1, 2]);
    expect(result.current.page).toBe(1);
    await act(async () => d.resolve(res([21, 22], 2)));
    await waitFor(() => expect(ids(result.current.data)).toEqual([21, 22]));
    expect(result.current).toMatchObject({ page: 2, loading: false });
  });

  it('서버 오류면 목록을 비우고 total 0, 요청한 쪽 번호, "서버 오류 (상태)" 문구', async () => {
    mockFetch.mockResolvedValueOnce(res([1, 2], 1));
    const { result, rerender } = await setup({ boardId: 1, page: 1 });
    await waitFor(() => expect(ids(result.current.data)).toEqual([1, 2]));
    mockFetch.mockRejectedValueOnce(new ApiError(500, 'boom'));
    await rerender({ boardId: 1, page: 4 });
    await waitFor(() => expect(result.current.error).toBe('서버 오류 (500)'));
    expect(result.current).toMatchObject({ data: [], total: 0, page: 4, loading: false });
  });

  it('네트워크 오류면 blog 서비스 안내 문구', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    const { result } = await setup({ boardId: 1, page: 1 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('네트워크 오류 — blog 서비스(:8000)가 실행 중인지 확인하세요');
    expect(result.current.data).toEqual([]);
  });

  it('실패 뒤 조건을 바꾸면 빈 목록으로 loading(이전 오류는 지움), 받으면 채운다', async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(503, 'x'));
    const { result, rerender } = await setup({ boardId: 1, page: 1 });
    await waitFor(() => expect(result.current.error).toBe('서버 오류 (503)'));
    const d = deferred<BlogListResponse>();
    mockFetch.mockReturnValueOnce(d.promise);
    await rerender({ boardId: 2, page: 1 });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current).toMatchObject({ data: [], error: null });
    await act(async () => d.resolve(res([3])));
    await waitFor(() => expect(ids(result.current.data)).toEqual([3]));
  });

  it('[다시 시도](reload): 받는 동안 loading·오류 지움·빈 목록, 성공하면 채운다', async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, 'x'));
    const { result } = await setup({ boardId: 1, page: 1 });
    await waitFor(() => expect(result.current.error).toBe('서버 오류 (500)'));
    const d = deferred<BlogListResponse>();
    mockFetch.mockReturnValueOnce(d.promise);
    let p!: Promise<void>;
    await act(async () => {
      p = result.current.reload();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current).toMatchObject({ data: [], error: null });
    await act(async () => {
      d.resolve(res([8]));
      await p;
    });
    await waitFor(() => expect(ids(result.current.data)).toEqual([8]));
    expect(result.current).toMatchObject({ loading: false, error: null });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('reload 는 같은 조건이어도 다시 받는다(받는 동안 이전 목록 유지), 실패하면 목록을 비운다', async () => {
    mockFetch.mockResolvedValueOnce(res([1]));
    const { result } = await setup({ boardId: 1, page: 1 });
    await waitFor(() => expect(ids(result.current.data)).toEqual([1]));
    const d = deferred<BlogListResponse>();
    mockFetch.mockReturnValueOnce(d.promise);
    let p!: Promise<void>;
    await act(async () => {
      p = result.current.reload();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(ids(result.current.data)).toEqual([1]);
    await act(async () => {
      d.reject(new ApiError(502, 'x'));
      await p;
    });
    await waitFor(() => expect(result.current.error).toBe('서버 오류 (502)'));
    expect(result.current).toMatchObject({ data: [], total: 0, loading: false });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('당겨서 새로고침(refresh) 성공: loading 을 켜지 않고 목록만 바꾸며, 오류 화면도 지운다', async () => {
    mockFetch.mockRejectedValueOnce(new ApiError(500, 'x'));
    const { result } = await setup({ boardId: 1, page: 1 });
    await waitFor(() => expect(result.current.error).toBe('서버 오류 (500)'));
    const d = deferred<BlogListResponse>();
    mockFetch.mockReturnValueOnce(d.promise);
    let p!: Promise<void>;
    await act(async () => {
      p = result.current.refresh();
    });
    await flush();
    expect(result.current).toMatchObject({ loading: false, error: '서버 오류 (500)' });
    await act(async () => {
      d.resolve(res([4, 5], 1, 2));
      await p;
    });
    await waitFor(() => expect(ids(result.current.data)).toEqual([4, 5]));
    expect(result.current).toMatchObject({ total: 2, loading: false, error: null });
  });

  it('refresh 실패: throw 하고 화면 상태(목록·오류 없음)는 그대로', async () => {
    mockFetch.mockResolvedValueOnce(res([1, 2]));
    const { result } = await setup({ boardId: 1, page: 1 });
    await waitFor(() => expect(ids(result.current.data)).toEqual([1, 2]));
    mockFetch.mockRejectedValueOnce(new ApiError(500, 'x'));
    let thrown: unknown = null;
    await act(async () => {
      await result.current.refresh().catch((e: unknown) => {
        thrown = e;
      });
    });
    expect(thrown).toBeInstanceOf(ApiError);
    await flush();
    expect(ids(result.current.data)).toEqual([1, 2]);
    expect(result.current).toMatchObject({ loading: false, error: null, total: 100 });
  });

  describe('의도된 차이(Query 전환 후에만 통과)', () => {
    it('조건을 빠르게 바꾸면 늦게 온 옛 응답은 무시하고 마지막 조건 결과만 보여 준다', async () => {
      const d1 = deferred<BlogListResponse>();
      const d2 = deferred<BlogListResponse>();
      mockFetch.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
      const { result, rerender } = await setup({ boardId: 1, page: 1 });
      await rerender({ boardId: 2, page: 1 });
      await act(async () => d2.resolve(res([20])));
      await waitFor(() => expect(ids(result.current.data)).toEqual([20]));
      await act(async () => d1.resolve(res([10])));
      await flush();
      expect(ids(result.current.data)).toEqual([20]);
      expect(result.current.loading).toBe(false);
    });

    it('같은 조건으로 30초 안에 돌아오면 저장된 결과를 바로 보여 주고 다시 받지 않는다', async () => {
      mockFetch.mockResolvedValueOnce(res([1], 1)).mockResolvedValueOnce(res([21], 2));
      const { result, rerender } = await setup({ boardId: 1, page: 1 });
      await waitFor(() => expect(ids(result.current.data)).toEqual([1]));
      await rerender({ boardId: 1, page: 2 });
      await waitFor(() => expect(ids(result.current.data)).toEqual([21]));
      await rerender({ boardId: 1, page: 1 });
      expect(ids(result.current.data)).toEqual([1]);
      expect(result.current).toMatchObject({ page: 1, loading: false });
      await flush();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});

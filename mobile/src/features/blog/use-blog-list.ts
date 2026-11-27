import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api';

import { fetchBlogList } from './api';
import type { BlogListResponse } from './types';

type UseBlogListOptions = {
  /** 숫자=그 게시판, null=활성 게시판 전체, undefined=아직 정해지지 않음(요청하지 않음) */
  boardId?: number | null;
  page?: number;
  size?: number;
};

function listParams(boardId: number | null, page: number, size: number) {
  return boardId === null ? { activeBoardsOnly: true, page, size } : { boardId, page, size };
}

function failMessage(e: unknown): string {
  return e instanceof ApiError
    ? `서버 오류 (${e.status})`
    : '네트워크 오류 — blog 서비스(:8000)가 실행 중인지 확인하세요';
}

/**
 * 블로그 글 목록(게시판 필터 + 페이지네이션)을 불러오고 로딩/에러/재시도 상태를 제공한다.
 * 내부는 TanStack Query(['blogList', 게시판, 쪽, 크기]) — 입출력은 Query 도입 전과 같다(use-blog-list.test.ts).
 * - 조건(게시판·쪽)이 바뀌면 다시 받고, 받는 동안은 이전 목록을 보여 준다(도입 전과 같음). 실패하면 목록을 비운다
 * - 조건마다 결과가 따로 저장돼, 늦게 온 옛 조건 응답이 지금 목록을 덮지 않는다
 * - 같은 조건으로 30초(공용 staleTime) 안에 돌아오면 저장된 결과를 바로 보여 준다(도입 후 생긴 차이)
 * - refresh(당겨서 새로고침)는 Query 재조회가 아니라 직접 불러 성공할 때만 저장한다 — 실패는 throw, 화면 상태는 그대로
 */
export function useBlogList(options: UseBlogListOptions = {}) {
  const { boardId, page = 1, size = 20 } = options;
  const qc = useQueryClient();
  // boardId가 아직 정해지지 않은 경우(게시판 목록 로딩 중) 불필요한 요청을 보내지 않는다.
  const enabled = boardId !== undefined;
  const queryKey = useMemo(
    () => ['blogList', boardId === undefined ? 'pending' : boardId, page, size] as const,
    [boardId, page, size],
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchBlogList(listParams(boardId ?? null, page, size)),
    enabled,
    // 조건이 바뀌어 새로 받는 동안 이전 목록 유지 — 단 이전 조건이 실패(빈 목록)였으면 넘기지 않는다
    placeholderData: (prev, prevQuery) => (prevQuery?.state.status === 'error' ? undefined : prev),
  });

  const reload = useCallback(async () => {
    if (!enabled) return;
    await qc.refetchQueries({ queryKey, exact: true });
  }, [qc, queryKey, enabled]);

  /** 당겨서 새로고침 — 화면을 "불러오는 중"으로 바꾸지 않고, 성공하면 목록만 바꾼다(실패는 throw → 토스트). */
  const refresh = useCallback(async () => {
    if (boardId === undefined) return;
    const res = await fetchBlogList(listParams(boardId, page, size));
    qc.setQueryData<BlogListResponse>(queryKey, res);
  }, [qc, queryKey, boardId, page, size]);

  if (!enabled) {
    return { data: [], total: 0, page, loading: true, error: null, reload, refresh };
  }
  const fetching = query.fetchStatus === 'fetching';
  const failed = query.status === 'error';
  const res = failed ? undefined : query.data;
  return {
    data: res?.items ?? [],
    total: res?.total ?? 0,
    page: res?.page ?? page,
    loading: fetching,
    error: failed && !fetching ? failMessage(query.error) : null,
    reload,
    refresh,
  };
}

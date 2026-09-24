import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';

import { fetchBlogList } from './api';
import type { BlogPost } from './types';

type State = {
  data: BlogPost[];
  total: number;
  page: number;
  loading: boolean;
  error: string | null;
};

type UseBlogListOptions = {
  boardId?: number;
  page?: number;
  size?: number;
};

/** 블로그 글 목록(게시판 필터 + 페이지네이션)을 불러오고 로딩/에러/재시도 상태를 제공한다. */
export function useBlogList(options: UseBlogListOptions = {}) {
  const { boardId, page = 1, size = 20 } = options;
  const [state, setState] = useState<State>({ data: [], total: 0, page, loading: true, error: null });

  const load = useCallback(async () => {
    // boardId가 아직 정해지지 않은 경우(게시판 목록 로딩 중) 불필요한 요청을 보내지 않는다.
    if (boardId === undefined) {
      setState({ data: [], total: 0, page, loading: true, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetchBlogList({ boardId, page, size });
      setState({ data: res.items, total: res.total, page: res.page, loading: false, error: null });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `서버 오류 (${e.status})`
          : '네트워크 오류 — blog 서비스(:8000)가 실행 중인지 확인하세요';
      setState({ data: [], total: 0, page, loading: false, error: msg });
    }
  }, [boardId, page, size]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

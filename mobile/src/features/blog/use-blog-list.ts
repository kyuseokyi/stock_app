import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';

import { fetchBlogList } from './api';
import type { BlogPost } from './types';

type State = {
  data: BlogPost[];
  loading: boolean;
  error: string | null;
};

/** 블로그 글 목록을 불러오고 로딩/에러/재시도 상태를 제공한다. */
export function useBlogList(boardId?: number) {
  const [state, setState] = useState<State>({ data: [], loading: true, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetchBlogList({ boardId, size: 20 });
      setState({ data: res.items, loading: false, error: null });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `서버 오류 (${e.status})`
          : '네트워크 오류 — blog 서비스(:8000)가 실행 중인지 확인하세요';
      setState({ data: [], loading: false, error: msg });
    }
  }, [boardId]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';

import { fetchBlogList } from './api';
import type { BlogPost } from './types';

type State = {
  data: BlogPost[];
  loading: boolean;
  error: string | null;
};

/** 홈 추천 글(featured_at DESC)을 불러온다. */
export function useFeaturedPosts(size = 20) {
  const [state, setState] = useState<State>({ data: [], loading: true, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetchBlogList({ featured: true, size });
      setState({ data: res.items, loading: false, error: null });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `서버 오류 (${e.status})`
          : '네트워크 오류 — blog 서비스(:8000)가 실행 중인지 확인하세요';
      setState({ data: [], loading: false, error: msg });
    }
  }, [size]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

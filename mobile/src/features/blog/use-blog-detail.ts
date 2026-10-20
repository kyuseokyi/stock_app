import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';

import { fetchBlog } from './api';
import type { BlogPost } from './types';

type State = {
  data: BlogPost | null;
  loading: boolean;
  error: string | null;
};

/** 글 상세(id)를 불러오고 로딩/에러/재시도 상태를 제공한다. */
export function useBlogDetail(id: number) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) {
      setState({ data: null, loading: false, error: '잘못된 글 번호입니다' });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const post = await fetchBlog(id);
      setState({ data: post, loading: false, error: null });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `서버 오류 (${e.status})`
          : '네트워크 오류 — blog 서비스(:8000)가 실행 중인지 확인하세요';
      setState({ data: null, loading: false, error: msg });
    }
  }, [id]);

  /** 당겨서 새로고침 — 화면을 "불러오는 중"으로 바꾸지 않고, 성공하면 글만 바꾼다(실패는 throw → 토스트). */
  const refresh = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    const post = await fetchBlog(id);
    setState({ data: post, loading: false, error: null });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load, refresh };
}

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';

import { fetchBlog } from './api';
import type { BlogPost } from './types';

type State = {
  data: BlogPost | null;
  loading: boolean;
  error: string | null;
  /** 없는 글(404)·잘못된 번호 — 오류가 아니라 "글이 없음" 안내를 띄운다 */
  notFound: boolean;
};

/** 글 상세 실패 → 화면 상태. 404 는 오류가 아니라 '없는 글'(삭제됐거나 상용·개발 서버가 달라 번호가 없는 경우). */
export function blogDetailFailure(e: unknown): Pick<State, 'error' | 'notFound'> {
  if (e instanceof ApiError && e.status === 404) return { error: null, notFound: true };
  if (e instanceof ApiError) return { error: `잠시 후 다시 시도해 주세요 (오류 ${e.status})`, notFound: false };
  return { error: '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.', notFound: false };
}

/** 글 상세(id)를 불러오고 로딩/에러/재시도 상태를 제공한다. */
export function useBlogDetail(id: number) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null, notFound: false });

  const load = useCallback(async () => {
    if (!Number.isFinite(id)) {
      setState({ data: null, loading: false, error: null, notFound: true });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null, notFound: false }));
    try {
      const post = await fetchBlog(id);
      setState({ data: post, loading: false, error: null, notFound: false });
    } catch (e) {
      setState({ data: null, loading: false, ...blogDetailFailure(e) });
    }
  }, [id]);

  /** 당겨서 새로고침 — 화면을 "불러오는 중"으로 바꾸지 않고, 성공하면 글만 바꾼다(실패는 throw → 토스트). */
  const refresh = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    const post = await fetchBlog(id);
    setState({ data: post, loading: false, error: null, notFound: false });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load, refresh };
}

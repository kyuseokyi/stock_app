import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';

import { createComment, fetchComments } from './comments-api';
import type { Comment } from './types';

type State = {
  data: Comment[];
  loading: boolean;
  error: string | null;
};

/**
 * 글 상세 댓글 목록 + 작성. web client PostDetailPage와 동일 의미론:
 * 401(토큰 만료)·403(게시판 댓글 비활성)을 구분해 submitError로 노출한다.
 * 401은 http 클라이언트가 자동으로 로그아웃 처리(registerUnauthorizedHandler)하므로
 * 여기서는 메시지만 표시하면 된다.
 */
export function useComments(blogId: number) {
  const [state, setState] = useState<State>({ data: [], loading: true, error: null });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const load = useCallback(async () => {
    if (!Number.isFinite(blogId)) {
      setState({ data: [], loading: false, error: '잘못된 글 번호입니다' });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const comments = await fetchComments(blogId);
      setState({ data: comments, loading: false, error: null });
    } catch {
      setState({ data: [], loading: false, error: '댓글을 불러오지 못했습니다.' });
    }
  }, [blogId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = useCallback(
    async (content: string): Promise<boolean> => {
      const text = content.trim();
      if (!text) return false;
      setSubmitting(true);
      setSubmitError('');
      try {
        const created = await createComment(blogId, text);
        setState((s) => ({ ...s, data: [...s.data, created] }));
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setSubmitError('세션이 만료되었습니다. 다시 로그인해주세요.');
        } else if (e instanceof ApiError && e.status === 403) {
          setSubmitError('이 게시판은 댓글이 비활성화되어 있습니다.');
        } else {
          setSubmitError('댓글 등록에 실패했습니다.');
        }
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [blogId],
  );

  return { ...state, reload: load, submit, submitting, submitError };
}

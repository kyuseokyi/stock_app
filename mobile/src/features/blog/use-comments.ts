import { useCallback, useEffect, useState } from 'react';

import { useAuthStore } from '@/features/auth/store';
import { ApiError } from '@/lib/api';

import { commentErrorMessage } from './comment-actions';
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
 * 여기서는 메시지만 표시하면 된다. 403 은 코드(COMMENT_BANNED·TERMS_REQUIRED)별 문구, 코드 없으면 기존 문구.
 * 로그인·로그아웃(토큰 변화) 시 목록을 다시 받는다 — is_mine·차단 반영이 토큰마다 다르므로.
 */
export function useComments(blogId: number) {
  const [state, setState] = useState<State>({ data: [], loading: true, error: null });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // 토큰 값이 아닌 사용자 id — 토큰 갱신(리프레시)만으로는 다시 받지 않게
  const userId = useAuthStore((s) => (s.token ? (s.user?.id ?? null) : null));

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
    // userId: 로그인 사용자가 바뀌면 다시 받는다(본문에서 직접 쓰지 않음 — 토큰은 http 클라이언트가 부착)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blogId, userId]);

  /** 당겨서 새로고침 — 기존 댓글을 그대로 두고, 성공하면 바꾼다(실패는 throw → 토스트). */
  const refresh = useCallback(async () => {
    if (!Number.isFinite(blogId)) return;
    const comments = await fetchComments(blogId);
    setState({ data: comments, loading: false, error: null });
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
        setSubmitError(
          e instanceof ApiError
            ? commentErrorMessage('submit', e.status, e.body)
            : commentErrorMessage('submit', 500, undefined), // 네트워크 등 — 기존 기본 문구
        );
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [blogId],
  );

  return { ...state, reload: load, refresh, submit, submitting, submitError };
}

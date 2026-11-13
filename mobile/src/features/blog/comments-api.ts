import { blogApi } from '@/lib/api';

import type { ReportReason } from './comment-actions';
import type { BlockedUser, Comment } from './types';

// 서버(FastAPI) 원응답 형태(snake_case). backend/apps/blog/schemas.py CommentOut와 일치.
type RawComment = {
  id: number;
  post_id: number;
  author_id: number | null;
  author_name: string | null;
  content: string;
  created_at: string;
  updated_at: string;
  // 옛 서버 응답에는 없을 수 있어 선택 필드
  hidden?: boolean;
  is_mine?: boolean;
};

function toComment(r: RawComment): Comment {
  return {
    id: r.id,
    postId: r.post_id,
    authorId: r.author_id,
    authorName: r.author_name,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    hidden: r.hidden ?? false,
    isMine: r.is_mine ?? false,
  };
}

/** 댓글 목록 조회. GET /api/v1/blogs/{id}/comments (blog 서비스, 포트 8000, 토큰 선택 — 있으면 is_mine·차단 반영) */
export async function fetchComments(blogId: number): Promise<Comment[]> {
  const raw = await blogApi.get<RawComment[]>(`/api/v1/blogs/${blogId}/comments`);
  return raw.map(toComment);
}

/** 댓글 작성. POST /api/v1/blogs/{id}/comments (Bearer는 http 클라이언트가 자동 부착) */
export async function createComment(blogId: number, content: string): Promise<Comment> {
  const raw = await blogApi.post<RawComment>(`/api/v1/blogs/${blogId}/comments`, { content });
  return { ...toComment(raw), isMine: true }; // 방금 내가 쓴 댓글(응답에 is_mine 이 없어도)
}

/** 내 댓글 삭제. DELETE /api/v1/comments/{id} */
export async function deleteComment(commentId: number): Promise<void> {
  await blogApi.del<void>(`/api/v1/comments/${commentId}`);
}

/** 댓글 신고. POST /api/v1/comments/{id}/reports → { ok, hidden } */
export async function reportComment(
  commentId: number,
  body: { reason: ReportReason; detail?: string },
): Promise<{ ok: boolean; hidden: boolean }> {
  return blogApi.post<{ ok: boolean; hidden: boolean }>(`/api/v1/comments/${commentId}/reports`, body);
}

type RawBlock = { user_id: number; nickname: string | null; blocked_at: string };

/** 내 차단 목록. GET /api/v1/me/blocks */
export async function fetchBlocks(): Promise<BlockedUser[]> {
  const raw = await blogApi.get<RawBlock[]>('/api/v1/me/blocks');
  return raw.map((b) => ({ userId: b.user_id, nickname: b.nickname ?? null, blockedAt: b.blocked_at }));
}

/** 사용자 차단. POST /api/v1/me/blocks/{user_id} */
export async function blockUser(userId: number): Promise<void> {
  await blogApi.post<unknown>(`/api/v1/me/blocks/${userId}`);
}

/** 차단 해제. DELETE /api/v1/me/blocks/{user_id} (204) */
export async function unblockUser(userId: number): Promise<void> {
  await blogApi.del<void>(`/api/v1/me/blocks/${userId}`);
}

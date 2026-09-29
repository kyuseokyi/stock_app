import { blogApi } from '@/lib/api';

import type { Comment } from './types';

// 서버(FastAPI) 원응답 형태(snake_case). backend/apps/blog/schemas.py CommentOut와 일치.
type RawComment = {
  id: number;
  post_id: number;
  author_id: number | null;
  author_name: string | null;
  content: string;
  created_at: string;
  updated_at: string;
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
  };
}

/** 댓글 목록 조회. GET /api/v1/blogs/{id}/comments (blog 서비스, 포트 8000, 인증 불필요) */
export async function fetchComments(blogId: number): Promise<Comment[]> {
  const raw = await blogApi.get<RawComment[]>(`/api/v1/blogs/${blogId}/comments`);
  return raw.map(toComment);
}

/** 댓글 작성. POST /api/v1/blogs/{id}/comments (Bearer는 http 클라이언트가 자동 부착) */
export async function createComment(blogId: number, content: string): Promise<Comment> {
  const raw = await blogApi.post<RawComment>(`/api/v1/blogs/${blogId}/comments`, { content });
  return toComment(raw);
}

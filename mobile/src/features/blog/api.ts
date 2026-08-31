import { blogApi } from '@/lib/api';

import type { BlogListResponse, BlogPost } from './types';

// 서버(FastAPI) 원응답 형태(snake_case)
type RawBlog = {
  id: number;
  board_id: number;
  title: string;
  content: string;
  thumbnail_url: string | null;
  author_id: number | null;
  view_count: number;
  created_at: string;
  updated_at: string;
};

type RawBlogList = {
  total: number;
  page: number;
  size: number;
  items: RawBlog[];
};

function toBlogPost(r: RawBlog): BlogPost {
  return {
    id: r.id,
    boardId: r.board_id,
    title: r.title,
    content: r.content,
    thumbnailUrl: r.thumbnail_url,
    authorId: r.author_id,
    viewCount: r.view_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 글 목록 조회. GET /api/v1/blogs (blog 서비스, 포트 8000) */
export async function fetchBlogList(params?: {
  boardId?: number;
  page?: number;
  size?: number;
}): Promise<BlogListResponse> {
  const raw = await blogApi.get<RawBlogList>('/api/v1/blogs', {
    board_id: params?.boardId,
    page: params?.page,
    size: params?.size ?? 20,
  });
  return {
    total: raw.total,
    page: raw.page,
    size: raw.size,
    items: raw.items.map(toBlogPost),
  };
}

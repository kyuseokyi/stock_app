/** 블로그 도메인 타입(camelCase). 서버 snake_case는 api.ts에서 변환한다. */
export type BlogPost = {
  id: number;
  boardId: number;
  title: string;
  content: string; // HTML
  thumbnailUrl: string | null;
  authorId: number | null;
  viewCount: number;
  createdAt: string; // ISO
  updatedAt: string;
};

export type BlogListResponse = {
  total: number;
  page: number;
  size: number;
  items: BlogPost[];
};

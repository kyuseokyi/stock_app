/** 블로그 도메인 타입(camelCase). 서버 snake_case는 api.ts에서 변환한다. */
export type BlogPost = {
  id: number;
  boardId: number;
  title: string;
  content: string; // HTML
  thumbnailUrl: string | null;
  authorId: number | null;
  viewCount: number;
  featuredAt: string | null; // ISO, null이면 추천 아님
  createdAt: string; // ISO
  updatedAt: string;
};

export type BlogListResponse = {
  total: number;
  page: number;
  size: number;
  items: BlogPost[];
};

/** 댓글 도메인 타입(camelCase). 서버 snake_case는 comments-api.ts에서 변환한다. */
export type Comment = {
  id: number;
  postId: number;
  authorId: number | null;
  authorName: string | null;
  content: string;
  createdAt: string; // ISO
  updatedAt: string;
  /** 신고 누적으로 가려짐(내용·작성자 이름 비어 옴) */
  hidden: boolean;
  /** 로그인 사용자가 쓴 댓글(⋯ 메뉴: 삭제) */
  isMine: boolean;
};

/** 내가 차단한 사용자 */
export type BlockedUser = {
  userId: number;
  nickname: string | null;
  blockedAt: string;
};

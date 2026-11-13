import client from './client'
import type { BlockOut, BlogListOut, BlogOut, BoardOut, CommentOut, Id, ReportReason } from '../types/api'

// 게시판/게시글/댓글 조회 API + 댓글 작성·삭제·신고, 내 차단 목록
export const listBoards = async (): Promise<BoardOut[]> => {
  const { data } = await client.get<BoardOut[]>('/boards', { params: { only_active: true } })
  return data
}

interface ListBlogsParams {
  boardId?: number
  /** true 면 홈 추천 글만(featured_at 최신순) */
  featured?: boolean
  page?: number
  size?: number
}

export const listBlogs = async ({ boardId, featured, page = 1, size = 10 }: ListBlogsParams = {}): Promise<BlogListOut> => {
  const params: Record<string, number | boolean> = { page, size }
  if (boardId != null) params.board_id = boardId
  if (featured) params.featured = true
  const { data } = await client.get<BlogListOut>('/blogs', { params })
  return data // { total, page, size, items }
}

export const getBlog = async (id: Id): Promise<BlogOut> => {
  const { data } = await client.get<BlogOut>(`/blogs/${id}`)
  return data
}

export const listComments = async (blogId: Id): Promise<CommentOut[]> => {
  const { data } = await client.get<CommentOut[]>(`/blogs/${blogId}/comments`)
  return data
}

// 댓글 작성 (로그인 필요 — client 인터셉터가 Bearer 부착)
export const createComment = async (blogId: Id, content: string): Promise<CommentOut> => {
  const { data } = await client.post<CommentOut>(`/blogs/${blogId}/comments`, { content })
  return data
}

// 내 댓글 삭제 (본인만)
export const deleteComment = async (commentId: Id): Promise<void> => {
  await client.delete(`/comments/${commentId}`)
}

// 댓글 신고 — detail 은 기타(other)일 때만. 3명째 신고면 hidden=true
export const reportComment = async (
  commentId: Id,
  body: { reason: ReportReason; detail?: string },
): Promise<{ ok: boolean; hidden: boolean }> => {
  const { data } = await client.post<{ ok: boolean; hidden: boolean }>(`/comments/${commentId}/reports`, body)
  return data
}

// 내 차단 목록 / 차단 / 해제
export const listBlocks = async (): Promise<BlockOut[]> => {
  const { data } = await client.get<BlockOut[]>('/me/blocks')
  return data
}

export const blockUser = async (userId: Id): Promise<void> => {
  await client.post(`/me/blocks/${userId}`)
}

export const unblockUser = async (userId: Id): Promise<void> => {
  await client.delete(`/me/blocks/${userId}`)
}

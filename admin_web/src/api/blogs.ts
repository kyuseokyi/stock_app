import client from './client'
import type { BlogCreate, BlogListOut, BlogOut, BlogUpdate, Id } from '../types/api'

export interface ListBlogsParams {
  boardId?: number
  page?: number
  size?: number
}

// 블로그 게시글(blogs) API 모듈
export const listBlogs = async (
  { boardId, page = 1, size = 20 }: ListBlogsParams = {},
): Promise<BlogListOut> => {
  const params: Record<string, number> = { page, size }
  if (boardId != null) params.board_id = boardId
  const { data } = await client.get<BlogListOut>('/blogs', { params })
  return data // { total, page, size, items }
}

export const getBlog = async (id: Id): Promise<BlogOut> => {
  const { data } = await client.get<BlogOut>(`/blogs/${id}`)
  return data
}

export const createBlog = async (payload: BlogCreate): Promise<BlogOut> => {
  const { data } = await client.post<BlogOut>('/blogs', payload)
  return data
}

export const updateBlog = async (id: Id, payload: BlogUpdate): Promise<BlogOut> => {
  const { data } = await client.put<BlogOut>(`/blogs/${id}`, payload)
  return data
}

export const deleteBlog = async (id: Id): Promise<void> => {
  await client.delete(`/blogs/${id}`)
}

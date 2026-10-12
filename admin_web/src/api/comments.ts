import client from './client'
import type { CommentOut, Id } from '../types/api'

// 댓글(comments) API 모듈
export const listComments = async (blogId: Id): Promise<CommentOut[]> => {
  const { data } = await client.get<CommentOut[]>(`/blogs/${blogId}/comments`)
  return data // CommentOut[]
}

export const createComment = async (blogId: Id, content: string): Promise<CommentOut> => {
  const { data } = await client.post<CommentOut>(`/blogs/${blogId}/comments`, { content })
  return data
}

export const updateComment = async (commentId: Id, content: string): Promise<CommentOut> => {
  const { data } = await client.put<CommentOut>(`/comments/${commentId}`, { content })
  return data
}

export const deleteComment = async (commentId: Id): Promise<void> => {
  await client.delete(`/comments/${commentId}`)
}

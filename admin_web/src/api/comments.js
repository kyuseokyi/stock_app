import client from './client'

// 댓글(comments) API 모듈
export const listComments = async (blogId) => {
  const { data } = await client.get(`/blogs/${blogId}/comments`)
  return data // CommentOut[]
}

export const createComment = async (blogId, content) => {
  const { data } = await client.post(`/blogs/${blogId}/comments`, { content })
  return data
}

export const updateComment = async (commentId, content) => {
  const { data } = await client.put(`/comments/${commentId}`, { content })
  return data
}

export const deleteComment = async (commentId) => {
  await client.delete(`/comments/${commentId}`)
}

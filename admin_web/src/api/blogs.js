import client from './client'

// 블로그 게시글(blogs) API 모듈
export const listBlogs = async ({ boardId, page = 1, size = 20 } = {}) => {
  const params = { page, size }
  if (boardId != null) params.board_id = boardId
  const { data } = await client.get('/blogs', { params })
  return data // { total, page, size, items }
}

export const getBlog = async (id) => {
  const { data } = await client.get(`/blogs/${id}`)
  return data
}

export const createBlog = async (payload) => {
  const { data } = await client.post('/blogs', payload)
  return data
}

export const updateBlog = async (id, payload) => {
  const { data } = await client.put(`/blogs/${id}`, payload)
  return data
}

export const deleteBlog = async (id) => {
  await client.delete(`/blogs/${id}`)
}

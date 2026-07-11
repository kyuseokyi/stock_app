import client from './client'

// 게시판/게시글/댓글 조회 API (읽기 전용)
export const listBoards = async () => {
  const { data } = await client.get('/boards', { params: { only_active: true } })
  return data
}

export const listBlogs = async ({ boardId, page = 1, size = 10 } = {}) => {
  const params = { page, size }
  if (boardId != null) params.board_id = boardId
  const { data } = await client.get('/blogs', { params })
  return data // { total, page, size, items }
}

export const getBlog = async (id) => {
  const { data } = await client.get(`/blogs/${id}`)
  return data
}

export const listComments = async (blogId) => {
  const { data } = await client.get(`/blogs/${blogId}/comments`)
  return data
}

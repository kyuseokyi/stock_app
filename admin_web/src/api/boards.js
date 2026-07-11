import client from './client'

// 게시판(boards) API 모듈
export const listBoards = async () => {
  const { data } = await client.get('/boards')
  return data
}

export const createBoard = async (payload) => {
  const { data } = await client.post('/boards', payload)
  return data
}

export const updateBoard = async (id, payload) => {
  const { data } = await client.put(`/boards/${id}`, payload)
  return data
}

export const deleteBoard = async (id) => {
  await client.delete(`/boards/${id}`)
}

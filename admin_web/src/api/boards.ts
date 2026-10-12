import client from './client'
import type { BoardCreate, BoardOut, BoardUpdate, Id } from '../types/api'

// 게시판(boards) API 모듈
export const listBoards = async (): Promise<BoardOut[]> => {
  const { data } = await client.get<BoardOut[]>('/boards')
  return data
}

export const createBoard = async (payload: BoardCreate): Promise<BoardOut> => {
  const { data } = await client.post<BoardOut>('/boards', payload)
  return data
}

export const updateBoard = async (id: Id, payload: BoardUpdate): Promise<BoardOut> => {
  const { data } = await client.put<BoardOut>(`/boards/${id}`, payload)
  return data
}

export const deleteBoard = async (id: Id): Promise<void> => {
  await client.delete(`/boards/${id}`)
}

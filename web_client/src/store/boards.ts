import { create } from 'zustand'
import { listBoards } from '../api/blog'
import { withErrorCode } from '../lib/errorCode'
import type { BoardOut } from '../types/api'

interface BoardState {
  boards: BoardOut[]
  loaded: boolean
  error: string
  fetchBoards: () => Promise<void>
  boardName: (id: number) => string
}

// 활성 게시판 목록 전역 캐시 (헤더 탭 + 페이지 공유)
export const useBoardStore = create<BoardState>()((set, get) => ({
  boards: [],
  loaded: false,
  error: '',
  fetchBoards: async () => {
    if (get().loaded) return
    try {
      const boards = await listBoards()
      set({ boards, loaded: true, error: '' })
    } catch (err) {
      set({ error: withErrorCode('게시판을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', err) })
    }
  },
  boardName: (id) => get().boards.find((b) => b.id === id)?.name ?? '',
}))

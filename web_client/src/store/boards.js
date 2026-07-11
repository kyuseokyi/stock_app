import { create } from 'zustand'
import { listBoards } from '../api/blog'

// 활성 게시판 목록 전역 캐시 (헤더 탭 + 페이지 공유)
export const useBoardStore = create((set, get) => ({
  boards: [],
  loaded: false,
  error: '',
  fetchBoards: async () => {
    if (get().loaded) return
    try {
      const boards = await listBoards()
      set({ boards, loaded: true, error: '' })
    } catch {
      set({ error: '게시판을 불러오지 못했습니다. 백엔드(8000)가 실행 중인지 확인하세요.' })
    }
  },
  boardName: (id) => get().boards.find((b) => b.id === id)?.name ?? '',
}))

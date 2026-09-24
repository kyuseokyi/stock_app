import { create } from 'zustand';

import { fetchBoards } from './api';
import type { Board } from './types';

type BoardState = {
  boards: Board[];
  loaded: boolean;
  loading: boolean;
  error: string;
  /** 활성 게시판 목록을 최초 1회만 불러온다(이미 로드됐거나 로딩 중이면 skip). */
  load: () => Promise<void>;
  boardName: (id: number) => string;
};

// 활성 게시판 목록 전역 캐시 (블로그 탭 보드 선택 UI가 공유)
export const useBoardStore = create<BoardState>((set, get) => ({
  boards: [],
  loaded: false,
  loading: false,
  error: '',
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      const boards = await fetchBoards();
      set({ boards, loaded: true, loading: false, error: '' });
    } catch {
      set({ loading: false, error: '게시판을 불러오지 못했습니다. 백엔드(8000)가 실행 중인지 확인하세요.' });
    }
  },
  boardName: (id) => get().boards.find((b) => b.id === id)?.name ?? '',
}));

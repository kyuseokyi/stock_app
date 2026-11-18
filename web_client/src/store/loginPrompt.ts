import { create } from 'zustand'

// 전역 로그인 모달 상태 — 헤더 로그인 버튼·'내 펀드' 탭·홈 내 펀드 카드·직접 진입 안내 카드가 같은 모달 하나를 연다.
// 그리는 곳은 Layout 의 <LoginModal/> 하나뿐(모달이 겹쳐 뜨지 않게).

export interface LoginPromptOptions {
  /** 모달 제목 아래 안내 문구 — 없으면 LoginModal 기본 문구 */
  description?: string
  /** 로그인 성공 후 이동할 내부 경로 — 간편 로그인은 완료 화면이, 닉네임 로그인은 모달 onSuccess 가 이동 */
  returnTo?: string
}

interface LoginPromptState extends LoginPromptOptions {
  open: boolean
  show: (opts?: LoginPromptOptions) => void
  close: () => void
}

export const useLoginPromptStore = create<LoginPromptState>()((set) => ({
  open: false,
  description: undefined,
  returnTo: undefined,
  // 열 때마다 옵션을 새로 넣는다 — 이전에 '내 펀드'로 열었던 복귀 경로가 헤더 로그인에 남지 않게
  show: (opts = {}) => set({ open: true, description: opts.description, returnTo: opts.returnTo }),
  close: () => set({ open: false, description: undefined, returnTo: undefined }),
}))

export const openLogin = (opts?: LoginPromptOptions): void => useLoginPromptStore.getState().show(opts)

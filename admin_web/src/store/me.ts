import { create } from 'zustand'
import { getUser } from '../api/auth'
import type { UserOut } from '../types/api'

// 지금 로그인한 관리자(등급·권한 포함) — Layout 이 화면을 열 때 /auth/me 로 갱신한다
interface MeState {
  user: UserOut | null
  setUser: (u: UserOut | null) => void
}

export const useMeStore = create<MeState>()((set) => ({
  user: getUser(),
  setUser: (user) => set({ user }),
}))

import axios from 'axios'
import { create } from 'zustand'
import { deleteAccount as deleteAccountApi, guestLogin } from '../api/auth'
import type { TokenResponse, UserOut } from '../types/api'

// localStorage 키 (client.ts 인터셉터와 공유)
export const TOKEN_KEY = 'wc_token'
const USER_KEY = 'wc_user'

const readUser = (): UserOut | null => {
  try {
    // getItem 이 null 이면 JSON.parse(null) === null → || null 로 동일 처리(원본 JS 동작). `!` 는 타입 표기용.
    return (JSON.parse(localStorage.getItem(USER_KEY)!) as UserOut | null) || null
  } catch {
    return null
  }
}

interface AuthState {
  token: string | null
  user: UserOut | null
  login: (nickname: string) => Promise<UserOut>
  /** 이미 발급된 토큰(간편 로그인 교환 결과)을 저장 — login 과 같은 저장 경로 */
  loginWithToken: (res: TokenResponse) => UserOut
  logout: () => void
  /** 회원 탈퇴(DELETE /auth/me) 성공 시 로그아웃. 실패는 그대로 throw(401 이면 로그아웃 후 throw) */
  deleteAccount: () => Promise<void>
}

// 로그인 전역 상태. 게스트(닉네임)·간편 로그인(카카오·네이버) 모두 같은 키에 토큰+유저를 저장한다.
export const useAuthStore = create<AuthState>()((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: readUser(),

  login: async (nickname) => {
    const res = await guestLogin(nickname)
    return get().loginWithToken(res)
  },

  loginWithToken: ({ access_token, user }) => {
    localStorage.setItem(TOKEN_KEY, access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    set({ token: access_token, user })
    return user
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    set({ token: null, user: null })
  },

  deleteAccount: async () => {
    const { token } = get()
    if (!token) throw new Error('not logged in')
    try {
      await deleteAccountApi(token)
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 401) get().logout()
      throw e
    }
    get().logout()
  },
}))

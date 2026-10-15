import axios from 'axios'
import { create } from 'zustand'
import { deleteAccount as deleteAccountApi, guestLogin } from '../api/auth'
import type { TokenResponse, UserOut } from '../types/api'
import { showToast } from './toast'

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

/** 요청 Authorization 헤더("Bearer xxx")의 토큰 — 401 응답이 어떤 토큰으로 나간 요청인지 확인용 */
export const bearerToken = (header: unknown): string | null =>
  typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null

interface AuthState {
  token: string | null
  user: UserOut | null
  login: (nickname: string) => Promise<UserOut>
  /** 이미 발급된 토큰(간편 로그인 교환 결과)을 저장 — login 과 같은 저장 경로 */
  loginWithToken: (res: TokenResponse) => UserOut
  logout: () => void
  /**
   * 서버가 토큰을 거부(401·WS 4401)했을 때 로그아웃 — 거부된 토큰이 지금 토큰일 때만.
   * (재로그인 직후 이전 토큰으로 나간 요청의 401 이 새 세션을 지우지 않도록)
   */
  expireSession: (rejectedToken: string | null) => void
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

  expireSession: (rejectedToken) => {
    if (rejectedToken === null || rejectedToken !== get().token) return
    get().logout()
    // 여러 요청이 동시에 401 이어도 첫 호출만 여기까지 온다(이후엔 token=null) → 토스트 1회
    showToast('로그인이 만료되었어요. 다시 로그인해 주세요')
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

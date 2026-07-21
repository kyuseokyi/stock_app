import { create } from 'zustand'
import { guestLogin } from '../api/auth'

// localStorage 키 (client.js 인터셉터와 공유)
export const TOKEN_KEY = 'wc_token'
const USER_KEY = 'wc_user'

const readUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY)) || null
  } catch {
    return null
  }
}

// 임시 로그인(닉네임) 전역 상태. 이후 카카오/구글도 동일 store에 토큰만 저장하면 됨.
export const useAuthStore = create((set) => ({
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: readUser(),

  login: async (nickname) => {
    const { access_token, user } = await guestLogin(nickname)
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
}))

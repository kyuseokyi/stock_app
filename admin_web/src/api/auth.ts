import { authClient } from './client'
import type { TokenResponse, UserOut } from '../types/api'

// 인증 API + 로컬 토큰/유저 저장 관리 (인증 서비스 호출)
export const login = async (email: string, password: string): Promise<TokenResponse> => {
  const { data } = await authClient.post<TokenResponse>('/auth/login', { email, password })
  localStorage.setItem('token', data.access_token)
  localStorage.setItem('user', JSON.stringify(data.user))
  return data
}

export const logout = (): void => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export const getToken = (): string | null => localStorage.getItem('token')

export const getUser = (): UserOut | null => {
  const raw = localStorage.getItem('user')
  return raw ? (JSON.parse(raw) as UserOut) : null
}

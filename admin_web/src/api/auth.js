import { authClient } from './client'

// 인증 API + 로컬 토큰/유저 저장 관리 (인증 서비스 호출)
export const login = async (email, password) => {
  const { data } = await authClient.post('/auth/login', { email, password })
  localStorage.setItem('token', data.access_token)
  localStorage.setItem('user', JSON.stringify(data.user))
  return data
}

export const logout = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export const getToken = () => localStorage.getItem('token')

export const getUser = () => {
  const raw = localStorage.getItem('user')
  return raw ? JSON.parse(raw) : null
}

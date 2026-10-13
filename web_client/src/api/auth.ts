import axios from 'axios'
import { AUTH_BASE_URL as authURL } from '../config'
import type { TokenResponse } from '../types/api'

// 인증 서비스 base URL (auth 8001) — 빌드 타임 주입, 폴백/fail-fast 는 ../config

const authClient = axios.create({
  baseURL: authURL,
  headers: { 'Content-Type': 'application/json' },
})

// 임시 로그인 — 닉네임으로 게스트 계정 발급(카카오/구글 도입 전)
export const guestLogin = async (nickname: string): Promise<TokenResponse> => {
  const { data } = await authClient.post<TokenResponse>('/auth/guest', { nickname })
  return data // { access_token, token_type, user }
}

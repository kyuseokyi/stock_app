import axios from 'axios'
import { AUTH_BASE_URL as authURL } from '../config'
import type { SocialProvider, SocialProviders, TokenResponse } from '../types/api'

// 인증 서비스 base URL (auth 8001) — 빌드 타임 주입, 폴백/fail-fast 는 ../config

const authClient = axios.create({
  baseURL: authURL,
  headers: { 'Content-Type': 'application/json' },
})

// 임시 로그인 — 닉네임으로 게스트 계정 발급(개발·테스트용, ENABLE_GUEST_LOGIN 일 때만 노출)
export const guestLogin = async (nickname: string): Promise<TokenResponse> => {
  const { data } = await authClient.post<TokenResponse>('/auth/guest', { nickname })
  return data // { access_token, token_type, user }
}

// ---- 간편 로그인(카카오·네이버) ----
// 흐름: 브라우저를 start URL 로 이동 → 공급자 → auth 콜백 → /auth/complete?code=… → exchange

/** 브라우저 이동용 시작 URL(axios 아님 — 페이지 전체 이동) */
export const socialStartUrl = (provider: SocialProvider): string =>
  `${authURL.replace(/\/$/, '')}/auth/social/${provider}/start?client=web`

/** 공급자별 활성 여부(키 미설정 공급자는 false → 버튼 숨김) */
export const getSocialProviders = async (): Promise<SocialProviders> => {
  const { data } = await authClient.get<Partial<SocialProviders>>('/auth/social/providers')
  return { kakao: data.kakao === true, naver: data.naver === true }
}

/** 일회용 교환 코드 → 서비스 JWT(게스트 로그인과 같은 TokenResponse) */
export const exchangeSocialCode = async (code: string): Promise<TokenResponse> => {
  const { data } = await authClient.post<TokenResponse>('/auth/social/exchange', { code })
  return data
}

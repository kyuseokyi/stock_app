import axios from 'axios'
import { GAME_API_URL } from '../config'
import { installRetry } from '../lib/retry'
import { TOKEN_KEY, bearerToken, reasonFromBody, useAuthStore } from '../store/auth'

// trading_game(8003) 클라이언트. GAME_API_URL 미설정(운영 빌드)이면 null → 게임 화면이 "준비 중"으로 처리.
// 401(토큰 만료/무효) → 블로그 client 와 같이 로그아웃(헤더 닉네임이 남지 않게). 안내 토스트는 화면이 띄운다.
export const gameClient = GAME_API_URL
  ? axios.create({ baseURL: GAME_API_URL, headers: { 'Content-Type': 'application/json' } })
  : null

if (gameClient) installRetry(gameClient) // 조회(GET 시즌·랭킹 등)만 재시도 — 주문·청산(POST)은 절대 다시 보내지 않음

gameClient?.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

gameClient?.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      useAuthStore.getState().expireSession(bearerToken(err.config?.headers?.Authorization), reasonFromBody(err.response?.data))
    }
    return Promise.reject(err)
  },
)

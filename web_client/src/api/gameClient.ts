import axios from 'axios'
import { GAME_API_URL } from '../config'
import { TOKEN_KEY } from '../store/auth'

// trading_game(8003) 클라이언트. GAME_API_URL 미설정(운영 빌드)이면 null → 게임 화면이 "준비 중"으로 처리.
// 401 시 토큰을 지우지 않는다(블로그 client 와 달리) — 화면에서 재로그인 안내만.
export const gameClient = GAME_API_URL
  ? axios.create({ baseURL: GAME_API_URL, headers: { 'Content-Type': 'application/json' } })
  : null

gameClient?.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

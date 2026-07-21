import axios from 'axios'
import { TOKEN_KEY } from '../store/auth'

// 블로그 서비스 base URL (조회 + 인증형 댓글 작성)
const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

const client = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
})

// 로그인 상태면 Bearer 자동 부착(조회엔 무해, 작성엔 필수)
client.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 401(토큰 만료/무효) → 저장 토큰 정리(재로그인 유도)
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('wc_user')
    }
    return Promise.reject(err)
  },
)

export default client

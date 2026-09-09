import axios from 'axios'
import { API_BASE_URL as BLOG_BASE_URL, AUTH_BASE_URL } from '../config'

// 마이크로서비스별 base URL(빌드 타임 주입, 폴백/fail-fast 는 ../config 참조).
// 운영에서는 Cloudflare 터널이 각 서브도메인(blog/auth.haezean.com)으로 라우팅한다.

// 공통 인터셉터를 붙인 axios 인스턴스 팩토리
function makeClient(baseURL) {
  const instance = axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
  })

  // 요청마다 저장된 JWT 를 Authorization 헤더에 첨부
  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem('token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  // 401 응답 시 토큰 정리 후 로그인 화면으로
  instance.interceptors.response.use(
    (res) => res,
    (error) => {
      if (error.response?.status === 401) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login'
        }
      }
      return Promise.reject(error)
    },
  )

  return instance
}

// 블로그 서비스(게시판/게시글/댓글)
export const blogClient = makeClient(BLOG_BASE_URL)
// 인증 서비스(로그인/JWT)
export const authClient = makeClient(AUTH_BASE_URL)

export default blogClient

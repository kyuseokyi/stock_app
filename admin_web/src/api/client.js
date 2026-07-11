import axios from 'axios'

// 마이크로서비스별 base URL. 각 서비스는 독립 포트로 실행되며,
// 운영에서는 Nginx 리버스 프록시가 /api/v1/* 를 각 서비스로 라우팅한다.
const BLOG_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'
const AUTH_BASE_URL =
  import.meta.env.VITE_AUTH_BASE_URL || 'http://localhost:8001/api/v1'

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

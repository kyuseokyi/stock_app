import axios from 'axios'

// 블로그 서비스 base URL (읽기 전용 조회)
const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

const client = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
})

export default client

import { Navigate, useLocation } from 'react-router-dom'
import { getToken } from '../api/auth'

// 토큰이 없으면 로그인 화면으로 리다이렉트하는 라우트 가드
export default function RequireAuth({ children }) {
  const location = useLocation()
  if (!getToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return children
}

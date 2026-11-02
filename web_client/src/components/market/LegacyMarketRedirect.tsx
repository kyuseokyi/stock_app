import { Navigate, useLocation } from 'react-router-dom'
import { legacyMarketPath } from '../../lib/marketRoutes'

// 스크리너에서 마켓으로 옮긴 화면의 옛 주소 — 공유 링크·즐겨찾기가 그대로 열리게 쿼리·해시까지 잇는다.
export default function LegacyMarketRedirect() {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={legacyMarketPath(pathname, search, hash) ?? '/market'} replace />
}

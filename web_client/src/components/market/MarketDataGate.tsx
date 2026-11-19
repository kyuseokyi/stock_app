import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useScreenerFeatures } from '../../hooks/useScreenerFeatures'
import { marketDataVisible } from '../../lib/marketAccess'

// 시세 비노출(A안) — 테마·업종처럼 시세로만 이루어진 화면은 주소로 바로 들어와도 시장 개요로 돌려보낸다.
// 판단값을 묻는 동안은 아무것도 그리지 않는다(막힌 화면이 잠깐 보였다 사라지지 않게).
export default function MarketDataGate({ children }: { children: ReactNode }) {
  const features = useScreenerFeatures()
  if (features === null) return null
  if (!marketDataVisible(features)) return <Navigate to="/market" replace />
  return <>{children}</>
}

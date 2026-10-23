import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useScreenerFeatures } from '../../hooks/useScreenerFeatures'
import type { ScreenerFeatures } from '../../api/screenerFeatures'

// 관리자 스위치로 막힌 스크리너 탭 — 주소(/screener/finder 등)로 바로 들어와도 주도주 탭으로 보낸다.
// 스위치를 묻는 동안은 아무것도 그리지 않는다(막힌 탭이 잠깐 보였다 사라지지 않게).
export default function ScreenerFeatureGate({ feature, children }: { feature: keyof ScreenerFeatures; children: ReactNode }) {
  const features = useScreenerFeatures()
  if (features === null) return null
  if (!features[feature]) return <Navigate to="/screener/leaders" replace />
  return <>{children}</>
}

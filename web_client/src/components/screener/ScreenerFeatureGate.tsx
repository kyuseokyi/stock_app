import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useScreenerFeatures } from '../../hooks/useScreenerFeatures'
import { stockTabGate, type StockTab } from '../../lib/screenerFeatures'

// 관리자 스위치로 막힌 스크리너 탭 — 주소(/screener/finder 등)로 바로 들어와도 돌려보낸다.
// 종목 찾기 전체(STOCK_FINDER)가 꺼졌으면 마켓으로, 그 탭만 꺼졌으면 주도주로.
// 스위치를 묻는 동안은 아무것도 그리지 않는다(막힌 탭이 잠깐 보였다 사라지지 않게).
export default function ScreenerFeatureGate({ feature, children }: { feature: StockTab; children: ReactNode }) {
  const gate = stockTabGate(useScreenerFeatures(), feature)
  if (gate === 'wait') return null
  if (gate !== 'ok') return <Navigate to={gate} replace />
  return <>{children}</>
}

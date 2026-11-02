import { Suspense } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import ScreenerNav from '../../components/screener/ScreenerNav'
import { useScreenerFeatures } from '../../hooks/useScreenerFeatures'
import { screenerMenuVisible } from '../../lib/screenerFeatures'

// 스크리너 공통 틀 — 한 줄 탭(주도주·조건검색·패턴) + 탭 화면.
// 종목 찾기 스위치가 꺼져 있으면(오류 포함) 메뉴와 같이 화면도 닫고 마켓으로 보낸다. 묻는 동안은 그리지 않는다.
export default function ScreenerLayout() {
  const features = useScreenerFeatures()
  const { search, hash } = useLocation()
  if (features === null) return null
  if (!screenerMenuVisible(features)) return <Navigate to={{ pathname: '/market', search, hash }} replace />
  return (
    <div className="space-y-3 sm:space-y-4">
      <ScreenerNav />
      <p className="text-xs text-ink-muted">ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</p>
      <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
        <Outlet />
      </Suspense>
    </div>
  )
}

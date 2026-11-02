import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import TabNav from '../../components/ui/TabNav'

// 마켓 공통 틀 — 한 줄 탭(개요 · 테마 · 업종 · 일정, 앱 마켓 탭과 같은 구성) + 탭 화면. 비로그인 공개.
const TABS = [
  { to: '/market', label: '개요' },
  { to: '/market/themes', label: '테마' },
  { to: '/market/sectors', label: '업종' },
  { to: '/market/calendar', label: '일정' },
]

export default function MarketLayout() {
  const pathname = useLocation().pathname.replace(/\/+$/, '')
  const isOverview = pathname === '/market'
  return (
    <div className="space-y-3 sm:space-y-4">
      <TabNav label="마켓" tabs={TABS.map((t) => ({ ...t, active: t.to === pathname }))} />
      {/* 개요는 제목 줄 바로 아래에 같은 안내를 직접 둔다 */}
      {!isOverview && <p className="text-xs text-ink-muted">ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</p>}
      <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
        <Outlet />
      </Suspense>
    </div>
  )
}

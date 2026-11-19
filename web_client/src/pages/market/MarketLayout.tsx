import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import TabNav from '../../components/ui/TabNav'
import { useScreenerFeatures } from '../../hooks/useScreenerFeatures'
import { marketDataVisible } from '../../lib/marketAccess'

// 마켓 공통 틀 — 한 줄 탭(개요 · 테마 · 업종 · 일정, 앱 마켓 탭과 같은 구성) + 탭 화면. 비로그인 공개.
// 테마·업종은 시세 열람(marketData)일 때만 보인다(A안 — 묻는 중·실패면 숨김). 개요·일정은 항상.
const TABS = [
  { to: '/market', label: '개요', market: false },
  { to: '/market/themes', label: '테마', market: true },
  { to: '/market/sectors', label: '업종', market: true },
  { to: '/market/calendar', label: '일정', market: false },
]

export default function MarketLayout() {
  const pathname = useLocation().pathname.replace(/\/+$/, '')
  const isOverview = pathname === '/market'
  const showMarket = marketDataVisible(useScreenerFeatures())
  const tabs = TABS.filter((t) => showMarket || !t.market)
  return (
    <div className="space-y-3 sm:space-y-4">
      <TabNav label="마켓" tabs={tabs.map(({ to, label }) => ({ to, label, active: to === pathname }))} />
      {/* 개요는 제목 줄 바로 아래에 같은 안내를 직접 둔다 */}
      {!isOverview && <p className="text-xs text-ink-muted">ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</p>}
      <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
        <Outlet />
      </Suspense>
    </div>
  )
}

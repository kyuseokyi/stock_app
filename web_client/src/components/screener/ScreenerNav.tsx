import { useLocation } from 'react-router-dom'
import TabNav from '../ui/TabNav'
import { useScreenerFeatures } from '../../hooks/useScreenerFeatures'
import { stockTabVisible, type StockTab } from '../../lib/screenerFeatures'

// 스크리너 탭 — 주도주·조건검색·패턴. 시장·테마·업종·일정은 마켓(/market)으로 옮겼다.
// 관리자 스위치가 켜진 탭만 보인다(관리자 > 스크리너 설정).
const TABS: { key: StockTab; label: string }[] = [
  { key: 'leaders', label: '주도주' },
  { key: 'finder', label: '조건검색' },
  { key: 'patterns', label: '패턴' },
]

export default function ScreenerNav() {
  const { pathname } = useLocation()
  const active = pathname.split('/')[2] ?? 'leaders'
  const features = useScreenerFeatures()
  return (
    <TabNav
      label="스크리너"
      tabs={TABS.filter((t) => stockTabVisible(features, t.key)).map((t) => ({
        to: `/screener/${t.key}`,
        label: t.label,
        active: t.key === active,
      }))}
    />
  )
}

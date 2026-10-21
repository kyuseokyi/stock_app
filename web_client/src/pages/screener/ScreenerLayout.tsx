import { Suspense } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { chipClass } from '../../components/ui/Chip'

// 스크리너 공통 틀 — 탭(시장·테마·업종·일정·주도주·조건검색) + 탭 화면. 탭마다 주소가 있어 새로고침·뒤로 가기·공유가 그대로 된다.
const TABS = [
  { to: 'market', label: '시장' },
  { to: 'themes', label: '테마' },
  { to: 'sectors', label: '업종' },
  { to: 'calendar', label: '일정' },
  { to: 'leaders', label: '주도주' },
  { to: 'finder', label: '조건검색' },
]

export default function ScreenerLayout() {
  return (
    <div className="space-y-3 sm:space-y-4">
      <nav aria-label="스크리너 탭" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-2">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => chipClass(isActive)}>
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <p className="text-xs text-ink-muted">ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</p>
      <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
        <Outlet />
      </Suspense>
    </div>
  )
}

import { NavLink } from 'react-router-dom'
import { useUiStore } from '../store/ui'

interface NavItem {
  to: string
  label: string
  icon: string
}
interface NavGroup {
  title: string
  items: NavItem[]
}

// 사이드바 메뉴 정의 (그룹 → 항목)
const NAV_GROUPS: NavGroup[] = [
  {
    title: '블로그 관리',
    items: [
      { to: '/boards', label: '게시판 관리', icon: '🗂️' },
      { to: '/blogs', label: '게시글 관리', icon: '📝' },
    ],
  },
  {
    title: '트레이딩 게임',
    items: [
      { to: '/game/coach', label: '데일리 코치', icon: '📣' },
      { to: '/game/academy', label: '아카데미 문항', icon: '🎓' },
      { to: '/game/quizzes', label: '퀴즈 관리', icon: '🧩' },
      { to: '/game/settings', label: '게임 설정', icon: '⚙️' },
    ],
  },
  {
    title: '시장 데이터',
    items: [
      { to: '/market/themes', label: '테마 보정', icon: '🏷️' },
      { to: '/market/status', label: '데이터 현황', icon: '🩺' },
      { to: '/market/verify', label: '데이터 검증', icon: '🔍' },
      { to: '/market/leaders', label: '주도주', icon: '🏆' },
      { to: '/market/screener', label: '스크리너 탭', icon: '🗂️' },
    ],
  },
  {
    title: '알림',
    items: [{ to: '/fund-notices', label: '펀드 리포트 알림', icon: '📣' }],
  },
  {
    title: '앱 관리',
    items: [{ to: '/app/versions', label: '앱 버전 & 업데이트', icon: '📱' }],
  },
  {
    title: '회원 관리',
    items: [{ to: '/members', label: '회원 목록', icon: '👥' }],
  },
  {
    title: '통계',
    items: [{ to: '/stats', label: '대시보드', icon: '📊' }],
  },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

function SidebarContent() {
  const closeSidebar = useUiStore((s) => s.closeSidebar)
  return (
    <nav className="flex flex-col gap-6 p-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {group.title}
          </p>
          <div className="flex flex-col gap-1">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={linkClass}
                onClick={closeSidebar}
              >
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

export default function Sidebar() {
  const { sidebarOpen, closeSidebar } = useUiStore()

  return (
    <>
      {/* 데스크톱: 고정 사이드바 */}
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white lg:block">
        <SidebarContent />
      </aside>

      {/* 모바일: 오버레이 드로어 */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeSidebar}
            aria-hidden="true"
          />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-slate-200 bg-white shadow-xl">
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  )
}

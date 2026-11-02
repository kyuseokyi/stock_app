import { Link } from 'react-router-dom'
import { useScreenerFeatures } from '../hooks/useScreenerFeatures'
import { visibleSections, type Section } from '../lib/navSections'

// 1차 메뉴 — 홈 · 마켓 · 스크리너(종목 찾기 스위치가 켜졌을 때만) · 커뮤니티 · 게임 · 내정보. 판정은 lib/navSections.
// 데스크톱(sm 이상)은 헤더 상단 메뉴, 모바일 폭은 화면 아래 고정 탭바(앱과 같은 자리).

// 아이콘 — 앱(Ionicons outline)과 비슷한 선 아이콘, currentColor
const icon = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    className="h-6 w-6"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
)

const ITEMS: { key: Section; to: string; label: string; icon: JSX.Element }[] = [
  { key: 'home', to: '/', label: '홈', icon: icon('M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z') },
  { key: 'market', to: '/market', label: '마켓', icon: icon('M3 17l6-6 4 4 8-8M15 7h6v6') },
  { key: 'screener', to: '/screener', label: '스크리너', icon: icon('M4 19h16M7 16V9M12 16V5M17 16v-4') },
  { key: 'community', to: '/community', label: '커뮤니티', icon: icon('M4 5h16v11H8l-4 4zM8 9h8M8 12h5') },
  {
    key: 'game',
    to: '/game',
    label: '게임',
    icon: icon('M6 8h12a4 4 0 0 1 0 8 3 3 0 0 1-2.4-1.2L14.5 13h-5l-1.1 1.8A3 3 0 0 1 6 16a4 4 0 0 1 0-8zM8 11v2M7 12h2M15.5 11.5h.01M17 13h.01'),
  },
  { key: 'me', to: '/me', label: '내정보', icon: icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0') },
]

/** 스위치에 맞는 메뉴 — 묻는 중·실패면 스크리너를 뺀다 */
function useNavItems() {
  const visible = visibleSections(useScreenerFeatures())
  return ITEMS.filter((it) => visible.includes(it.key))
}

const topClass = (active: boolean) =>
  `pb-1.5 text-base font-bold transition ${
    active ? 'border-b-2 border-accent text-ink' : 'text-ink-muted hover:text-ink'
  }`

/** 데스크톱 상단 메뉴(모바일 폭에서는 숨김 — 하단 탭바가 대신) */
export function TopNav({ section }: { section: Section | null }) {
  const items = useNavItems()
  return (
    <nav className="mt-3 hidden items-center gap-5 sm:flex">
      {items.map((it) => (
        <Link
          key={it.key}
          to={it.to}
          className={topClass(section === it.key)}
          aria-current={section === it.key ? 'page' : undefined}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  )
}

/** 모바일 폭 하단 고정 탭바(앱과 같은 배치). 높이 3.5rem + safe-area — 게임 주문바가 이 위에 붙는다 */
export function BottomTabBar({ section }: { section: Section | null }) {
  const items = useNavItems()
  return (
    // z-30: 모달(ui/Modal z-40)·토스트(z-50)가 탭바 위에 오도록. 같은 z-30 인 게임 주문바와는 위아래로 안 겹침
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <div className="mx-auto flex h-14 max-w-3xl">
        {items.map((it) => {
          const active = section === it.key
          return (
            <Link
              key={it.key}
              to={it.to}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                active ? 'text-accent' : 'text-ink-muted'
              }`}
            >
              {it.icon}
              {it.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

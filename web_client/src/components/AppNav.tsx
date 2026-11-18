import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useScreenerFeatures } from '../hooks/useScreenerFeatures'
import { FUND_LOGIN_DESCRIPTION, FUNDS_PATH, fundNavAction, isLoginGatedSection } from '../lib/fundGate'
import { visibleSections, type Section } from '../lib/navSections'
import { useAuthStore } from '../store/auth'
import { openLogin } from '../store/loginPrompt'

// 1차 메뉴 — 홈 · 내 펀드 · 블로그 · 게임 · 시장 (+ 스크리너: 종목 찾기 스위치가 켜졌을 때만). 판정은 lib/navSections.
// 내정보는 탭이 아니라 헤더 우측 버튼(Layout). '내 펀드'는 비로그인이면 이동을 막고 로그인 모달을 연다(lib/fundGate).
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

/** 내정보(사람) 아이콘 — 헤더 우측 내정보 버튼이 쓴다(예전 하단 '내정보' 탭 아이콘) */
export function ProfileIcon() {
  return icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0')
}

const ITEMS: { key: Section; to: string; label: string; icon: JSX.Element }[] = [
  { key: 'home', to: '/', label: '홈', icon: icon('M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z') },
  {
    key: 'funds',
    to: FUNDS_PATH,
    label: '내 펀드',
    icon: icon('M4 7a2 2 0 0 1 2-2h12v4M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14.5h.01'),
  },
  { key: 'community', to: '/community', label: '블로그', icon: icon('M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6') },
  {
    key: 'game',
    to: '/game',
    label: '게임',
    icon: icon('M6 8h12a4 4 0 0 1 0 8 3 3 0 0 1-2.4-1.2L14.5 13h-5l-1.1 1.8A3 3 0 0 1 6 16a4 4 0 0 1 0-8zM8 11v2M7 12h2M15.5 11.5h.01M17 13h.01'),
  },
  { key: 'market', to: '/market', label: '시장', icon: icon('M3 12h4l3-7 4 14 3-7h4') },
  { key: 'screener', to: '/screener', label: '스크리너', icon: icon('M4 19h16M7 16V9M12 16V5M17 16v-4') },
]

/** 스위치에 맞는 메뉴 — 묻는 중·실패면 스크리너를 뺀다 */
function useNavItems() {
  const visible = visibleSections(useScreenerFeatures())
  return ITEMS.filter((it) => visible.includes(it.key))
}

/** 탭 클릭 게이트 — '내 펀드'를 비로그인으로 누르면 이동을 막고 로그인 모달(성공 시 /me/funds). 링크(href)는 그대로 둬 새 탭 열기는 직접 진입 안내 카드로 간다 */
function useGatedClick() {
  const loggedIn = useAuthStore((s) => s.user !== null)
  return (key: Section) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isLoginGatedSection(key) || fundNavAction(loggedIn) === 'navigate') return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return // 새 탭·창 열기는 그대로(직접 진입 안내 카드로)
    e.preventDefault()
    openLogin({ description: FUND_LOGIN_DESCRIPTION, returnTo: FUNDS_PATH })
  }
}

const topClass = (active: boolean) =>
  `pb-1.5 text-base font-bold transition ${
    active ? 'border-b-2 border-accent text-ink' : 'text-ink-muted hover:text-ink'
  }`

/** 데스크톱 상단 메뉴(모바일 폭에서는 숨김 — 하단 탭바가 대신) */
export function TopNav({ section }: { section: Section | null }) {
  const items = useNavItems()
  const gated = useGatedClick()
  return (
    <nav className="mt-3 hidden items-center gap-5 sm:flex">
      {items.map((it) => (
        <Link
          key={it.key}
          to={it.to}
          onClick={gated(it.key)}
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
  const gated = useGatedClick()
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
              onClick={gated(it.key)}
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

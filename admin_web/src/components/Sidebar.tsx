import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { hasPermission } from '../lib/permissions'
import { NAV_PERMS } from '../lib/navPermissions'
import { useMeStore } from '../store/me'
import { useUiStore } from '../store/ui'
import type { AdminPermissionKey } from '../types/api'

interface NavItem {
  to: string
  label: string
  icon: string
  // 이 중 하나라도 있으면 보인다(없으면 모든 관리자). 같은 표가 App.tsx 라우트 가드에도 쓰인다
  perms?: AdminPermissionKey[]
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
      { to: '/reports', label: '신고 관리', icon: '🚩' },
      // 시세 재배포 계약 대응 — 기존 글에 박힌 차트 이미지 점검(조회 전용, /blogs 아래에 두면 '게시글 관리' 도 함께 활성화됨)
      { to: '/blog-chart-audit', label: '차트 포함 글 점검', icon: '🖼️' },
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
      { to: '/market/daily-surge', label: '급등락·테마 분석', icon: '🔥' },
      { to: '/market/ai-lab', label: 'AI 종목 심층 분석', icon: '🧠' },
      { to: '/market/themes', label: '테마 보정', icon: '🏷️' },
      { to: '/market/status', label: '데이터 현황', icon: '🩺' },
      { to: '/market/verify', label: '데이터 검증', icon: '🔍' },
      { to: '/market/leaders', label: '주도주', icon: '🏆' },
      { to: '/market/ma-screener', label: '5·20 정배열 스크리너', icon: '📈' },
      // 조건검색·차트 패턴 — 사용자 화면 노출 스위치(스크리너 탭)와 무관하게 관리자에게는 항상 보인다
      { to: '/market/finder', label: '조건검색', icon: '🔎' },
      { to: '/market/patterns', label: '차트 패턴', icon: '📐' },
      { to: '/market/screener', label: '스크리너 탭 설정', icon: '🗂️' },
    ],
  },
  {
    title: '알림',
    items: [{ to: '/fund-notices', label: '펀드 리포트 알림', icon: '📣' }],
  },
  {
    title: '앱 관리',
    items: [
      { to: '/app/versions', label: '앱 버전 & 업데이트', icon: '📱' },
      { to: '/app/ads', label: '광고 설정', icon: '📢' },
    ],
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

// 관리자 계정 — '관리자 계정'(만들기·관리)은 슈퍼 관리자에게만, '비밀번호 변경'은 모든 관리자에게
const accountGroup = (isSuper: boolean): NavGroup => ({
  title: '관리자',
  items: [
    ...(isSuper ? [{ to: '/admins', label: '관리자 계정', icon: '🛡️' }] : []),
    { to: '/account/password', label: '비밀번호 변경', icon: '🔑' },
  ],
})

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

function SidebarContent({ isSuper }: { isSuper: boolean }) {
  const closeSidebar = useUiStore((s) => s.closeSidebar)
  const user = useMeStore((s) => s.user)
  // 권한 없는 메뉴는 숨기고, 다 숨겨진 묶음은 제목까지 뺀다
  const groups = [...NAV_GROUPS, accountGroup(isSuper)]
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const perms = item.perms ?? NAV_PERMS[item.to]
        return !perms || hasPermission(user, ...perms)
      }),
    }))
    .filter((g) => g.items.length > 0)
  return (
    <nav className="flex flex-col gap-6 p-4">
      {groups.map((group) => (
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

export default function Sidebar({ isSuper = false }: { isSuper?: boolean }) {
  const { sidebarOpen, closeSidebar } = useUiStore(useShallow((s) => ({ sidebarOpen: s.sidebarOpen, closeSidebar: s.closeSidebar })))

  // 드로어를 연 채 넓은 화면(lg)이 되면 닫는다 — 열린 채 남으면 넓은 화면에서도 스크롤 잠금이 걸린다
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => { if (mq.matches) closeSidebar() }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [closeSidebar])

  return (
    <>
      {/* 데스크톱: 고정 사이드바 */}
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white lg:block">
        <SidebarContent isSuper={isSuper} />
      </aside>

      {/* 모바일: 오버레이 드로어 — Radix Dialog(Esc 닫기·포커스 가두기·스크롤 잠금), 모양은 예전 그대로 */}
      <DialogPrimitive.Root open={sidebarOpen} onOpenChange={(o) => { if (!o) closeSidebar() }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <DialogPrimitive.Content asChild aria-describedby={undefined}>
            <aside className="fixed left-0 top-0 z-40 h-full w-64 border-r border-slate-200 bg-white shadow-xl lg:hidden">
              <DialogPrimitive.Title className="sr-only">메뉴</DialogPrimitive.Title>
              <SidebarContent isSuper={isSuper} />
            </aside>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}

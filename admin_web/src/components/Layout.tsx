import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getUser, logout, refreshMe } from '../api/auth'
import { useUiStore } from '../store/ui'
import Sidebar from './Sidebar'
import NotificationToaster from './NotificationToaster'

// 목록·상세 2단 화면은 넓게 — 4xl(896px) 안에서 두 칸으로 나누면 칸당 ~430px 라 표 글자가 낱자로 끊긴다.
// 나머지 화면(글 편집 등)은 읽기 폭을 유지한다.
// 회원 목록은 열이 9개라 4xl 안에서는 가로 스크롤이 생긴다 → 넓게
const WIDE_PREFIXES = ['/game/quizzes', '/market/', '/fund-notices', '/members', '/admins']

export default function Layout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const wide = WIDE_PREFIXES.some((p) => pathname.startsWith(p))
  const [user, setUser] = useState(getUser)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const isSuper = user?.is_super_admin === true

  // 저장된 로그인 정보가 옛 형식(슈퍼 관리자 표시 없음)일 수 있어 화면을 열 때 한 번 최신으로 맞춘다
  useEffect(() => {
    let alive = true
    refreshMe().then((u) => {
      if (alive && u) setUser(u)
    })
    return () => {
      alive = false
    }
  }, [])

  const onLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* 상단 바 */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            {/* 모바일 햄버거 */}
            <button
              onClick={toggleSidebar}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="메뉴"
            >
              ☰
            </button>
            <h1 className="text-lg font-bold text-slate-900">
              <img src="/favicon.svg" alt="" aria-hidden className="mr-1 inline-block h-6 w-6 align-[-5px]" />FunNote <span className="text-indigo-600">Admin</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="hidden truncate text-sm text-slate-500 sm:inline">
                {user.nickname || user.email}
                <span className="ml-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
                  {isSuper ? '슈퍼 관리자' : '관리자'}
                </span>
              </span>
            )}
            <button
              onClick={onLogout}
              className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 본문 = 사이드바 + 콘텐츠 */}
      <div className="flex flex-1">
        <Sidebar isSuper={isSuper} />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-4xl'}`}>
            <Outlet />
          </div>
        </main>
      </div>

      <NotificationToaster />
    </div>
  )
}

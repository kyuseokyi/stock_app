import { Outlet, useNavigate } from 'react-router-dom'
import { getUser, logout } from '../api/auth'
import { useUiStore } from '../store/ui'
import Sidebar from './Sidebar'
import NotificationToaster from './NotificationToaster'

export default function Layout() {
  const navigate = useNavigate()
  const user = getUser()
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

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
              📈 StockApp <span className="text-indigo-600">Admin</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="hidden truncate text-sm text-slate-500 sm:inline">
                {user.nickname || user.email}
                <span className="ml-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
                  {user.role}
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
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="mx-auto max-w-4xl">
            <Outlet />
          </div>
        </main>
      </div>

      <NotificationToaster />
    </div>
  )
}

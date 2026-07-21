import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useBoardStore } from '../store/boards'
import { useAuthStore } from '../store/auth'
import LoginModal from './LoginModal'
import NotificationToaster from './NotificationToaster'

const tabClass = ({ isActive }) =>
  `whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
    isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

export default function Layout() {
  const { boards, fetchBoards } = useBoardStore()
  const { user, logout } = useAuthStore()
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-lg font-bold text-slate-900">
              📈 StockApp <span className="text-indigo-600">커뮤니티</span>
            </Link>
            {user ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-600">
                  <span className="font-medium text-slate-900">{user.nickname}</span> 님
                </span>
                <button
                  onClick={logout}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-slate-500 hover:bg-slate-50"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <button
                onClick={() => setLoginOpen(true)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                로그인
              </button>
            )}
          </div>
          {/* 게시판 탭 (모바일에서 가로 스크롤) */}
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {boards.map((b) => (
              <NavLink key={b.id} to={`/boards/${b.id}`} className={tabClass}>
                {b.name}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>

      <NotificationToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}

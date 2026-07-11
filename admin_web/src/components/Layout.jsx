import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getUser, logout } from '../api/auth'
import NotificationToaster from './NotificationToaster'

const navClass = ({ isActive }) =>
  `px-4 py-2 rounded-lg text-sm font-medium transition ${
    isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

export default function Layout() {
  const navigate = useNavigate()
  const user = getUser()

  const onLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-lg font-bold text-slate-900">
              📈 StockApp <span className="text-indigo-600">Admin</span>
            </h1>
            <nav className="flex gap-2">
              <NavLink to="/boards" className={navClass}>
                게시판 관리
              </NavLink>
              <NavLink to="/blogs" className={navClass}>
                게시글 관리
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            {user && (
              <span className="truncate text-sm text-slate-500">
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
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
      <NotificationToaster />
    </div>
  )
}

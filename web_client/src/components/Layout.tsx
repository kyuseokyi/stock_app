import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useBoardStore } from '../store/boards'
import { useAuthStore } from '../store/auth'
import { chipClass } from './ui/Chip'
import LoginModal from './LoginModal'
import NotificationToaster from './NotificationToaster'
import UserMenu from './UserMenu'
import DeleteAccountModal from './DeleteAccountModal'
import AppToaster from './AppToaster'
import { showToast } from '../store/toast'

// 1차 섹션(커뮤니티·게임) 탭 스타일
const sectionClass = (active: boolean) =>
  `pb-1.5 text-base font-bold transition ${
    active ? 'border-b-2 border-accent text-ink' : 'text-ink-muted hover:text-ink'
  }`

export default function Layout() {
  const { boards, fetchBoards } = useBoardStore()
  const { user, logout } = useAuthStore()
  const [loginOpen, setLoginOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  // 섹션 판별: /game 경로면 게임, 그 외 전부 커뮤니티(별도 상태 불필요)
  const isGame = location.pathname.startsWith('/game')

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  // 탈퇴 성공(스토어가 이미 로그아웃) → 모달 닫기·홈 이동·토스트
  const handleDeleted = () => {
    setDeleteOpen(false)
    navigate('/')
    showToast('탈퇴가 완료됐어요')
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-lg font-bold text-ink">
              📈 StockApp
            </Link>
            {user ? (
              <UserMenu nickname={user.nickname} onLogout={logout} onDeleteAccount={() => setDeleteOpen(true)} />
            ) : (
              <button
                onClick={() => setLoginOpen(true)}
                className="rounded-field bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95"
              >
                로그인
              </button>
            )}
          </div>

          {/* 1차 네비: 커뮤니티 · 게임 */}
          <nav className="mt-3 flex items-center gap-5">
            <Link to="/" className={sectionClass(!isGame)}>
              커뮤니티
            </Link>
            <Link to="/game" className={sectionClass(isGame)}>
              게임
            </Link>
          </nav>

          {/* 커뮤니티 섹션일 때만 게시판 탭 */}
          {!isGame && (
            <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {boards.map((b) => (
                <NavLink
                  key={b.id}
                  to={`/boards/${b.id}`}
                  className={({ isActive }) => chipClass(isActive)}
                >
                  {b.name}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>

      <NotificationToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      {deleteOpen && <DeleteAccountModal onClose={() => setDeleteOpen(false)} onDeleted={handleDeleted} />}
      <AppToaster />
    </div>
  )
}

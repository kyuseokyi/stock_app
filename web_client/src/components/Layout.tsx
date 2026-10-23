import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useBoardStore } from '../store/boards'
import { useAuthStore } from '../store/auth'
import { chipClass } from './ui/Chip'
import { BottomTabBar, TopNav, sectionOf } from './AppNav'
import LoginModal from './LoginModal'
import NotificationToaster from './NotificationToaster'
import UserMenu from './UserMenu'
import DeleteAccountModal from './DeleteAccountModal'
import AppToaster from './AppToaster'
import { showToast } from '../store/toast'
import { useFundAutoRefresh } from '../lib/fundAutoRefresh'
import ScrollRow from './ui/ScrollRow'

export default function Layout() {
  const { boards, fetchBoards } = useBoardStore()
  const { user, logout } = useAuthStore()
  const [loginOpen, setLoginOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  // 섹션 판별: 경로로(별도 상태 불필요) — 게시판·글 상세는 커뮤니티
  const section = sectionOf(location.pathname)
  // 게임·스크리너는 넓은 화면(lg+)에서 2단(차트+주문 / 목록+상세) → 헤더·본문 폭을 함께 넓힌다(로고·메뉴 정렬 유지)
  // 헤더는 항상 넓은 폭으로 고정 — 섹션이 바뀌어도 로고·메뉴 위치가 그대로. 본문 폭만 섹션별로 다르다.
  const width = section === 'game' || section === 'screener' ? 'max-w-3xl lg:max-w-6xl' : 'max-w-3xl'
  const headerWidth = 'max-w-3xl lg:max-w-6xl'
  useFundAutoRefresh() // 접속·탭 복귀 시 등록 펀드 자동 갱신(로그인 상태일 때만)

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  // 시작·탭 복귀 시 세션 확인 — 블로그처럼 인증 요청이 없는 화면에서도 만료·다른 기기 로그인을 반영
  useEffect(() => {
    const validate = useAuthStore.getState().validateSession
    void validate(true)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void validate()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // 탈퇴 성공(스토어가 이미 로그아웃) → 모달 닫기·홈 이동·토스트
  const handleDeleted = () => {
    setDeleteOpen(false)
    navigate('/')
    showToast('탈퇴가 완료됐어요')
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
        <div className={`mx-auto ${headerWidth} px-4 py-3`}>
          <div className="flex items-center justify-between">
            <Link to="/" className="text-lg font-bold text-ink">
              📈 StockApp
            </Link>
            {user ? (
              <UserMenu nickname={user.nickname} onLogout={logout} onDeleteAccount={() => setDeleteOpen(true)} />
            ) : (
              <button
                onClick={() => setLoginOpen(true)}
                className="rounded-field bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:brightness-95"
              >
                로그인
              </button>
            )}
          </div>

          {/* 1차 메뉴: 홈 · 커뮤니티 · 게임 · 내정보 (데스크톱 상단 — 모바일 폭은 아래 BottomTabBar) */}
          <TopNav section={section} />

          {/* 커뮤니티 섹션일 때만 게시판 탭 */}
          {section === 'community' && boards.length > 1 && (
            <nav aria-label="게시판" className="mt-3">
              <ScrollRow fade="canvas">
              {boards.map((b) => (
                <NavLink
                  key={b.id}
                  to={`/boards/${b.id}`}
                  className={({ isActive }) => chipClass(isActive)}
                >
                  {b.name}
                </NavLink>
              ))}
              </ScrollRow>
            </nav>
          )}
        </div>
      </header>

      {/* 모바일 폭은 하단 탭바(3.5rem + safe-area)만큼 아래 여백 */}
      <main className={`mx-auto ${width} px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-6 sm:py-6`}>
        <Outlet />
      </main>

      <BottomTabBar section={section} />

      <NotificationToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      {deleteOpen && <DeleteAccountModal onClose={() => setDeleteOpen(false)} onDeleted={handleDeleted} />}
      <AppToaster />
    </div>
  )
}

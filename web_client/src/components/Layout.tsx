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
import Button from './ui/Button'
import { titleFor } from '../lib/pageTitle'

export default function Layout() {
  const { boards, fetchBoards, boardName } = useBoardStore()
  const { user, logout } = useAuthStore()
  const [loginOpen, setLoginOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  // 섹션 판별: 경로로(별도 상태 불필요) — 게시판·글 상세는 커뮤니티
  const section = sectionOf(location.pathname)
  // 헤더·본문 바깥 틀은 항상 같은 폭 — 로고·제목·본문의 왼쪽 선이 모든 화면에서 같다.
  // 넓은 화면(lg+)에서 2단을 쓰는 곳(홈·게시판 목록·게임·스크리너)만 전체 폭, 나머지(글 상세·내 정보)는 읽기 폭을 왼쪽에 붙인다.
  const headerWidth = 'max-w-3xl lg:max-w-6xl'
  const wide = section === 'game' || section === 'screener' || section === 'home' || location.pathname.startsWith('/boards/')
  useFundAutoRefresh() // 접속·탭 복귀 시 등록 펀드 자동 갱신(로그인 상태일 때만)
  // 경로별 탭 제목 — 값이 바뀔 때만 넣어서, 글·종목 상세가 구체화한 제목을 게시판 목록 갱신이 덮지 않게 한다
  const routeTitle = titleFor(location.pathname, boardName)

  useEffect(() => {
    document.title = routeTitle
  }, [routeTitle])

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
            <Link to="/" className="inline-flex items-center gap-1.5 text-lg font-bold text-ink">
              {/* 로고 표시 — 이모지 대신 선 그림(조작 요소에 이모지 쓰지 않음, DESIGN 규칙). 이름은 옆 글자로 읽힌다 */}
              <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 text-brand-strong" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2.5" y="2.5" width="19" height="19" rx="5" className="fill-brand-soft" stroke="none" />
                <path d="M6.5 15.5l3.5-4 3 2.5 4.5-6" />
                <path d="M14.5 8h3v3" />
              </svg>
              StockApp
            </Link>
            {user ? (
              <UserMenu nickname={user.nickname} onLogout={logout} onDeleteAccount={() => setDeleteOpen(true)} />
            ) : (
              <Button onClick={() => setLoginOpen(true)}>로그인</Button>
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
      <main className={`mx-auto ${headerWidth} px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-6 sm:py-6`}>
        <div className={wide ? '' : 'max-w-3xl'}>
          <Outlet />
        </div>
      </main>

      <BottomTabBar section={section} />

      <NotificationToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      {deleteOpen && <DeleteAccountModal onClose={() => setDeleteOpen(false)} onDeleted={handleDeleted} />}
      <AppToaster />
    </div>
  )
}

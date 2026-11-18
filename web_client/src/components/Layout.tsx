import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useBoardStore } from '../store/boards'
import { useAuthStore } from '../store/auth'
import { openLogin, useLoginPromptStore } from '../store/loginPrompt'
import { chipClass } from './ui/Chip'
import { BottomTabBar, TopNav, ProfileIcon } from './AppNav'
import { sectionOf } from '../lib/navSections'
import LoginModal from './LoginModal'
import NotificationToaster from './NotificationToaster'
import UserMenu from './UserMenu'
import DeleteAccountModal from './DeleteAccountModal'
import TermsModal from './TermsModal'
import { shouldShowTermsModal } from '../lib/terms'
import AppToaster from './AppToaster'
import { showToast } from '../store/toast'
import { useFundAutoRefresh } from '../lib/fundAutoRefresh'
import ScrollRow from './ui/ScrollRow'
import Button from './ui/Button'
import { titleFor } from '../lib/pageTitle'

export default function Layout() {
  const { boards, fetchBoards, boardName } = useBoardStore()
  const { user, token, logout } = useAuthStore()
  // 로그인 모달은 전역 스토어 하나 — 헤더 버튼·'내 펀드' 탭·홈 카드가 같은 모달을 연다
  const loginPrompt = useLoginPromptStore()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  // 섹션 판별: 경로로(별도 상태 불필요) — 게시판·글 상세는 커뮤니티
  const section = sectionOf(location.pathname)
  // 헤더·본문 바깥 틀은 항상 같은 폭 — 로고·제목·본문의 왼쪽 선이 모든 화면에서 같다.
  // 넓은 화면(lg+)에서 2단을 쓰는 곳(홈·게시판 목록·게임·마켓(종목 상세 포함)·스크리너)만 전체 폭, 나머지(글 상세·내 정보)는 읽기 폭을 왼쪽에 붙인다.
  const headerWidth = 'max-w-3xl lg:max-w-6xl'
  const wide = section === 'game' || section === 'market' || section === 'screener' || section === 'home' || location.pathname.startsWith('/boards/')
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
              {/* 로고 기호(docs/brand/logo, 32px 이하용 작은 판 = 파비콘과 같은 파일). 이름은 옆 글자로 읽힌다 */}
              <img src="/favicon.svg" alt="" aria-hidden className="h-6 w-6" />
              FunNote
            </Link>
            <div className="flex items-center gap-1">
              {user ? (
                <UserMenu nickname={user.nickname} onLogout={logout} onDeleteAccount={() => setDeleteOpen(true)} />
              ) : (
                <Button onClick={() => openLogin()}>로그인</Button>
              )}
              {/* 내정보(/me) — 하단 탭에서 헤더 우측으로 옮김. 로그인 여부와 상관없이 항상(약관·정책 링크도 여기서 찾는다) */}
              <Link
                to="/me"
                aria-label="내정보"
                aria-current={section === 'me' ? 'page' : undefined}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-fill hover:text-ink ${
                  section === 'me' ? 'text-accent' : 'text-ink-muted'
                }`}
              >
                <ProfileIcon />
              </Link>
            </div>
          </div>

          {/* 1차 메뉴: 홈 · 내 펀드 · 블로그 · 게임 · 시장 (+스크리너) (데스크톱 상단 — 모바일 폭은 아래 BottomTabBar) */}
          <TopNav section={section} />

          {/* 블로그(커뮤니티) 섹션일 때만 게시판 탭 */}
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
      <LoginModal
        open={loginPrompt.open}
        onClose={loginPrompt.close}
        description={loginPrompt.description}
        returnTo={loginPrompt.returnTo}
        // 닉네임 로그인(개발용)은 화면 이동 없이 끝나므로 여기서 복귀 경로로 보낸다. 간편 로그인은 완료 화면이 보낸다
        onSuccess={loginPrompt.returnTo ? () => navigate(loginPrompt.returnTo!) : undefined}
      />
      {deleteOpen && <DeleteAccountModal onClose={() => setDeleteOpen(false)} onDeleted={handleDeleted} />}
      {/* 약관 미동의 로그인 사용자 — 닫기 없는 동의 모달(z-50). /terms·/privacy 에서는 읽을 수 있게 숨긴다 */}
      {shouldShowTermsModal(token, user, location.pathname) && <TermsModal />}
      <AppToaster />
    </div>
  )
}

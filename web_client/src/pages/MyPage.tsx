import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import LoginModal from '../components/LoginModal'
import DeleteAccountModal from '../components/DeleteAccountModal'
import { useAuthStore } from '../store/auth'
import { showToast } from '../store/toast'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import { INFO_NOTICE } from '../lib/terms'

// 내정보(/me) — 앱 내정보 탭과 같은 자리. 비로그인: 간편 로그인 / 로그인: 닉네임·게임 바로가기·로그아웃·탈퇴.
// 헤더의 닉네임 메뉴(UserMenu)도 그대로 둔다(데스크톱 동선).
export default function MyPage() {
  const { user, logout } = useAuthStore()
  const [loginOpen, setLoginOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const navigate = useNavigate()

  const handleDeleted = () => {
    setDeleteOpen(false)
    navigate('/')
    showToast('탈퇴가 완료됐어요')
  }

  if (!user) {
    return (
      <div>
        <PageHeader title="내정보" className="mb-5" />
        <Card className="py-6 text-center">
          <p className="text-3xl">👋</p>
          <p className="mt-3 font-semibold text-ink">로그인하고 시작해 보세요</p>
          <p className="mt-1 text-sm text-ink-muted">간편 로그인으로 게임에 참여하고 댓글을 남길 수 있어요.</p>
          <Button className="mt-5" onClick={() => setLoginOpen(true)}>
            로그인
          </Button>
        </Card>
        <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
        <PolicyLinks />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="내정보" className="mb-5" />
      <Card>
        <p className="text-sm text-ink-muted">닉네임</p>
        <p className="mt-1 text-lg font-bold text-ink">{user.nickname ?? '이름 없음'}</p>
      </Card>

      <Card padding="none" className="mt-3 overflow-hidden">
        <Link to="/game" className="flex items-center justify-between px-5 py-4 text-ink hover:bg-line">
          <span>🎮 트레이딩 게임</span>
          <span className="text-ink-muted">›</span>
        </Link>
        <Link to="/me/funds" className="flex items-center justify-between border-t border-line px-5 py-4 text-ink hover:bg-line">
          <span>💰 내 펀드 수익</span>
          <span className="text-ink-muted">›</span>
        </Link>
        <Link to="/me/blocks" className="flex items-center justify-between border-t border-line px-5 py-4 text-ink hover:bg-line">
          <span>🚫 차단한 사용자</span>
          <span className="text-ink-muted">›</span>
        </Link>
      </Card>

      <div className="mt-6 flex gap-2">
        <Button variant="secondary" full onClick={logout}>
          로그아웃
        </Button>
        <Button variant="danger" full onClick={() => setDeleteOpen(true)}>
          회원 탈퇴
        </Button>
      </div>
      {deleteOpen && <DeleteAccountModal onClose={() => setDeleteOpen(false)} onDeleted={handleDeleted} />}
      <PolicyLinks />
    </div>
  )
}

// 공개 정책 문서 — 로그인 여부와 상관없이 내정보 맨 아래에서 찾을 수 있게(스토어 심사가 위치를 본다)
function PolicyLinks() {
  return (
    <>
    {/* 정보 제공 고지(앱 내정보와 같은 문구) */}
    <p className="mt-8 text-center text-xs leading-relaxed text-ink-muted">{INFO_NOTICE}</p>
    <nav aria-label="정책" className="mt-2 flex flex-wrap justify-center gap-x-4 text-xs text-ink-muted">
      <Link to="/terms" className="inline-flex min-h-11 items-center hover:text-ink">이용약관</Link>
      <Link to="/privacy" className="inline-flex min-h-11 items-center hover:text-ink">개인정보처리방침</Link>
      <Link to="/account-deletion" className="inline-flex min-h-11 items-center hover:text-ink">계정 삭제 안내</Link>
      <Link to="/support" className="inline-flex min-h-11 items-center hover:text-ink">고객지원</Link>
    </nav>
    </>
  )
}

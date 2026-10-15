import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import LoginModal from '../components/LoginModal'
import DeleteAccountModal from '../components/DeleteAccountModal'
import { useAuthStore } from '../store/auth'
import { showToast } from '../store/toast'

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
        <h1 className="mb-5 text-xl font-bold text-ink">내정보</h1>
        <div className="rounded-card bg-surface p-6 text-center">
          <p className="text-3xl">👋</p>
          <p className="mt-3 font-semibold text-ink">로그인하고 시작해 보세요</p>
          <p className="mt-1 text-sm text-ink-muted">간편 로그인으로 게임에 참여하고 댓글을 남길 수 있어요.</p>
          <Button className="mt-5" onClick={() => setLoginOpen(true)}>
            로그인
          </Button>
        </div>
        <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-5 text-xl font-bold text-ink">내정보</h1>
      <div className="rounded-card bg-surface p-5">
        <p className="text-sm text-ink-muted">닉네임</p>
        <p className="mt-1 text-lg font-bold text-ink">{user.nickname ?? '이름 없음'}</p>
      </div>

      <div className="mt-3 overflow-hidden rounded-card bg-surface">
        <Link to="/game" className="flex items-center justify-between px-5 py-4 text-ink hover:bg-line">
          <span>🎮 트레이딩 게임</span>
          <span className="text-ink-muted">›</span>
        </Link>
      </div>

      <div className="mt-6 flex gap-2">
        <Button variant="secondary" full onClick={logout}>
          로그아웃
        </Button>
        <Button variant="secondary" full onClick={() => setDeleteOpen(true)} className="text-up">
          회원 탈퇴
        </Button>
      </div>
      {deleteOpen && <DeleteAccountModal onClose={() => setDeleteOpen(false)} onDeleted={handleDeleted} />}
    </div>
  )
}

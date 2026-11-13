import { useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { useAuthStore } from '../store/auth'
import { showToast } from '../store/toast'
import { agreeTermsErrorMessage, TERMS_DECLINED_MESSAGE, TERMS_SUMMARY } from '../lib/terms'

/**
 * 약관 동의 모달(닫기 없음) — Layout 이 shouldShowTermsModal 일 때 마운트한다.
 * 약관·방침 링크는 같은 SPA 라우트로 이동(그 경로에선 모달이 숨어 읽을 수 있고, 돌아오면 다시 뜬다).
 */
export default function TermsModal() {
  const agreeTerms = useAuthStore((s) => s.agreeTerms)
  const logout = useAuthStore((s) => s.logout)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const agree = async () => {
    setSubmitting(true)
    setError('')
    try {
      await agreeTerms() // 성공하면 user.terms_required=false → Layout 이 모달을 내린다
    } catch (e) {
      setError(agreeTermsErrorMessage(e)) // 모달은 닫지 않고 다시 시도할 수 있다
      setSubmitting(false)
    }
  }

  const decline = () => {
    logout()
    showToast(TERMS_DECLINED_MESSAGE)
  }

  return (
    <Modal title="FunNote 이용약관에 동의해 주세요" onClose={() => {}} dismissible={false} layer="top" narrow>
      <ul className="space-y-2 rounded-card bg-fill px-4 py-3 text-sm text-ink">
        {TERMS_SUMMARY.map((text) => (
          <li key={text} className="flex gap-2">
            <span className="text-ink-muted">•</span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-center gap-x-6 text-sm text-ink-muted">
        <Link to="/terms" className="inline-flex min-h-11 items-center underline hover:text-ink">
          이용약관 보기
        </Link>
        <Link to="/privacy" className="inline-flex min-h-11 items-center underline hover:text-ink">
          개인정보처리방침 보기
        </Link>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        <Button full onClick={() => void agree()} disabled={submitting}>
          {submitting ? '저장하는 중…' : '동의하고 시작하기'}
        </Button>
        <Button variant="secondary" full onClick={decline} disabled={submitting}>
          동의하지 않음
        </Button>
      </div>
    </Modal>
  )
}

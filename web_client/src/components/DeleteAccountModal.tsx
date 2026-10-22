import { useState } from 'react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { useAuthStore } from '../store/auth'
import { currentFundOwner, purgeAccountFunds } from '../lib/fundStore'
import { DELETE_ACCOUNT_NOTICES, deleteAccountErrorMessage } from '../lib/deleteAccount'

interface Props {
  onClose: () => void
  /** 탈퇴 성공(이미 로그아웃됨) — 호출부가 홈 이동·토스트 */
  onDeleted: () => void
}

// 회원 탈퇴 확인 모달 — 열 때 마운트·닫을 때 언마운트(Modal 패턴)
export default function DeleteAccountModal({ onClose, onDeleted }: Props) {
  const deleteAccount = useAuthStore((s) => s.deleteAccount)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    setSubmitting(true)
    setError('')
    const uid = currentFundOwner() // 탈퇴하면 로그아웃되므로 미리 잡아 둔다
    try {
      await deleteAccount()
      if (uid !== null) purgeAccountFunds(uid) // 성공했을 때만 — 실패하면 아무것도 지우지 않는다
      onDeleted()
    } catch (e) {
      setSubmitting(false)
      setError(deleteAccountErrorMessage(e))
    }
  }

  return (
    <Modal title="회원 탈퇴" onClose={submitting ? () => {} : onClose}>
      <ul className="space-y-2 rounded-card bg-fill px-4 py-3 text-sm text-ink">
        {DELETE_ACCOUNT_NOTICES.map((text) => (
          <li key={text} className="flex gap-2">
            <span className="text-ink-muted">•</span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm text-up">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={submitting}
          className="inline-flex h-11 w-full items-center justify-center rounded-btn bg-up-soft px-4 text-sm font-semibold text-up transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '탈퇴하는 중…' : '탈퇴하기'}
        </button>
        <Button variant="secondary" full onClick={onClose} disabled={submitting}>
          취소
        </Button>
      </div>
    </Modal>
  )
}

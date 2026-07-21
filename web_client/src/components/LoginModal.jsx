import { useState } from 'react'
import { useAuthStore } from '../store/auth'

// 임시 로그인 모달 — 닉네임만 입력(카카오/구글 도입 전)
export default function LoginModal({ open, onClose, onSuccess }) {
  const login = useAuthStore((s) => s.login)
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const submit = async (e) => {
    e.preventDefault()
    const nick = nickname.trim()
    if (!nick) {
      setError('닉네임을 입력하세요.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await login(nick)
      setNickname('')
      onSuccess?.()
      onClose()
    } catch {
      setError('로그인에 실패했습니다. (auth 서버 8001 확인)')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">로그인</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="닫기">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-400">
          닉네임을 입력하면 바로 시작합니다. (소셜 로그인은 준비 중)
        </p>
        <form onSubmit={submit}>
          <input
            autoFocus
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            placeholder="닉네임 (예: 주린이)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? '로그인 중…' : '닉네임으로 시작'}
          </button>
        </form>
      </div>
    </div>
  )
}

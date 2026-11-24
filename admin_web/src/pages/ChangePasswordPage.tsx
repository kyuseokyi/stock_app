import { useState, type FormEvent } from 'react'
import { changePassword } from '../api/auth'
import { validatePassword } from '../lib/adminAccounts'
import { apiErrorMessage } from '../lib/apiError'
import { showToast } from '../lib/toast'

// 내 비밀번호 변경 — 모든 관리자. 현재 비밀번호를 확인한 뒤 바꾸고, 지금 로그인은 유지된다.

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none'

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    const invalid = validatePassword(next)
    if (invalid) return setError(invalid)
    if (next !== confirm) return setError('새 비밀번호 두 칸이 서로 달라요.')
    setSaving(true)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      showToast('비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 쓰세요.', { icon: '🔑' })
    } catch (caught) {
      setError(apiErrorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-md">
      <h2 className="mb-1 text-xl font-bold text-slate-900">비밀번호 변경</h2>
      <p className="mb-6 text-sm text-slate-500">지금 로그인한 관리자 계정의 비밀번호를 바꿔요.</p>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-600">현재 비밀번호</span>
          <input type="password" autoComplete="current-password" value={current}
            onChange={(e) => setCurrent(e.target.value)} className={inputClass} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-600">새 비밀번호</span>
          <input type="password" autoComplete="new-password" value={next}
            onChange={(e) => setNext(e.target.value)} className={inputClass} required />
          <span className="mt-1 block text-xs text-slate-400">8자 이상</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-600">새 비밀번호 확인</span>
          <input type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} className={inputClass} required />
        </label>
        <button type="submit" disabled={saving}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {saving ? '바꾸는 중…' : '비밀번호 바꾸기'}
        </button>
      </form>
    </div>
  )
}

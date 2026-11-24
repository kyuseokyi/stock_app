import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createAdminAccount, listAdminAccounts, resetAdminPassword, setAdminActive } from '../api/adminAccounts'
import { LOGIN_ID_RULE, validateLoginId, validatePassword } from '../lib/adminAccounts'
import { apiErrorMessage } from '../lib/apiError'
import { formatDateTime } from '../lib/moderation'
import { showToast } from '../lib/toast'
import type { AdminAccount } from '../types/api'

// 관리자 계정(슈퍼 관리자 전용) — 새 관리자 만들기, 비밀번호 초기화, 사용 중지·다시 사용.
// 슈퍼 관리자 계정은 여기서 바꿀 수 없고(서버도 막음), 삭제 대신 사용 중지로 한다(쓴 글·댓글 보존).

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none'

export default function AdminAccountsPage() {
  const [items, setItems] = useState<AdminAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  // 새 관리자
  const [loginId, setLoginId] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)
  // 비밀번호 초기화 인라인 입력
  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPw, setResetPw] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await listAdminAccounts())
    } catch (e) {
      setError(apiErrorMessage(e, '관리자 목록을 불러오지 못했어요.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setFormError('')
    const id = loginId.trim()
    const invalid = validateLoginId(id) ?? (nickname.trim() ? null : '이름을 입력해 주세요.') ?? validatePassword(password)
    if (invalid) return setFormError(invalid)
    setCreating(true)
    try {
      const created = await createAdminAccount({ login_id: id, nickname: nickname.trim(), password })
      setItems((prev) => [...prev, created])
      setLoginId('')
      setNickname('')
      setPassword('')
      showToast(`관리자 '${created.login_id}' 을(를) 만들었어요. 처음 비밀번호를 전달하고, 로그인 후 바꾸게 하세요.`, { icon: '✅' })
    } catch (caught) {
      setFormError(apiErrorMessage(caught))
    } finally {
      setCreating(false)
    }
  }

  const replace = (next: AdminAccount) => setItems((prev) => prev.map((a) => (a.id === next.id ? next : a)))

  const onToggleActive = async (a: AdminAccount) => {
    const stop = a.is_active
    if (stop && !window.confirm(`'${a.login_id}' 계정을 사용 중지할까요? 지금 로그인도 바로 끊겨요.`)) return
    setBusyId(a.id)
    try {
      replace(await setAdminActive(a.id, !stop))
      showToast(stop ? '사용 중지했어요.' : '다시 사용할 수 있게 했어요.')
    } catch (caught) {
      showToast(apiErrorMessage(caught), { icon: '⚠️' })
    } finally {
      setBusyId(null)
    }
  }

  const onReset = async (a: AdminAccount) => {
    const invalid = validatePassword(resetPw)
    if (invalid) return showToast(invalid, { icon: '⚠️' })
    setBusyId(a.id)
    try {
      replace(await resetAdminPassword(a.id, resetPw))
      setResetId(null)
      setResetPw('')
      showToast(`'${a.login_id}' 비밀번호를 초기화했어요. 열린 로그인은 끊겼어요.`, { icon: '🔑' })
    } catch (caught) {
      showToast(apiErrorMessage(caught), { icon: '⚠️' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-xl font-bold text-slate-900">관리자 계정</h2>
      <p className="mb-6 text-sm text-slate-500">
        관리자는 여기서 아이디·비밀번호로 만들어요. 일반 관리자는 계정 관리를 뺀 모든 메뉴를 쓸 수 있어요.
      </p>

      <form onSubmit={onCreate} className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-bold text-slate-700">새 관리자 만들기</h3>
        {formError && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">아이디</span>
            <input value={loginId} onChange={(e) => setLoginId(e.target.value.toLowerCase())}
              autoComplete="off" placeholder="예: manager1" className={inputClass} />
            <span className="mt-1 block text-xs text-slate-400">{LOGIN_ID_RULE}</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">이름</span>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20}
              placeholder="예: 운영 담당" className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">처음 비밀번호</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" className={inputClass} />
            <span className="mt-1 block text-xs text-slate-400">8자 이상 · 로그인 후 본인이 바꾸게 하세요</span>
          </label>
        </div>
        <button type="submit" disabled={creating}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {creating ? '만드는 중…' : '관리자 만들기'}
        </button>
      </form>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">아이디</th>
              <th className="px-3 py-2">이름</th>
              <th className="px-3 py-2">구분</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2">만든 날</th>
              <th className="px-3 py-2 text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">불러오는 중…</td></tr>
            )}
            {items.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 align-top">
                <td className="break-all px-3 py-2 font-medium text-slate-800">{a.login_id}</td>
                <td className="px-3 py-2 text-slate-600">{a.nickname}</td>
                <td className="px-3 py-2">
                  {a.is_super_admin
                    ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">슈퍼 관리자</span>
                    : <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">관리자</span>}
                </td>
                <td className="px-3 py-2">
                  {a.is_active
                    ? <span className="text-emerald-600">사용 중</span>
                    : <span className="text-slate-400">사용 중지</span>}
                </td>
                <td className="px-3 py-2 text-slate-500">{a.created_at ? formatDateTime(a.created_at) : '-'}</td>
                <td className="px-3 py-2 text-right">
                  {a.is_super_admin ? (
                    <span className="text-xs text-slate-400">비밀번호는 '비밀번호 변경'에서</span>
                  ) : resetId === a.id ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <input type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)}
                        autoComplete="new-password" placeholder="새 비밀번호(8자 이상)"
                        className="w-44 rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                      <button type="button" disabled={busyId === a.id} onClick={() => onReset(a)}
                        className="rounded-lg bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50">저장</button>
                      <button type="button" onClick={() => { setResetId(null); setResetPw('') }}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600">취소</button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => { setResetId(a.id); setResetPw('') }}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                        비밀번호 초기화
                      </button>
                      <button type="button" disabled={busyId === a.id} onClick={() => onToggleActive(a)}
                        className={`rounded-lg px-2 py-1 text-xs disabled:opacity-50 ${a.is_active
                          ? 'border border-red-200 text-red-600 hover:bg-red-50'
                          : 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}>
                        {a.is_active ? '사용 중지' : '다시 사용'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

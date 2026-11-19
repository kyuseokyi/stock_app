import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { listAdminUsers, setCommentBan, setMarketDataAccess, updateUserNickname } from '../api/moderation'
import { apiErrorDetail, apiErrorMessage } from '../lib/apiError'
import { formatDateTime, NICKNAME_MAX, providerLabel, validateNickname } from '../lib/moderation'
import { showToast } from '../lib/toast'
import type { AdminUserOut } from '../types/api'

// 회원 관리 — 검색·페이지 이동, 닉네임 강제 변경, 댓글 작성 금지 켜기/끄기, 시세 열람 권한 켜기/끄기.
// 설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §3·§6,
//       시세 열람 권한 docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 2-2(관리자는 항상 허용)

const PAGE_SIZE = 20

export default function MembersPage() {
  const [query, setQuery] = useState('') // 입력 중인 검색어
  const [q, setQ] = useState('') // 실제 조회에 쓰는 검색어(검색 버튼/엔터로 확정)
  const [page, setPage] = useState(1)
  const [marketOnly, setMarketOnly] = useState(false) // 시세 열람 권한 있는 회원만 보기
  const [items, setItems] = useState<AdminUserOut[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  // 닉네임 인라인 편집 상태
  const [editingId, setEditingId] = useState<number | null>(null)
  const [nickDraft, setNickDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listAdminUsers(q, page, PAGE_SIZE, marketOnly)
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      setError(apiErrorMessage(e, '회원 목록을 불러오지 못했습니다. 백엔드가 실행 중인지 확인하세요.'))
    } finally {
      setLoading(false)
    }
  }, [q, page, marketOnly])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPage(1)
    setQ(query.trim())
  }

  // 서버가 돌려준 회원 1명으로 표의 해당 행만 갈아끼운다(목록 재조회 없이 즉시 반영)
  const replaceRow = (updated: AdminUserOut) =>
    setItems((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))

  const startEdit = (u: AdminUserOut) => {
    setEditingId(u.id)
    setNickDraft(u.nickname ?? '')
  }

  const saveNickname = async (u: AdminUserOut) => {
    const invalid = validateNickname(nickDraft)
    if (invalid) {
      showToast(invalid, { icon: '⚠️' })
      return
    }
    setBusyId(u.id)
    setError('')
    try {
      replaceRow(await updateUserNickname(u.id, nickDraft.trim()))
      setEditingId(null)
      showToast('닉네임을 변경했습니다.', { icon: '✅' })
    } catch (e) {
      setError(apiErrorMessage(e, '닉네임 변경에 실패했습니다.'))
    } finally {
      setBusyId(null)
    }
  }

  const toggleBan = async (u: AdminUserOut) => {
    const next = !u.comment_banned
    const name = u.nickname ?? u.email ?? `#${u.id}`
    if (next && !confirm(`'${name}' 회원의 댓글 작성을 금지할까요?`)) return
    setBusyId(u.id)
    setError('')
    try {
      replaceRow(await setCommentBan(u.id, next))
      showToast(next ? '댓글 작성을 금지했습니다.' : '댓글 금지를 해제했습니다.', { icon: '✅' })
    } catch (e) {
      const msg =
        apiErrorDetail(e)?.code === 'CANNOT_BAN_ADMIN'
          ? '관리자 계정은 댓글 금지할 수 없습니다.'
          : apiErrorMessage(e, '댓글 금지 변경에 실패했습니다.')
      setError(msg)
    } finally {
      setBusyId(null)
    }
  }

  const toggleMarketAccess = async (u: AdminUserOut) => {
    const next = !u.market_data_access
    const name = u.nickname ?? u.email ?? `#${u.id}`
    if (
      next &&
      !confirm(
        `'${name}' 회원에게 시세 열람 권한을 줄까요?\n운영자 본인 확인용이에요. 다른 사람에게 주면 시세 재배포에 해당할 수 있어요.`,
      )
    )
      return
    setBusyId(u.id)
    setError('')
    try {
      const updated = await setMarketDataAccess(u.id, next)
      // 권한 있는 회원만 보는 중에 끄면 목록에서 빠지므로 다시 불러온다
      if (marketOnly && !next) await load()
      else replaceRow(updated)
      showToast(next ? '시세 열람 권한을 줬습니다.' : '시세 열람 권한을 뺐습니다.', { icon: '✅' })
    } catch (e) {
      const msg =
        apiErrorDetail(e)?.code === 'ADMIN_ALWAYS_ALLOWED'
          ? '관리자 계정은 항상 시세를 볼 수 있습니다.'
          : apiErrorMessage(e, '시세 열람 권한 변경에 실패했습니다.')
      setError(msg)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-slate-900">회원 관리</h2>

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-medium">시세 열람 권한</p>
        <p className="mt-1">
          사용자 시세 노출(스크리너 탭 설정)이 꺼져 있어도, 권한을 준 계정은 웹·앱에서 시세를 볼 수 있어요. 관리자 계정은
          항상 허용돼요.
        </p>
        <p className="mt-1 font-medium">
          ⚠️ 운영자 본인 확인용. 다른 사람에게 주면 시세 재배포에 해당할 수 있어요.
        </p>
      </div>

      <form
        onSubmit={onSearch}
        className="mb-6 flex gap-2 rounded-xl border border-slate-200 bg-white p-4"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="닉네임 또는 이메일 검색"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          검색
        </button>
        <label className="flex shrink-0 items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={marketOnly}
            onChange={(e) => {
              setPage(1)
              setMarketOnly(e.target.checked)
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
          시세 권한 있는 회원만
        </label>
      </form>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
      )}

      <p className="mb-2 text-sm text-slate-500">
        총 <span className="font-semibold text-slate-800">{total.toLocaleString()}</span>명
        {q && <span className="ml-1">· '{q}' 검색 결과</span>}
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">닉네임</th>
              <th className="px-4 py-3 font-medium">이메일</th>
              <th className="px-4 py-3 font-medium">가입 방식</th>
              <th className="px-4 py-3 font-medium">역할</th>
              <th className="px-4 py-3 font-medium">가입일</th>
              <th className="px-4 py-3 font-medium">댓글</th>
              <th className="px-4 py-3 font-medium">시세 열람</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  불러오는 중…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  회원이 없습니다.
                </td>
              </tr>
            ) : (
              items.map((u) => {
                const busy = busyId === u.id
                const isAdmin = u.role === 'ADMIN'
                const editing = editingId === u.id
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-400">{u.id}</td>
                    <td className="px-4 py-3">
                      {editing ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            saveNickname(u)
                          }}
                          className="flex items-center gap-1"
                        >
                          <input
                            value={nickDraft}
                            onChange={(e) => setNickDraft(e.target.value)}
                            maxLength={NICKNAME_MAX}
                            autoFocus
                            className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={busy}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs text-slate-500 hover:text-slate-800"
                          >
                            취소
                          </button>
                        </form>
                      ) : (
                        <span className="font-medium text-slate-800">{u.nickname ?? '-'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.email ?? '-'}</td>
                    <td className="px-4 py-3">{providerLabel(u.provider)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          isAdmin ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {formatDateTime(u.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {u.comment_banned ? (
                        <span
                          className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"
                          title={u.comment_banned_at ? `금지 시각 ${formatDateTime(u.comment_banned_at)}` : undefined}
                        >
                          작성 금지
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                          허용
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <span
                          className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700"
                          title="관리자 계정은 항상 시세를 볼 수 있습니다."
                        >
                          항상 허용
                        </span>
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!!u.market_data_access}
                          aria-label={`${u.nickname ?? u.email ?? u.id} 시세 열람 권한`}
                          disabled={busy}
                          onClick={() => toggleMarketAccess(u)}
                          className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
                            u.market_data_access ? 'bg-amber-500' : 'bg-slate-300'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
                              u.market_data_access ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3 whitespace-nowrap">
                        {!editing && (
                          <button
                            onClick={() => startEdit(u)}
                            disabled={busy}
                            className="text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                          >
                            닉네임 변경
                          </button>
                        )}
                        <button
                          onClick={() => toggleBan(u)}
                          disabled={busy || isAdmin}
                          title={isAdmin ? '관리자 계정은 댓글 금지할 수 없습니다.' : undefined}
                          className={`text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                            u.comment_banned
                              ? 'text-slate-500 hover:text-slate-800'
                              : 'text-red-500 hover:text-red-700'
                          }`}
                        >
                          {u.comment_banned ? '댓글 금지 해제' : '댓글 금지'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3 text-sm">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1 || loading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          이전
        </button>
        <span className="text-slate-500">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages || loading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          다음
        </button>
      </div>
    </div>
  )
}

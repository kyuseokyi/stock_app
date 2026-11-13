import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listCommentReports, resolveCommentReport } from '../api/moderation'
import { apiErrorDetail, apiErrorMessage } from '../lib/apiError'
import { formatDateTime, reasonCountEntries } from '../lib/moderation'
import { showToast } from '../lib/toast'
import type { ReportedCommentOut, ReportStatusFilter, ResolveAction } from '../types/api'

// 댓글 신고 관리 — 신고를 댓글 단위로 묶어 보여주고 [삭제]/[작성자 금지]/[기각]으로 처리한다.
// 설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §6

const FILTERS: Array<{ value: ReportStatusFilter; label: string }> = [
  { value: 'pending', label: '대기' },
  { value: 'all', label: '전체' },
]

const CONTENT_PREVIEW = 80 // 이 길이를 넘으면 말줄임 + [펼치기]

const CONFIRM_TEXT: Partial<Record<ResolveAction, string>> = {
  delete: '이 댓글을 삭제할까요?',
  ban_author: '작성자의 댓글 작성을 금지하고 이 댓글을 삭제할까요?',
}

const DONE_TEXT: Record<ResolveAction, string> = {
  delete: '댓글을 삭제했습니다.',
  ban_author: '작성자 댓글을 금지하고 댓글을 삭제했습니다.',
  dismiss: '신고를 기각했습니다.',
}

function ContentCell({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  const long = content.length > CONTENT_PREVIEW
  return (
    <div className="max-w-xs">
      <p className="whitespace-pre-wrap break-words text-slate-800">
        {long && !open ? `${content.slice(0, CONTENT_PREVIEW)}…` : content}
      </p>
      {long && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          {open ? '접기' : '펼치기'}
        </button>
      )}
    </div>
  )
}

export default function CommentReportsPage() {
  const [status, setStatus] = useState<ReportStatusFilter>('pending')
  const [rows, setRows] = useState<ReportedCommentOut[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await listCommentReports(status))
    } catch (e) {
      setError(apiErrorMessage(e, '신고 목록을 불러오지 못했습니다. 백엔드가 실행 중인지 확인하세요.'))
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    load()
  }, [load])

  const onResolve = async (row: ReportedCommentOut, action: ResolveAction) => {
    const ask = CONFIRM_TEXT[action]
    if (ask && !confirm(ask)) return
    setBusyId(row.comment_id)
    setError('')
    try {
      await resolveCommentReport(row.comment_id, action)
      showToast(DONE_TEXT[action], { icon: '✅' })
    } catch (e) {
      const code = apiErrorDetail(e)?.code
      const msg =
        code === 'CANNOT_BAN_ADMIN'
          ? '관리자 계정은 댓글 금지할 수 없습니다.'
          : apiErrorMessage(e, '신고 처리에 실패했습니다.')
      setError(msg)
      showToast(msg, { icon: '⚠️' })
    } finally {
      setBusyId(null)
      load() // 성공·실패(이미 처리된 404 등) 모두 최신 상태로
    }
  }

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-slate-900">신고 관리</h2>

      <div className="mb-4 flex items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              status === f.value
                ? 'bg-indigo-600 text-white'
                : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          새로고침
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">댓글 내용</th>
              <th className="px-4 py-3 font-medium">게시글</th>
              <th className="px-4 py-3 font-medium">작성자</th>
              <th className="px-4 py-3 font-medium">신고 수</th>
              <th className="px-4 py-3 font-medium">사유</th>
              <th className="px-4 py-3 font-medium">최근 신고</th>
              <th className="px-4 py-3 font-medium">가려짐</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  불러오는 중…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  처리할 신고가 없어요
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const busy = busyId === r.comment_id
                return (
                  <tr key={r.comment_id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <ContentCell content={r.content} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/blogs/${r.post_id}`}
                        className="line-clamp-2 max-w-[12rem] text-indigo-600 hover:underline"
                        title={r.post_title}
                      >
                        {r.post_title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-800">{r.author_nickname ?? `#${r.author_id}`}</span>
                      {r.author_comment_banned && (
                        <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                          작성 금지
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{r.report_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {reasonCountEntries(r.reason_counts).map(([label, n]) => (
                          <span
                            key={label}
                            className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                          >
                            {label} {n}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {formatDateTime(r.last_reported_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          r.hidden ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {r.hidden ? '가려짐' : '공개'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3 whitespace-nowrap">
                        <button
                          onClick={() => onResolve(r, 'delete')}
                          disabled={busy}
                          className="text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          댓글 삭제
                        </button>
                        <button
                          onClick={() => onResolve(r, 'ban_author')}
                          disabled={busy}
                          className="text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          작성자 댓글 금지
                        </button>
                        <button
                          onClick={() => onResolve(r, 'dismiss')}
                          disabled={busy}
                          className="text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
                        >
                          기각
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
    </div>
  )
}

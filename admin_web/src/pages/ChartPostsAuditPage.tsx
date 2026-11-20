import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listChartPosts } from '../api/moderation'
import { apiErrorMessage } from '../lib/apiError'
import { formatDateTime } from '../lib/moderation'
import type { ChartPostOut } from '../types/api'

// 차트 포함 글 점검 — 본문에 시세 차트 스냅샷(또는 내장 이미지)이 박힌 글을 찾아보는 조회 전용 화면.
// 정리(이미지 제거·글 삭제)는 관리자가 기존 편집 화면에서 직접 한다. 자동 수정·삭제 기능은 두지 않는다.
// 설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 3-6절, 6절 P1 7번

export default function ChartPostsAuditPage() {
  const [rows, setRows] = useState<ChartPostOut[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await listChartPosts())
      setLoaded(true)
    } catch (e) {
      setError(apiErrorMessage(e, '차트 포함 글 목록을 불러오지 못했습니다. 백엔드가 실행 중인지 확인하세요.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <h2 className="mb-4 text-2xl font-bold text-slate-900">차트 포함 글 점검</h2>

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        시세 차트 이미지는 거래소 시세 재배포 계약 없이 공개하면 안 됩니다. 글을 열어 차트 이미지를 지우거나 글을
        삭제하세요.
        <span className="mt-1 block text-xs text-amber-700">
          '기타 내장 이미지'는 본문에 직접 박힌 그 밖의 이미지입니다(차트 표식이 지워진 차트일 수 있으니 열어서
          확인하세요).
        </span>
      </div>

      <div className="mb-4 flex items-center">
        <span className="text-sm text-slate-500">{loaded ? `${rows.length}건` : ''}</span>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          새로고침
        </button>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">제목</th>
              <th className="px-4 py-3 font-medium">게시판</th>
              <th className="px-4 py-3 font-medium">작성일</th>
              <th className="px-4 py-3 font-medium">차트 수</th>
              <th className="px-4 py-3 font-medium">기타 내장 이미지</th>
              <th className="px-4 py-3 font-medium">메인 노출</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  불러오는 중…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  {loaded ? '차트가 들어간 글이 없습니다.' : '-'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/blogs/${r.id}/edit`}
                      className="line-clamp-2 max-w-[18rem] font-medium text-indigo-600 hover:underline"
                      title={`${r.title} — 편집 화면 열기`}
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.board_name ?? `#${r.board_id}`}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateTime(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={r.chart_count > 0 ? 'font-semibold text-red-600' : 'text-slate-400'}>
                      {r.chart_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={r.other_inline_images > 0 ? 'font-semibold text-amber-700' : 'text-slate-400'}>
                      {r.other_inline_images}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        r.featured ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {r.featured ? '메인 노출' : '-'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

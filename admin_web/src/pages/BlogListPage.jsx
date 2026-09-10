import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listBoards } from '../api/boards'
import { deleteBlog, listBlogs } from '../api/blogs'
import { showToast } from '../lib/toast'

const PAGE_SIZE = 10

export default function BlogListPage() {
  const navigate = useNavigate()
  const [boards, setBoards] = useState([])
  const [boardId, setBoardId] = useState('')
  const [data, setData] = useState({ total: 0, items: [], page: 1, size: PAGE_SIZE })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listBoards().then(setBoards).catch(() => {})
  }, [])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await listBlogs({
        boardId: boardId === '' ? undefined : Number(boardId),
        page,
        size: PAGE_SIZE,
      })
      setData(res)
    } catch {
      setError('게시글 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, page])

  const boardName = (id) => boards.find((b) => b.id === id)?.name ?? '-'
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))

  const onDelete = async (id) => {
    if (!confirm('이 게시글을 삭제할까요?')) return
    const prev = data
    // 낙관적 제거: 목록을 통째로 다시 그리지 않고 해당 행만 즉시 제거(깜빡임 방지)
    setData((d) => ({
      ...d,
      items: d.items.filter((i) => i.id !== id),
      total: Math.max(0, d.total - 1),
    }))
    try {
      await deleteBlog(id)
      showToast('게시글을 삭제했습니다.', { icon: '✅' })
      load() // 총계·페이지 동기화(목록은 유지된 채 백그라운드 갱신)
    } catch {
      setData(prev) // 실패 시 롤백
      showToast('삭제에 실패했습니다.', { icon: '⚠️' })
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-slate-900">게시글 관리</h2>
        <Link
          to="/blogs/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + 새 글 작성
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-slate-500">게시판</label>
        <select
          value={boardId}
          onChange={(e) => {
            setPage(1)
            setBoardId(e.target.value)
          }}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">전체</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">제목</th>
              <th className="px-4 py-3 font-medium">게시판</th>
              <th className="px-4 py-3 font-medium">작성일</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && data.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  불러오는 중…
                </td>
              </tr>
            ) : data.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  게시글이 없습니다.
                </td>
              </tr>
            ) : (
              data.items.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-400">{p.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <button
                      onClick={() => navigate(`/blogs/${p.id}`)}
                      className="hover:text-indigo-600 hover:underline"
                    >
                      {p.title}
                    </button>
                  </td>
                  <td className="px-4 py-3">{boardName(p.board_id)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(p.created_at).toLocaleString('ko-KR')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/blogs/${p.id}/edit`}
                      className="mr-3 text-sm font-medium text-indigo-500 hover:text-indigo-700"
                    >
                      수정
                    </Link>
                    <button
                      onClick={() => onDelete(p.id)}
                      className="text-sm font-medium text-red-500 hover:text-red-700"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>
          총 {data.total}건{loading && data.items.length > 0 ? ' · 갱신 중…' : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            이전
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { listBlogs } from '../api/blog'
import { useBoardStore } from '../store/boards'

const PAGE_SIZE = 10

// HTML 본문에서 태그를 제거해 미리보기 텍스트 생성
const toPreview = (html, n = 100) => {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > n ? text.slice(0, n) + '…' : text
}

export default function PostListPage() {
  const { boardId } = useParams()
  const boardName = useBoardStore((s) => s.boardName)
  const [data, setData] = useState({ total: 0, items: [] })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setPage(1)
  }, [boardId])

  useEffect(() => {
    setLoading(true)
    listBlogs({ boardId: Number(boardId), page, size: PAGE_SIZE })
      .then(setData)
      .catch(() => setError('게시글을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [boardId, page])

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))

  return (
    <div>
      <h1 className="mb-5 text-xl font-bold text-slate-900">
        {boardName(Number(boardId)) || '게시판'}
      </h1>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
      )}

      {loading ? (
        <p className="py-10 text-center text-slate-400">불러오는 중…</p>
      ) : data.items.length === 0 ? (
        <p className="py-10 text-center text-slate-400">아직 게시글이 없습니다.</p>
      ) : (
        <ul className="space-y-3">
          {data.items.map((p) => (
            <li key={p.id}>
              <Link
                to={`/posts/${p.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm"
              >
                <h2 className="font-semibold text-slate-900">{p.title}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                  {toPreview(p.content)}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {new Date(p.created_at).toLocaleDateString('ko-KR')} · 조회 {p.view_count}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data.total > PAGE_SIZE && (
        <div className="mt-6 flex items-center justify-center gap-3 text-sm text-slate-500">
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
      )}
    </div>
  )
}

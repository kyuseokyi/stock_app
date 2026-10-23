import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { listBlogs } from '../api/blog'
import { useBoardStore } from '../store/boards'
import { withErrorCode } from '../lib/errorCode'
import type { BlogListOut } from '../types/api'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import { Skeleton } from '../components/ui/Skeleton'
import FeaturedPosts from '../components/home/FeaturedPosts'
import { useMediaQuery } from '../hooks/useMediaQuery'

const PAGE_SIZE = 10

// HTML 본문에서 태그를 제거해 미리보기 텍스트 생성
const toPreview = (html: string, n = 100) => {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > n ? text.slice(0, n) + '…' : text
}

export default function PostListPage() {
  const { boardId } = useParams()
  const boardName = useBoardStore((s) => s.boardName)
  const [data, setData] = useState<Pick<BlogListOut, 'total' | 'items'>>({ total: 0, items: [] })
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
      .catch((err) => setError(withErrorCode('게시글을 불러오지 못했어요.', err)))
      .finally(() => setLoading(false))
  }, [boardId, page])

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  // 넓은 화면(lg+): 목록 + 추천 글 옆 칸 2단. 좁은 화면은 옆 칸을 그리지 않는다(불필요한 요청 없음).
  const wide = useMediaQuery('(min-width: 1024px)')

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
      <div>
        <PageHeader title={boardName(Number(boardId)) || '게시판'} className="mb-5" />

        {error && (
          <p className="mb-4 rounded-field bg-danger-soft px-4 py-2 text-sm text-danger">{error}</p>
        )}

        {loading ? (
          <div aria-busy="true" className="space-y-3">
            <p role="status" className="sr-only">게시글을 불러오고 있어요</p>
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-card" />)}
          </div>
        ) : data.items.length === 0 ? (
          <p className="py-10 text-center text-ink-muted">아직 게시글이 없어요.</p>
        ) : (
          <ul className="space-y-3">
            {data.items.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/posts/${p.id}`}
                  className="block rounded-card bg-surface p-4 transition hover:bg-line"
                >
                  <h2 className="text-balance font-semibold text-ink">{p.title}</h2>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
                    {toPreview(p.content)}
                  </p>
                  <p className="mt-2 text-xs text-ink-muted">
                    {new Date(p.created_at).toLocaleDateString('ko-KR')} · 조회 {p.view_count}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {data.total > PAGE_SIZE && (
          <nav aria-label="페이지" className="mt-6 flex items-center justify-center gap-3 text-sm text-ink-muted">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              이전
            </Button>
            <span aria-current="page" className="tabular-nums">
              {page} / {totalPages}
            </span>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              다음
            </Button>
          </nav>
        )}
      </div>
      {wide && (
        <aside aria-label="추천 글">
          <FeaturedPosts limit={4} more={false} />
        </aside>
      )}
    </div>
  )
}

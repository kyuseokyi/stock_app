import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { blogQueries } from '../queries/blogQueries'
import { useBoardStore } from '../store/boards'
import { withErrorCode } from '../lib/errorCode'
import type { BlogListOut } from '../types/api'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import { Skeleton } from '../components/ui/Skeleton'
import FeaturedPosts from '../components/home/FeaturedPosts'
import AdSlot from '../components/ads/AdSlot'
import { useAdConfig } from '../hooks/useAdConfig'
import { infeedInterval, isInfeedAfter } from '../lib/ads'
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
  const [page, setPage] = useState(1)
  const ads = useAdConfig()
  const adEvery = infeedInterval(ads, 'WEB_POST_LIST_INFEED')

  useEffect(() => {
    setPage(1)
  }, [boardId])

  const query = useQuery(blogQueries.posts(Number(boardId), page, PAGE_SIZE))
  const loading = query.isPending
  // 지금 동작 유지 — 불러오기에 실패해도 마지막으로 받은 목록·쪽 이동은 남기고, 오류 안내는 한 번 뜨면 화면을 떠날 때까지 둔다
  const [data, setData] = useState<Pick<BlogListOut, 'total' | 'items'>>({ total: 0, items: [] })
  if (query.data && query.data !== data) setData(query.data)
  const [error, setError] = useState('')
  const [seenError, setSeenError] = useState<unknown>(null)
  if (query.error && query.error !== seenError) {
    setSeenError(query.error)
    setError(withErrorCode('게시글을 불러오지 못했어요.', query.error))
  }

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
            {data.items.map((p, i) => (
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
                {/* 광고 자리(WEB_POST_LIST_INFEED) — interval 번째 글 뒤에 한 번, 글 카드와 같은 높이 */}
                {isInfeedAfter(i, data.items.length, adEvery) && (
                  <AdSlot config={ads} slotKey="WEB_POST_LIST_INFEED" className="mt-3 min-h-[124px]" />
                )}
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

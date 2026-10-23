import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listBlogs } from '../../api/blog'
import { withErrorCode } from '../../lib/errorCode'
import type { BlogListOut } from '../../types/api'

// 추천 글(관리자가 고른 글, featured_at 최신순) — 홈 아래쪽. 앱 홈 탭과 같은 데이터.
const toPreview = (html: string, n = 100) => {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > n ? text.slice(0, n) + '…' : text
}

export default function FeaturedPosts({ limit }: { limit: number }) {
  const [items, setItems] = useState<BlogListOut['items']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listBlogs({ featured: true, size: limit })
      .then((res) => setItems(res.items))
      .catch((err) => setError(withErrorCode('추천 글을 불러오지 못했어요.', err)))
      .finally(() => setLoading(false))
  }, [limit])

  return (
    <section aria-labelledby="featured-title">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="featured-title" className="text-lg font-bold text-ink">추천 글</h2>
        <Link to="/community" className="text-sm font-medium text-brand-strong">커뮤니티 ›</Link>
      </div>
      {error && <p className="rounded-field bg-danger-soft px-4 py-2 text-sm text-danger">{error}</p>}
      {loading ? (
        <p className="py-6 text-center text-sm text-ink-muted">추천 글을 불러오고 있어요</p>
      ) : items.length === 0 && !error ? (
        <p className="py-6 text-center text-sm text-ink-muted">아직 추천 글이 없어요.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id}>
              <Link to={`/posts/${p.id}`} className="block rounded-card bg-surface p-4 transition hover:bg-line">
                <h3 className="text-balance font-semibold text-ink">{p.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{toPreview(p.content)}</p>
                <p className="mt-2 text-xs text-ink-muted">
                  {new Date(p.created_at).toLocaleDateString('ko-KR')} · 조회 {p.view_count}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

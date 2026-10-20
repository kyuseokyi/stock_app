import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listBlogs } from '../api/blog'
import { withErrorCode } from '../lib/errorCode'
import type { BlogListOut } from '../types/api'

// 홈(/) — 📌 추천 글(관리자가 고른 글, featured_at 최신순). 앱 홈 탭과 같은 내용.
const toPreview = (html: string, n = 100) => {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > n ? text.slice(0, n) + '…' : text
}

export default function HomePage() {
  const [items, setItems] = useState<BlogListOut['items']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listBlogs({ featured: true, size: 20 })
      .then((res) => setItems(res.items))
      .catch((err) => setError(withErrorCode('추천 글을 불러오지 못했습니다.', err)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <h1 className="mb-5 text-xl font-bold text-ink">📌 추천 글</h1>

      {error && <p className="mb-4 rounded-field bg-up/10 px-4 py-2 text-sm text-up">{error}</p>}

      {loading ? (
        <p className="py-10 text-center text-ink-muted">불러오는 중…</p>
      ) : items.length === 0 && !error ? (
        <div className="py-10 text-center text-ink-muted">
          <p>아직 추천 글이 없습니다.</p>
          <Link to="/community" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
            커뮤니티 둘러보기 ›
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.id}>
              <Link to={`/posts/${p.id}`} className="block rounded-card bg-surface p-4 transition hover:bg-line">
                <h2 className="font-semibold text-ink">{p.title}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{toPreview(p.content)}</p>
                <p className="mt-2 text-xs text-ink-muted">
                  {new Date(p.created_at).toLocaleDateString('ko-KR')} · 조회 {p.view_count}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

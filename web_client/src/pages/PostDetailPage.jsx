import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getBlog, listComments } from '../api/blog'
import { useBoardStore } from '../store/boards'

export default function PostDetailPage() {
  const { id } = useParams()
  const boards = useBoardStore((s) => s.boards)
  const [post, setPost] = useState(null)
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([getBlog(id), listComments(id)])
      .then(([p, c]) => {
        setPost(p)
        setComments(c)
      })
      .catch(() => setError('게시글을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <p className="py-10 text-center text-slate-400">불러오는 중…</p>
  if (!post) return <p className="py-10 text-center text-red-500">{error}</p>

  const board = boards.find((b) => b.id === post.board_id)
  const commentsEnabled = board?.comments_enabled ?? true

  return (
    <div>
      <Link to={board ? `/boards/${board.id}` : '/'} className="text-sm text-slate-500 hover:text-indigo-600">
        ← 목록으로
      </Link>

      <article className="mt-3 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        {board && (
          <span className="mb-2 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
            {board.name}
          </span>
        )}
        <h1 className="mb-2 text-2xl font-bold text-slate-900">{post.title}</h1>
        <p className="mb-6 text-sm text-slate-400">
          {new Date(post.created_at).toLocaleString('ko-KR')} · 조회 {post.view_count}
        </p>
        <div
          className="post-content text-slate-800"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </article>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="mb-4 text-lg font-bold text-slate-900">
          댓글 <span className="text-indigo-600">{comments.length}</span>
        </h2>

        <ul className="space-y-3">
          {comments.length === 0 ? (
            <li className="py-4 text-center text-sm text-slate-400">아직 댓글이 없습니다.</li>
          ) : (
            comments.map((c) => (
              <li key={c.id} className="rounded-lg bg-slate-50 px-4 py-3">
                <p className="text-sm font-medium text-slate-700">
                  {c.author_name || '익명'}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {new Date(c.created_at).toLocaleString('ko-KR')}
                  </span>
                </p>
                <p className="mt-1 text-sm text-slate-800">{c.content}</p>
              </li>
            ))
          )}
        </ul>

        {/* 일반 유저 로그인 도입 전까지 댓글은 읽기 전용 */}
        <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-center text-sm text-slate-400">
          {commentsEnabled
            ? '댓글 작성은 로그인 기능 도입 후 제공됩니다.'
            : '이 게시판은 댓글이 비활성화되어 있습니다.'}
        </p>
      </section>
    </div>
  )
}

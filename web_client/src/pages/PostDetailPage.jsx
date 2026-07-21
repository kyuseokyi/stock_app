import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createComment, getBlog, listComments } from '../api/blog'
import { useBoardStore } from '../store/boards'
import { useAuthStore } from '../store/auth'
import LoginModal from '../components/LoginModal'

export default function PostDetailPage() {
  const { id } = useParams()
  const boards = useBoardStore((s) => s.boards)
  const user = useAuthStore((s) => s.user)
  const [post, setPost] = useState(null)
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [loginOpen, setLoginOpen] = useState(false)

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

  const submitComment = async (e) => {
    e.preventDefault()
    const text = content.trim()
    if (!text) return
    setSubmitting(true)
    setCommentError('')
    try {
      const created = await createComment(id, text)
      setComments((prev) => [...prev, created])
      setContent('')
    } catch (err) {
      if (err.response?.status === 401) {
        setCommentError('로그인이 만료되었습니다. 다시 로그인해 주세요.')
      } else if (err.response?.status === 403) {
        setCommentError('이 게시판은 댓글이 비활성화되어 있습니다.')
      } else {
        setCommentError('댓글 등록에 실패했습니다.')
      }
    } finally {
      setSubmitting(false)
    }
  }

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

        {/* 댓글 작성 영역 */}
        {!commentsEnabled ? (
          <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-center text-sm text-slate-400">
            이 게시판은 댓글이 비활성화되어 있습니다.
          </p>
        ) : user ? (
          <form onSubmit={submitComment} className="mt-5">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={`${user.nickname} 님, 댓글을 입력하세요`}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            {commentError && <p className="mt-1 text-sm text-red-500">{commentError}</p>}
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={submitting || !content.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? '등록 중…' : '댓글 등록'}
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setLoginOpen(true)}
            className="mt-5 w-full rounded-lg bg-slate-50 px-4 py-3 text-center text-sm text-indigo-600 hover:bg-slate-100"
          >
            로그인하고 댓글 작성하기
          </button>
        )}
      </section>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}

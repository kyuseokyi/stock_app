import { type FormEvent, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createComment, getBlog, listComments } from '../api/blog'
import { useBoardStore } from '../store/boards'
import { useAuthStore } from '../store/auth'
import { withErrorCode } from '../lib/errorCode'
import LoginModal from '../components/LoginModal'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import type { AxiosError } from 'axios'
import type { BlogOut, CommentOut } from '../types/api'

export default function PostDetailPage() {
  // posts/:id 라우트 전용 → id 는 항상 존재(타입상 string | undefined). `!` 는 타입 표기용.
  const id = useParams().id!
  const boards = useBoardStore((s) => s.boards)
  const user = useAuthStore((s) => s.user)
  const [post, setPost] = useState<BlogOut | null>(null)
  const [comments, setComments] = useState<CommentOut[]>([])
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
      .catch((err) => setError(withErrorCode('게시글을 불러오지 못했습니다.', err)))
      .finally(() => setLoading(false))
  }, [id])

  const submitComment = async (e: FormEvent<HTMLFormElement>) => {
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
      const status = (err as AxiosError).response?.status
      if (status === 401) {
        setCommentError('로그인이 만료되었습니다. 다시 로그인해 주세요.')
      } else if (status === 403) {
        setCommentError('이 게시판은 댓글이 비활성화되어 있습니다.')
      } else {
        setCommentError('댓글 등록에 실패했습니다.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="py-10 text-center text-ink-muted">불러오는 중…</p>
  if (!post) return <p className="py-10 text-center text-up">{error}</p>

  const board = boards.find((b) => b.id === post.board_id)
  const commentsEnabled = board?.comments_enabled ?? true

  return (
    <div>
      <Link to={board ? `/boards/${board.id}` : '/'} className="text-sm text-ink-muted hover:text-brand">
        ← 목록으로
      </Link>

      <Card as="article" className="mt-3 sm:p-6">
        {board && (
          <span className="mb-2 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
            {board.name}
          </span>
        )}
        <h1 className="mb-2 text-2xl font-bold text-ink">{post.title}</h1>
        <p className="mb-6 text-sm text-ink-muted">
          {new Date(post.created_at).toLocaleString('ko-KR')} · 조회 {post.view_count}
        </p>
        <div
          className="post-content text-ink"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </Card>

      <Card as="section" className="mt-6 sm:p-6">
        <h2 className="mb-4 text-lg font-bold text-ink">
          댓글 <span className="text-brand">{comments.length}</span>
        </h2>

        <ul className="space-y-3">
          {comments.length === 0 ? (
            <li className="py-4 text-center text-sm text-ink-muted">아직 댓글이 없습니다.</li>
          ) : (
            comments.map((c) => (
              <li key={c.id} className="rounded-field bg-canvas px-4 py-3">
                <p className="text-sm font-medium text-ink">
                  {c.author_name || '익명'}
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    {new Date(c.created_at).toLocaleString('ko-KR')}
                  </span>
                </p>
                <p className="mt-1 text-sm text-ink">{c.content}</p>
              </li>
            ))
          )}
        </ul>

        {/* 댓글 작성 영역 */}
        {!commentsEnabled ? (
          <p className="mt-5 rounded-field bg-canvas px-4 py-3 text-center text-sm text-ink-muted">
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
              className="w-full rounded-field border border-line bg-fill px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
            {commentError && <p className="mt-1 text-sm text-up">{commentError}</p>}
            <div className="mt-2 flex justify-end">
              <Button
                type="submit"
                disabled={submitting || !content.trim()}
                loading={submitting}
                loadingText="등록 중…"
              >
                댓글 등록
              </Button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setLoginOpen(true)}
            className="mt-5 w-full rounded-field bg-canvas px-4 py-3 text-center text-sm text-brand hover:brightness-95"
          >
            로그인하고 댓글 작성하기
          </button>
        )}
      </Card>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getBlog } from '../api/blogs'
import { listBoards } from '../api/boards'
import {
  createComment,
  deleteComment,
  listComments,
} from '../api/comments'

export default function BlogDetailPage() {
  const { id } = useParams()
  const [post, setPost] = useState(null)
  const [boardName, setBoardName] = useState('')
  const [commentsEnabled, setCommentsEnabled] = useState(true)
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const loadComments = async () => {
    try {
      setComments(await listComments(id))
    } catch {
      setError('댓글을 불러오지 못했습니다.')
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        const p = await getBlog(id)
        setPost(p)
        const boards = await listBoards()
        const b = boards.find((bd) => bd.id === p.board_id)
        setBoardName(b?.name ?? '-')
        setCommentsEnabled(b?.comments_enabled ?? true)
        await loadComments()
      } catch {
        setError('게시글을 불러오지 못했습니다.')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const onAddComment = async (e) => {
    e.preventDefault()
    if (!newComment.trim()) return
    try {
      await createComment(id, newComment.trim())
      setNewComment('')
      loadComments()
    } catch {
      setError('댓글 작성에 실패했습니다.')
    }
  }

  const onDeleteComment = async (commentId) => {
    if (!confirm('이 댓글을 삭제할까요?')) return
    try {
      await deleteComment(commentId)
      loadComments()
    } catch {
      setError('댓글 삭제에 실패했습니다.')
    }
  }

  if (loading) return <p className="text-slate-400">불러오는 중…</p>
  if (!post) return <p className="text-red-500">{error || '게시글이 없습니다.'}</p>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link to="/blogs" className="text-sm text-slate-500 hover:text-indigo-600">
          ← 목록으로
        </Link>
        <Link
          to={`/blogs/${post.id}/edit`}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          수정
        </Link>
      </div>

      {/* 게시글 본문 */}
      <article className="mb-8 rounded-xl border border-slate-200 bg-white p-6">
        <span className="mb-2 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
          {boardName}
        </span>
        <h1 className="mb-2 text-2xl font-bold text-slate-900">{post.title}</h1>
        <p className="mb-6 text-sm text-slate-400">
          {new Date(post.created_at).toLocaleString('ko-KR')}
        </p>
        {/* 관리자 작성 HTML. 사용자 조회 화면 도입 시 sanitize 처리 예정. */}
        <div
          className="text-slate-800"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </article>

      {/* 댓글 */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-bold text-slate-900">
          댓글 <span className="text-indigo-600">{comments.length}</span>
        </h2>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <ul className="mb-5 space-y-3">
          {comments.length === 0 ? (
            <li className="py-4 text-center text-sm text-slate-400">
              아직 댓글이 없습니다.
            </li>
          ) : (
            comments.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between rounded-lg bg-slate-50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    {c.author_name || '익명'}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {new Date(c.created_at).toLocaleString('ko-KR')}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-800">{c.content}</p>
                </div>
                <button
                  onClick={() => onDeleteComment(c.id)}
                  className="ml-3 shrink-0 text-xs font-medium text-red-500 hover:text-red-700"
                >
                  삭제
                </button>
              </li>
            ))
          )}
        </ul>

        {commentsEnabled ? (
          <form onSubmit={onAddComment} className="flex gap-2">
            <input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="댓글을 입력하세요"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              등록
            </button>
          </form>
        ) : (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-center text-sm text-slate-400">
            이 게시판은 댓글이 비활성화되어 있습니다.
          </p>
        )}
      </section>
    </div>
  )
}

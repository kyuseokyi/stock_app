import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { Link, useParams } from 'react-router-dom'
import { createComment, getBlog, listComments } from '../api/blog'
import CommentMenuModal from '../components/CommentMenuModal'
import { commentErrorMessage, commentMenu, commentView, errorParts } from '../lib/commentActions'
import { useBoardStore } from '../store/boards'
import { useAuthStore } from '../store/auth'
import { withErrorCode } from '../lib/errorCode'
import { formatKstShort } from '../lib/format'
import LoginModal from '../components/LoginModal'
import Card from '../components/ui/Card'
import AdSlot from '../components/ads/AdSlot'
import { useAdConfig } from '../hooks/useAdConfig'
import Button from '../components/ui/Button'
import type { BlogOut, CommentOut } from '../types/api'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

// 댓글 목록은 토큰 선택이지만 잘못된·만료 토큰이면 401 — 인터셉터가 로그아웃(저장 토큰 삭제)한 뒤 한 번만 익명으로 다시 받는다
// (글 본문과 Promise.all 로 묶여 있어 그대로 두면 글 화면 전체가 "불러오지 못했어요"가 된다)
const loadComments = (blogId: string): Promise<CommentOut[]> =>
  listComments(blogId).catch((err: unknown) => {
    if (axios.isAxiosError(err) && err.response?.status === 401) return listComments(blogId)
    throw err
  })

export default function PostDetailPage() {
  // posts/:id 라우트 전용 → id 는 항상 존재(타입상 string | undefined). `!` 는 타입 표기용.
  const id = useParams().id!
  const boards = useBoardStore((s) => s.boards)
  const user = useAuthStore((s) => s.user)
  const [post, setPost] = useState<BlogOut | null>(null)
  useDocumentTitle(post?.title)
  const [comments, setComments] = useState<CommentOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [loginOpen, setLoginOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<CommentOut | null>(null) // ⋯ 메뉴를 연 댓글
  const ads = useAdConfig()

  useEffect(() => {
    setLoading(true)
    Promise.all([getBlog(id), loadComments(id)])
      .then(([p, c]) => {
        setPost(p)
        setComments(c)
      })
      .catch((err) => setError(withErrorCode('게시글을 불러오지 못했어요.', err)))
      .finally(() => setLoading(false))
  }, [id])

  // 신고·차단·삭제 뒤 목록 새로고침(서버가 신고·차단한 댓글을 빼고 준다) — 실패는 조용히(기존 목록 유지)
  const reloadComments = useCallback(() => {
    loadComments(id)
      .then(setComments)
      .catch(() => {})
  }, [id])

  // 로그인·로그아웃으로 사용자가 바뀌면 댓글을 다시 받는다(is_mine·차단 반영이 사용자마다 다름). 첫 렌더는 위 effect 가 받음.
  const userId = user?.id ?? null
  const prevUserId = useRef(userId)
  useEffect(() => {
    if (prevUserId.current === userId) return
    prevUserId.current = userId
    reloadComments()
  }, [userId, reloadComments])

  const submitComment = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const text = content.trim()
    if (!text) return
    setSubmitting(true)
    setCommentError('')
    try {
      const created = await createComment(id, text)
      setComments((prev) => [...prev, { ...created, is_mine: true }]) // 방금 내가 쓴 댓글
      setContent('')
    } catch (err) {
      // 403 은 코드별(COMMENT_BANNED·TERMS_REQUIRED), 코드 없으면 기존 "댓글을 받지 않아요"
      const { status, body } = errorParts(err)
      setCommentError(commentErrorMessage('submit', status, body))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="py-10 text-center text-ink-muted">불러오는 중…</p>
  if (!post) return <p className="py-10 text-center text-danger">{error}</p>

  const board = boards.find((b) => b.id === post.board_id)
  const commentsEnabled = board?.comments_enabled ?? true
  // 열린 ⋯ 메뉴의 항목(로그아웃되면 'login' 이 돼 모달이 닫힌다)
  const openMenu = menuFor ? commentMenu(menuFor, Boolean(user)) : null

  return (
    <div>
      <Link to={board ? `/boards/${board.id}` : '/'} className="text-sm text-ink-muted hover:text-brand-strong">
        ← 목록으로
      </Link>

      <Card as="article" className="mt-3 sm:p-6">
        {board && (
          <span className="mb-2 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-strong">
            {board.name}
          </span>
        )}
        <h1 className="mb-2 text-2xl font-bold text-ink">{post.title}</h1>
        <p className="mb-6 text-sm text-ink-muted">
          {formatKstShort(post.created_at)} · 조회 {post.view_count}
        </p>
        <div
          className="post-content text-ink"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </Card>

      {/* 광고 자리(WEB_POST_DETAIL_BOTTOM) — 본문이 끝나고 댓글로 넘어가기 전 */}
      <AdSlot config={ads} slotKey="WEB_POST_DETAIL_BOTTOM" className="mt-6 min-h-[100px]" />

      <Card as="section" className="mt-6 sm:p-6">
        <h2 className="mb-4 text-lg font-bold text-ink">
          댓글 <span className="text-brand-strong">{comments.length}</span>
        </h2>

        <ul className="space-y-3">
          {comments.length === 0 ? (
            <li className="py-4 text-center text-sm text-ink-muted">아직 댓글이 없어요.</li>
          ) : (
            comments.map((c) => {
              const view = commentView(c, '익명')
              if (view.hidden) {
                return (
                  <li key={c.id} className="rounded-field bg-canvas px-4 py-3 text-sm text-ink-muted">
                    {view.text}
                  </li>
                )
              }
              const menu = commentMenu(c, Boolean(user))
              return (
                <li key={c.id} className="rounded-field bg-canvas px-4 py-3">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-sm font-medium text-ink">
                      {view.author}
                      <span className="ml-2 text-xs font-normal text-ink-muted">
                        {formatKstShort(c.created_at)}
                      </span>
                    </p>
                    {menu.kind !== 'none' && (
                      <button
                        type="button"
                        onClick={() => (menu.kind === 'login' ? setLoginOpen(true) : setMenuFor(c))}
                        aria-label="댓글 메뉴"
                        aria-haspopup="dialog"
                        className="-my-2 -mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-fill hover:text-ink"
                      >
                        <span aria-hidden className="text-base font-bold leading-none">⋯</span>
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink">{view.text}</p>
                </li>
              )
            })
          )}
        </ul>

        {/* 댓글 작성 영역 */}
        {!commentsEnabled ? (
          <p className="mt-5 rounded-field bg-canvas px-4 py-3 text-center text-sm text-ink-muted">
            이 게시판은 댓글을 받지 않아요.
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
            {commentError && <p className="mt-1 text-sm text-danger">{commentError}</p>}
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
            className="mt-5 w-full rounded-field bg-canvas px-4 py-3 text-center text-sm text-brand-strong hover:brightness-95"
          >
            로그인하고 댓글 작성하기
          </button>
        )}
      </Card>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      {menuFor && openMenu?.kind === 'actions' && (
        <CommentMenuModal
          comment={menuFor}
          actions={openMenu.actions}
          onClose={() => setMenuFor(null)}
          onChanged={reloadComments}
        />
      )}
    </div>
  )
}

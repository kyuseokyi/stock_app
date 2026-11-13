import { useState } from 'react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { blockUser, deleteComment, reportComment } from '../api/blog'
import { showToast } from '../store/toast'
import {
  buildReportBody,
  canSubmitReport,
  commentErrorMessage,
  detailCode,
  errorParts,
  REPORT_DETAIL_MAX,
  REPORT_REASONS,
  TOAST_BLOCKED,
  TOAST_DELETED,
  TOAST_REPORTED,
  type CommentAction,
  type CommentMenuAction,
} from '../lib/commentActions'
import type { CommentOut, ReportReason } from '../types/api'

type Step = 'menu' | 'report' | 'block' | 'delete'

interface Props {
  comment: CommentOut
  actions: CommentMenuAction[]
  onClose: () => void
  /** 신고·차단·삭제 성공(또는 이미 삭제된 댓글) — 호출부가 목록을 새로고침 */
  onChanged: () => void
}

const MENU_LABEL: Record<CommentMenuAction, string> = { delete: '삭제', report: '신고', block: '이 사용자 차단' }
const TITLE: Record<Step, string> = { menu: '댓글', report: '댓글 신고', block: '이 사용자 차단', delete: '댓글 삭제' }

// 댓글 ⋯ 메뉴 — 메뉴 → (신고 | 차단 확인 | 삭제 확인)을 모달 하나에서 단계만 바꾼다. 열 때 마운트·닫을 때 언마운트(Modal 패턴).
export default function CommentMenuModal({ comment, actions, onClose, onChanged }: Props) {
  const [step, setStep] = useState<Step>(actions.length === 1 ? actions[0] : 'menu')
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [detail, setDetail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const run = async (action: CommentAction, task: () => Promise<unknown>, toast: string) => {
    setSubmitting(true)
    setError('')
    try {
      await task()
      showToast(toast)
      onChanged()
      onClose()
    } catch (e) {
      setSubmitting(false)
      const { status, body } = errorParts(e)
      setError(commentErrorMessage(action, status, body))
      if (detailCode(body) === 'COMMENT_NOT_FOUND') onChanged() // 이미 사라진 댓글 — 목록을 맞춘다
    }
  }

  const submitReport = () => {
    if (!reason || !canSubmitReport(reason, detail)) return
    void run('report', () => reportComment(comment.id, buildReportBody(reason, detail)), TOAST_REPORTED)
  }
  const submitBlock = () => {
    const authorId = comment.author_id
    if (authorId == null) return
    void run('block', () => blockUser(authorId), TOAST_BLOCKED)
  }
  const submitDelete = () => void run('delete', () => deleteComment(comment.id), TOAST_DELETED)

  const errorLine = error && (
    <p role="alert" className="mt-3 text-sm text-danger">
      {error}
    </p>
  )

  return (
    <Modal title={TITLE[step]} onClose={submitting ? () => {} : onClose} narrow>
      {step === 'menu' && (
        <ul className="-mx-2">
          {actions.map((a) => (
            <li key={a}>
              <button
                type="button"
                onClick={() => setStep(a)}
                className={`flex min-h-12 w-full items-center rounded-field px-2 text-left text-base font-semibold hover:bg-fill ${
                  a === 'report' ? 'text-ink' : 'text-danger'
                }`}
              >
                {MENU_LABEL[a]}
              </button>
            </li>
          ))}
        </ul>
      )}

      {step === 'report' && (
        <div>
          <p className="text-sm text-ink-muted">신고 사유를 골라 주세요. 여러 명이 신고하면 댓글이 가려져요.</p>
          <fieldset className="mt-3">
            <legend className="sr-only">신고 사유</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r.value} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
                <input
                  type="radio"
                  name="report-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="h-4 w-4 accent-brand"
                />
                {r.label}
              </label>
            ))}
          </fieldset>
          {reason === 'other' && (
            <div className="mt-2">
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                maxLength={REPORT_DETAIL_MAX}
                placeholder="신고 사유를 적어 주세요"
                aria-label="신고 사유 직접 입력"
                autoFocus
                className="w-full rounded-field border border-line bg-fill px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <p className="text-right text-xs text-ink-muted">
                {detail.trim().length}/{REPORT_DETAIL_MAX}
              </p>
            </div>
          )}
          {errorLine}
          <Button
            className="mt-4"
            full
            onClick={submitReport}
            disabled={!canSubmitReport(reason, detail)}
            loading={submitting}
            loadingText="신고하는 중…"
          >
            신고하기
          </Button>
        </div>
      )}

      {step === 'block' && (
        <div>
          <p className="text-sm text-ink">
            {comment.author_name ? `${comment.author_name} 님을` : '이 사용자를'} 차단할까요?
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            차단하면 이 사용자의 댓글이 보이지 않아요. 내정보 › 차단한 사용자에서 해제할 수 있어요.
          </p>
          {errorLine}
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="danger" full onClick={submitBlock} loading={submitting} loadingText="차단하는 중…">
              차단하기
            </Button>
            <Button variant="secondary" full onClick={onClose} disabled={submitting}>
              취소
            </Button>
          </div>
        </div>
      )}

      {step === 'delete' && (
        <div>
          <p className="text-sm text-ink">댓글을 삭제할까요? 삭제하면 되돌릴 수 없어요.</p>
          {errorLine}
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="danger" full onClick={submitDelete} loading={submitting} loadingText="삭제하는 중…">
              삭제하기
            </Button>
            <Button variant="secondary" full onClick={onClose} disabled={submitting}>
              취소
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

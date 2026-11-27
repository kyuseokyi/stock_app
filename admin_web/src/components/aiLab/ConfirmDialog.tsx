import { useEffect, type ReactNode } from 'react'

// 확인 다이얼로그 — 비용이 드는 행동(Gemini 다시 분석·일괄 분석) 앞에서 브라우저 confirm 대신 쓴다.
// 관리자 웹에 공용 확인 다이얼로그 부품이 없어 급등락 화면의 전체 화면 시트와 같은 토큰·aria 로 만들었다. Esc = 취소.
export default function ConfirmDialog({ open, title, children, confirmLabel = '실행', cancelLabel = '취소', onConfirm, onCancel }: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="ai-lab-confirm-title"
        className="flex w-full max-w-md flex-col gap-3 rounded-card bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <h2 id="ai-lab-confirm-title" className="text-base font-bold text-ink">{title}</h2>
        <div className="text-sm text-ink">{children}</div>
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={onCancel} autoFocus
            className="h-11 min-w-[44px] rounded-btn bg-fill px-4 text-sm font-medium text-ink">{cancelLabel}</button>
          <button type="button" onClick={onConfirm}
            className="h-11 min-w-[44px] rounded-btn bg-ink px-4 text-sm font-medium text-surface">{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

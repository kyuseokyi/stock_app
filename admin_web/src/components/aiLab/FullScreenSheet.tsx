import type { ReactNode } from 'react'

// 좁은 화면(모바일·태블릿) 전체 화면 상세 — 급등락 화면(MarketDailySurge)의 시트와 같은 마크업.
export default function FullScreenSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-canvas">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
        <strong className="min-w-0 truncate text-sm text-ink">{title}</strong>
        <button type="button" onClick={onClose} autoFocus
          className="h-11 min-w-[44px] shrink-0 rounded-btn bg-fill px-4 text-sm font-medium text-ink">닫기</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  )
}

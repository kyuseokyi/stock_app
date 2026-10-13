import { useEffect } from 'react'
import { useTradingGameStore, type GameToast } from '../../store/tradingGame'

const TTL_MS = 5_000

// 게임 넛지/오류 토스트 — 상단 중앙(커뮤니티 알림 토스트는 우하단이라 겹치지 않음). 각 5초 후 자동 닫힘.
function ToastItem({ toast }: { toast: GameToast }) {
  const dismiss = useTradingGameStore((s) => s.dismissToast)
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), TTL_MS)
    return () => clearTimeout(t)
  }, [toast.id, dismiss])

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-card border bg-surface px-4 py-3 shadow-lg ${
        toast.kind === 'error' ? 'border-up/40' : 'border-line'
      }`}
    >
      <span className="mt-0.5 text-lg">{toast.icon}</span>
      <p className="flex-1 text-sm text-ink">{toast.message}</p>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="shrink-0 text-ink-muted hover:text-ink"
        aria-label="닫기"
      >
        ✕
      </button>
    </div>
  )
}

export default function NudgeToaster() {
  const toasts = useTradingGameStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed left-1/2 top-24 z-40 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

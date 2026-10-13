import { useEffect } from 'react'
import { useToastStore, type AppToast } from '../store/toast'

const TTL_MS = 3000

function ToastItem({ toast }: { toast: AppToast }) {
  const dismiss = useToastStore((s) => s.dismiss)
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), TTL_MS)
    return () => clearTimeout(t)
  }, [toast.id, dismiss])
  return (
    <div
      role="status"
      onClick={() => dismiss(toast.id)}
      className="pointer-events-auto cursor-pointer rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white shadow-lg"
    >
      {toast.text}
    </div>
  )
}

// 하단 중앙 토스트 — 3초 후 자동 닫힘, 클릭하여 닫기
export default function AppToaster() {
  const toasts = useToastStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

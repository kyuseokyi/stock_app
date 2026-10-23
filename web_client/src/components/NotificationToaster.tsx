import { useEffect, useState } from 'react'
import { API_BASE_URL } from '../config'
import { fundRefresher } from '../lib/fundAutoRefresh'
import { loadFunds } from '../lib/fundStore'
import { useAuthStore } from '../store/auth'
import type { NotificationEvent } from '../types/api'

const STREAM_URL = API_BASE_URL + '/notifications/stream'
// 모든 접속자가 같은 순간 리포트를 받으러 가지 않게 0~30초 흩뿌린다
const FUND_JITTER_MS = 30_000

interface Toast {
  id: string
  text: string
}

// SSE(EventSource) 실시간 알림 → 우측 하단 토스트
export default function NotificationToaster() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const es = new EventSource(STREAM_URL)
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const pushToast = (text: string) => {
      const id = `${Date.now()}-${Math.random()}`
      setToasts((prev) => [...prev, { id, text }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
    }
    const onNotification = (e: MessageEvent<string>) => {
      let payload: Partial<NotificationEvent> = {}
      try {
        payload = JSON.parse(e.data) as Partial<NotificationEvent>
      } catch {
        return
      }
      if (payload.type === 'fund_report_updated') {
        // 갱신 신호 — 로그인 + 이 브라우저에 펀드가 있을 때만, "새 알림" 토스트는 띄우지 않는다
        const eligible = () => useAuthStore.getState().user !== null && loadFunds().length > 0
        // 대기 중인 갱신이 이미 있으면 새 이벤트는 무시 — 토스트가 쌓이지 않게
        if (timers.size > 0 || !eligible()) return
        const t = setTimeout(() => {
          timers.delete(t)
          // 지연 중 로그아웃했거나 펀드를 모두 지웠다면 아무것도 하지 않는다
          if (!eligible()) return
          void fundRefresher.run({ force: true })
          pushToast('오늘 수익률 리포트가 올라왔어요')
        }, Math.random() * FUND_JITTER_MS)
        timers.add(t)
        return
      }
      pushToast(payload.type === 'new_post' ? `새 글: ${payload.title}` : '새 알림이 왔어요.')
    }
    es.addEventListener('notification', onNotification)
    return () => {
      es.removeEventListener('notification', onNotification)
      es.close()
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-50 sm:bottom-4 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-lg"
        >
          <span className="mt-0.5 text-lg">🔔</span>
          <p className="flex-1 text-sm text-ink">{t.text}</p>
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="shrink-0 text-ink-muted hover:text-ink"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

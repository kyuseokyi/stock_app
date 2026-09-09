import { useEffect, useState } from 'react'
import { API_BASE_URL } from '../config'

const STREAM_URL = API_BASE_URL + '/notifications/stream'

// SSE(EventSource) 실시간 알림 → 우측 하단 토스트
export default function NotificationToaster() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    const es = new EventSource(STREAM_URL)
    const onNotification = (e) => {
      let payload = {}
      try {
        payload = JSON.parse(e.data)
      } catch {
        return
      }
      const id = `${Date.now()}-${Math.random()}`
      const text =
        payload.type === 'new_post'
          ? `새 글: ${payload.title}`
          : '새 알림이 도착했습니다.'
      setToasts((prev) => [...prev, { id, text }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
    }
    es.addEventListener('notification', onNotification)
    return () => {
      es.removeEventListener('notification', onNotification)
      es.close()
    }
  }, [])

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg"
        >
          <span className="mt-0.5 text-lg">🔔</span>
          <p className="flex-1 text-sm text-slate-700">{t.text}</p>
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="shrink-0 text-slate-400 hover:text-slate-600"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

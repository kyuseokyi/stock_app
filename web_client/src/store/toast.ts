import { create } from 'zustand'

// 앱 전역 토스트(게임 외 — 게임은 NudgeToaster, SSE 알림은 NotificationToaster). Layout 의 <AppToaster/> 가 그린다.

export interface AppToast {
  id: number
  text: string
}

interface ToastState {
  toasts: AppToast[]
  show: (text: string) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (text) => set((s) => ({ toasts: [...s.toasts, { id: ++seq, text }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const showToast = (text: string): void => useToastStore.getState().show(text)

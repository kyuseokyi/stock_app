import type { ReactNode } from 'react'

// 목록 배지 — 색은 뜻으로만 고른다(DESIGN.md Pink-Is-a-Point).
// neutral = 분류(패턴 종류·골든크로스·정배열 등) / outline = 상태·단계 / up = 상승 사건(신고가) / danger = 주의(RSI 과열)
export type TagTone = 'neutral' | 'outline' | 'up' | 'danger'

const TONE: Record<TagTone, string> = {
  neutral: 'bg-fill text-ink',
  outline: 'bg-surface text-ink-muted ring-1 ring-inset ring-line',
  up: 'bg-up-soft text-up',
  danger: 'bg-danger-soft text-danger',
}

export default function Tag({ tone = 'neutral', children }: { tone?: TagTone; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>
}

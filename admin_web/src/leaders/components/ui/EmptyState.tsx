// web_client/src/components/ui/EmptyState.tsx 복사본 — 원본과 같이 고칠 것
import type { ReactNode } from 'react'

interface EmptyStateProps {
  emoji?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

// 큰 이모지 + 제목 + 안내문(+선택 액션). 게임 스켈레톤·빈 목록 공용.
export default function EmptyState({ emoji = '📭', title, description, action = null }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div aria-hidden className="text-5xl">{emoji}</div>
      <h2 className="mt-4 text-lg font-bold text-ink">{title}</h2>
      {description && <p className="mt-1.5 text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

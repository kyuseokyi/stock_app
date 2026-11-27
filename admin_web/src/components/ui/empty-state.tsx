import * as React from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  action?: React.ReactNode
}

// 목록이 비었을 때 안내(제목·설명·아이콘·행동 버튼)
export function EmptyState({ title, description, icon, action, className, ...p }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-10 text-center', className)} {...p}>
      {icon && <div className="text-ink-muted [&_svg]:size-8">{icon}</div>}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && <p className="text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

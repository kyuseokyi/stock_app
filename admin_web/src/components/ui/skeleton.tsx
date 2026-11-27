import * as React from 'react'
import { cn } from '@/lib/utils'

// 불러오는 동안의 자리 표시 — 스크린리더에는 숨긴다
export function Skeleton({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-field bg-fill', className)} {...p} />
}

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { selected?: boolean }

// 필터·정렬 선택 칩 — 선택 상태를 aria-pressed 로 알린다
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(({ className, selected = false, type, ...p }, ref) => (
  <button
    ref={ref}
    type={type ?? 'button'}
    aria-pressed={selected}
    className={cn(
      'inline-flex h-8 items-center rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50',
      selected ? 'bg-brand-soft text-brand-strong' : 'bg-fill text-ink hover:bg-fill/80',
      className,
    )}
    {...p}
  />
))
Chip.displayName = 'Chip'

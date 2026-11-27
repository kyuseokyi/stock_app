import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// 작은 상태 배지 — 숫자(등락률 등)가 들어가므로 tabular-nums
export const badgeVariants = cva('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', {
  variants: {
    variant: {
      default: 'bg-fill text-ink',
      brand: 'bg-brand-soft text-brand-strong',
      up: 'bg-up-soft text-up',
      down: 'bg-down-soft text-down',
      danger: 'bg-danger-soft text-danger',
      outline: 'border border-line text-ink-muted',
    },
  },
  defaultVariants: { variant: 'default' },
})

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

import * as React from 'react'
import { cn } from '@/lib/utils'

// 흰 카드(라벤더 바탕 위) — rounded-card
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...p }, ref) => (
  <div ref={ref} className={cn('rounded-card bg-surface text-ink', className)} {...p} />
))
Card.displayName = 'Card'
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-1 p-4 pb-2', className)} {...p} />
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn('text-base font-bold text-ink', className)} {...p} />
export const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => <p className={cn('text-sm text-ink-muted', className)} {...p} />
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('p-4 pt-2', className)} {...p} />
export const CardFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex items-center gap-2 p-4 pt-0', className)} {...p} />

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

// 탭 — 화살표 키 이동은 Radix 가 처리
export const Tabs = TabsPrimitive.Root
export const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...p }, ref) => <TabsPrimitive.List ref={ref} className={cn('inline-flex items-center gap-1 rounded-btn bg-fill p-1', className)} {...p} />,
)
TabsList.displayName = 'TabsList'
export const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...p }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn('inline-flex h-8 items-center rounded-field px-3 text-sm font-medium text-ink-muted transition-colors focus-visible:outline-2 focus-visible:outline-ring data-[state=active]:bg-surface data-[state=active]:text-ink', className)}
      {...p}
    />
  ),
)
TabsTrigger.displayName = 'TabsTrigger'
export const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  ({ className, ...p }, ref) => <TabsPrimitive.Content ref={ref} className={cn('mt-3 focus-visible:outline-2 focus-visible:outline-ring', className)} {...p} />,
)
TabsContent.displayName = 'TabsContent'

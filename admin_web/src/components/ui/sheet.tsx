import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// 가장자리에서 열리는 패널(좁은 화면 필터·전체 화면 상세) — Radix Dialog 기반
export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close
export const SheetDescription = SheetPrimitive.Description

const sheetVariants = cva('fixed z-50 flex flex-col gap-3 bg-surface p-5 text-ink shadow-lg', {
  variants: {
    side: {
      top: 'inset-x-0 top-0 rounded-b-card',
      bottom: 'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-card',
      left: 'inset-y-0 left-0 h-full w-3/4 max-w-sm',
      right: 'inset-y-0 right-0 h-full w-3/4 max-w-sm',
      full: 'inset-0',
    },
  },
  defaultVariants: { side: 'right' },
})

export interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>, VariantProps<typeof sheetVariants> {}

export const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side, className, children, ...p }, ref) => (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), 'overflow-y-auto', className)} {...p}>
        {children}
        <SheetPrimitive.Close className="absolute right-3 top-3 rounded-field p-1 text-ink-muted hover:bg-fill focus-visible:outline-2 focus-visible:outline-ring" aria-label="닫기">
          <X className="size-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  ),
)
SheetContent.displayName = 'SheetContent'
export const SheetTitle = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Title>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>>(
  ({ className, ...p }, ref) => <SheetPrimitive.Title ref={ref} className={cn('pr-6 text-base font-bold text-ink', className)} {...p} />,
)
SheetTitle.displayName = 'SheetTitle'

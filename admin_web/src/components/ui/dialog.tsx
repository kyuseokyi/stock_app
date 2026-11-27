import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// 가운데 모달 — 닫기 버튼은 한국어 라벨("닫기")
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogPortal = DialogPrimitive.Portal

export const DialogOverlay = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  ({ className, ...p }, ref) => <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-black/40', className)} {...p} />,
)
DialogOverlay.displayName = 'DialogOverlay'

export const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>(
  ({ className, children, ...p }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn('fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-3 rounded-card bg-surface p-5 text-ink shadow-lg', className)}
        {...p}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-field p-1 text-ink-muted hover:bg-fill focus-visible:outline-2 focus-visible:outline-ring" aria-label="닫기">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
)
DialogContent.displayName = 'DialogContent'

export const DialogHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-1 pr-6', className)} {...p} />
export const DialogFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...p} />
export const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...p }, ref) => <DialogPrimitive.Title ref={ref} className={cn('text-base font-bold text-ink', className)} {...p} />,
)
DialogTitle.displayName = 'DialogTitle'
export const DialogDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  ({ className, ...p }, ref) => <DialogPrimitive.Description ref={ref} className={cn('text-sm text-ink-muted', className)} {...p} />,
)
DialogDescription.displayName = 'DialogDescription'

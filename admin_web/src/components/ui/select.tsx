import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// 드롭다운 선택 — 트리거는 fill 바탕(흰 카드 위에서 보이도록)
export const Select = SelectPrimitive.Root
export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value

export const SelectTrigger = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>>(
  ({ className, children, ...p }, ref) => (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn('inline-flex h-10 w-full items-center justify-between gap-2 rounded-field bg-fill px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 data-[placeholder]:text-ink-muted', className)}
      {...p}
    >
      {children}
      <SelectPrimitive.Icon asChild><ChevronDown className="size-4 text-ink-muted" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  ),
)
SelectTrigger.displayName = 'SelectTrigger'

export const SelectContent = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Content>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(
  ({ className, children, position = 'popper', ...p }, ref) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        className={cn('z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-field bg-popover text-popover-foreground shadow-lg', position === 'popper' && 'w-[var(--radix-select-trigger-width)] translate-y-1', className)}
        {...p}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  ),
)
SelectContent.displayName = 'SelectContent'

export const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(
  ({ className, children, ...p }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      className={cn('relative flex w-full cursor-pointer select-none items-center rounded-field py-2 pl-8 pr-2 text-sm text-ink outline-hidden data-[highlighted]:bg-fill data-[disabled]:opacity-50', className)}
      {...p}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center"><SelectPrimitive.ItemIndicator><Check className="size-4" /></SelectPrimitive.ItemIndicator></span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  ),
)
SelectItem.displayName = 'SelectItem'

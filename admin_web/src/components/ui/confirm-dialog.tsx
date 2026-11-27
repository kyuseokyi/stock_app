import { useRef, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'
import { DialogOverlay, DialogPortal } from './dialog'

/**
 * 확인 대화상자(alertdialog) — 되돌리기 어려운 행동 앞에서 브라우저 confirm 대신 쓴다.
 * Radix Dialog 라 포커스 가두기·Esc·바깥 클릭(=취소)·스크롤 잠금이 기본. 닫기(X) 버튼은 두지 않는다(선택지는 취소·실행 둘뿐).
 * 처음 포커스는 [취소] — 실수로 Enter 를 눌러도 실행되지 않게.
 * 명령형으로 쓸 때는 lib/confirm 의 confirmAction() 을 쓴다.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = '확인',
  cancelLabel = '취소',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogPortal>
        <DialogOverlay className="z-60 bg-ink/40" />
        <DialogPrimitive.Content
          role="alertdialog"
          // 설명이 없으면 Radix 의 '설명 없음' 경고를 끈다
          {...(children ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            cancelRef.current?.focus()
          }}
          className="fixed left-1/2 top-1/2 z-60 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-card bg-surface p-5 text-ink shadow-xl"
        >
          <DialogPrimitive.Title className="text-base font-bold text-ink">{title}</DialogPrimitive.Title>
          {children ? (
            <DialogPrimitive.Description asChild>
              <div className="whitespace-pre-line text-sm text-ink">{children}</div>
            </DialogPrimitive.Description>
          ) : null}
          <div className="mt-1 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              className="h-11 min-w-[44px] rounded-btn bg-fill px-4 text-sm font-medium text-ink"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={cn(
                'h-11 min-w-[44px] rounded-btn px-4 text-sm font-medium',
                danger ? 'bg-danger text-white' : 'bg-ink text-surface',
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  )
}

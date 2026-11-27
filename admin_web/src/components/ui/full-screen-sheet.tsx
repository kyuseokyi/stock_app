import type { ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

/**
 * 좁은 화면(모바일·태블릿) 전체 화면 상세 — 급등락·AI Lab 이 함께 쓴다.
 * 모양은 예전 직접 만든 시트 그대로(위 막대 + 닫기, 아래 스크롤 본문), 동작만 Radix Dialog 로:
 * Esc 로 닫기·포커스 가두기·뒤 화면 스크롤 잠금. 처음 포커스는 [닫기].
 * 열 때 마운트·닫을 때 언마운트하는 호출부 방식 그대로 쓴다(open 은 항상 true).
 */
export function FullScreenSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogPrimitive.Portal>
        {/* Radix 는 뒤 화면 스크롤 잠금을 Overlay 에 건다 — 화면을 다 덮는 시트라도 Overlay 가 있어야 잠긴다 */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-canvas" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-canvas"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
            <DialogPrimitive.Title asChild>
              <strong className="min-w-0 truncate text-sm text-ink">{title}</strong>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button type="button" className="h-11 min-w-[44px] shrink-0 rounded-btn bg-fill px-4 text-sm font-medium text-ink">
                닫기
              </button>
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

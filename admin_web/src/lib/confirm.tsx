import { useSyncExternalStore } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export type ConfirmOptions = {
  /** 실행 버튼 문구(기본 '확인') */
  confirmLabel?: string
  /** 되돌릴 수 없는 행동(삭제·정지 등) — 실행 버튼을 위험 색으로 */
  danger?: boolean
}

type Pending = { id: number; title: string; body: string; opts: ConfirmOptions; resolve: (ok: boolean) => void }

// 앱 전체에 하나 — 여러 번 부르면 차례대로 하나씩 띄운다(브라우저 confirm 처럼 겹치지 않게)
let queue: Pending[] = []
let nextId = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const current = () => queue[0] ?? null

/**
 * 브라우저 confirm() 대체 — `if (!(await confirmAction('삭제할까요?'))) return`.
 * 메시지 첫 줄은 제목, 나머지 줄은 설명으로 보인다. [확인]=true, [취소]·Esc·바깥 클릭=false.
 * 화면에 <ConfirmHost /> 가 한 번 있어야 한다(main.tsx).
 */
export function confirmAction(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const [title, ...rest] = message.split('\n')
  const body = rest.join('\n').trim()
  return new Promise<boolean>((resolve) => {
    queue = [...queue, { id: ++nextId, title, body, opts, resolve }]
    emit()
  })
}

function settle(ok: boolean) {
  const head = queue[0]
  if (!head) return
  queue = queue.slice(1)
  emit()
  head.resolve(ok)
}

/** confirmAction 이 띄우는 대화상자 자리 — 앱 루트에 한 번 둔다 */
export function ConfirmHost() {
  const p = useSyncExternalStore(subscribe, current, current)
  return (
    <ConfirmDialog
      // 다음 확인창으로 넘어갈 때 새로 마운트해 처음 포커스([취소])를 다시 잡는다
      key={p ? p.id : 'none'}
      open={p !== null}
      title={p?.title ?? ''}
      confirmLabel={p?.opts.confirmLabel}
      danger={p?.opts.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    >
      {p?.body || null}
    </ConfirmDialog>
  )
}

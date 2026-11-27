import type { ReactNode } from 'react'
import { ConfirmDialog as BaseConfirmDialog } from '@/components/ui/confirm-dialog'

// 확인 다이얼로그 — 비용이 드는 행동(Gemini 다시 분석·일괄 분석) 앞에서 쓴다.
// 공용 부품(components/ui/confirm-dialog, Radix)을 그대로 쓰고 실행 버튼 기본 문구만 '실행'으로 둔다.
export default function ConfirmDialog({ confirmLabel = '실행', ...p }: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return <BaseConfirmDialog confirmLabel={confirmLabel} {...p} />
}

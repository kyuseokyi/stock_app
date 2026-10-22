import { useState } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { discardLegacyFunds, importLegacyFunds, type LegacyPreview } from '../../lib/fundStore'
import { showToast } from '../../store/toast'

interface Props {
  uid: number
  preview: LegacyPreview
  /** 닫기(✕·바깥·ESC) — 아무것도 바꾸지 않는다. 다음 방문 때 다시 묻는다 */
  onClose: () => void
  /** 가져오기·버리기를 마침 — 호출부가 목록·안내를 다시 읽는다 */
  onDone: () => void
}

/** 계정별 저장 전 이 브라우저에 쌓인 펀드(옛 키)를 지금 계정으로 가져올지 묻는 창(펀드 목록 화면) */
export default function LegacyImportModal({ uid, preview, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false)
  const { count, added, skipped } = preview

  const run = (fn: () => void) => {
    if (busy) return
    setBusy(true)
    try {
      fn()
      onDone()
    } catch {
      showToast('처리하지 못했어요. 다시 시도해 주세요.')
      setBusy(false)
    }
  }

  const handleImport = () =>
    run(() => {
      const r = importLegacyFunds(uid)
      showToast(
        r.skipped > 0
          ? `펀드 ${r.added}개를 가져왔어요. ${r.skipped}개는 등록 한도로 이 브라우저에 남겨 뒀어요.`
          : `펀드 ${r.added}개를 가져왔어요.`,
      )
    })

  const handleDiscard = () => {
    if (!window.confirm(`이 브라우저에 저장된 펀드 ${count}개를 지울까요? 되돌릴 수 없어요.`)) return
    run(() => {
      discardLegacyFunds(uid)
      showToast('이 브라우저에 저장된 펀드를 지웠어요.')
    })
  }

  return (
    <Modal title="저장된 펀드를 가져올까요?" onClose={busy ? () => {} : onClose}>
      <p className="text-sm leading-6 text-ink-muted">
        이 브라우저에 저장된 펀드 {count}개를 이 계정으로 가져올까요? 가져오면 이 계정으로 로그인했을 때만 보여요.
      </p>
      {skipped > 0 && (
        <p className="mt-3 rounded-field bg-brand-soft px-4 py-3 text-sm text-ink">
          펀드는 계정마다 최대 등록 개수가 있어 {added}개만 가져올 수 있어요. 나머지 {skipped}개는 이 브라우저에
          남아요.
        </p>
      )}
      <div className="mt-5 flex flex-col gap-2">
        <Button full onClick={handleImport} disabled={busy}>
          {skipped > 0 ? `${added}개 가져오기` : '가져오기'}
        </Button>
        <Button full variant="secondary" onClick={handleDiscard} disabled={busy}>
          버리기
        </Button>
      </div>
    </Modal>
  )
}

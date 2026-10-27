import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { closeActionClass, closeActionOf } from '../../lib/closeAction'
import { formatPct, formatSignedKrw, pnlClass } from '../../lib/format'
import { srEventCopy, type SrEvent } from '../../lib/srWatch'
import type { Position } from '../../types/game'

interface SrActionModalProps {
  event: SrEvent
  /** 넓은 화면 이름(20선·BB상단·매물대) */
  name: string
  position: Position
  closing: boolean
  onClosePosition: () => void
  onHold: () => void
  onDismiss: () => void
}

// 지지·저항 대응 모달 — [💰 익절하기 / 🛡️ 손절하기] vs [✊ 홀딩](설계 2026-10-27 §7).
// 이벤트 데이터만 받는다(나중에 푸시를 눌러 들어올 때도 같은 모달).
export default function SrActionModal({ event, name, position, closing, onClosePosition, onHold, onDismiss }: SrActionModalProps) {
  const copy = srEventCopy(event.type, name, event.levelPrice)
  const action = closeActionOf(position.pnl_amount)
  return (
    <Modal title={copy.title} description={copy.body} onClose={onDismiss} narrow>
      <p className="text-sm text-ink-muted">
        현재 평가손익{' '}
        <span className={`font-bold tabular-nums ${pnlClass(position.pnl_amount)}`}>
          {position.pnl_amount !== null ? formatSignedKrw(position.pnl_amount) : '—'}
          {position.roi_pct !== null && ` (${formatPct(position.roi_pct)})`}
        </span>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClosePosition} loading={closing} loadingText="청산 중…">
          <span className={closeActionClass(action.kind)}>{action.label}</span>
        </Button>
        <Button variant="secondary" onClick={onHold}>✊ 홀딩</Button>
      </div>
    </Modal>
  )
}

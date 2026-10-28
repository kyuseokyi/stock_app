import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { closeActionClass, closeActionOf } from '../../lib/closeAction'
import { formatPct, formatSignedKrw, formatWon, pnlClass } from '../../lib/format'
import { partialClosePreview, type ClosePortion } from '../../lib/partialClose'
import { srEventCopy, type SrEvent } from '../../lib/srWatch'
import type { Position } from '../../types/game'

interface SrActionModalProps {
  event: SrEvent
  /** 넓은 화면 이름(20선·BB상단·매물대) */
  name: string
  position: Position
  closing: boolean
  onClosePosition: () => void
  /** 부분 익절·원금 회수 버튼 노출(canPartialClose — 서버 partial_close + 수익 상태) */
  partialClose?: boolean
  onPartialClose?: (portion: Exclude<ClosePortion, 'all'>) => void
  onHold: () => void
  onDismiss: () => void
}

// 지지·저항 대응 모달 — [💰 익절하기 / 🛡️ 손절하기] vs [✊ 홀딩](설계 2026-10-27 §7).
// 이벤트 데이터만 받는다(나중에 푸시를 눌러 들어올 때도 같은 모달). 수익 중이고 서버가 지원하면 [½ 절반 익절] [원금 회수]도(설계 2026-10-28 §3).
export default function SrActionModal({
  event,
  name,
  position,
  closing,
  onClosePosition,
  partialClose = false,
  onPartialClose,
  onHold,
  onDismiss,
}: SrActionModalProps) {
  const copy = srEventCopy(event.type, name, event.levelPrice)
  const action = closeActionOf(position.pnl_amount)
  const preview =
    partialClose && onPartialClose && position.pnl_amount !== null
      ? partialClosePreview(position.size_amount, position.pnl_amount)
      : null
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
      {preview && onPartialClose && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => onPartialClose('half')} disabled={closing}>
              ½ 절반 익절
            </Button>
            {preview.principal && (
              <Button variant="secondary" onClick={() => onPartialClose('principal')} disabled={closing}>
                원금 회수
              </Button>
            )}
          </div>
          {preview.principal && (
            <p className="mt-1.5 text-xs tabular-nums text-ink-muted">
              원금 회수: 원금 {formatWon(preview.principal.returned)} 회수 · 수익 {formatWon(preview.principal.remainValue)}은 계속 보유
            </p>
          )}
        </>
      )}
    </Modal>
  )
}

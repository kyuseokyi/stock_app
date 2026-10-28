import { useState } from 'react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { closeActionClass, closeActionOf } from '../../lib/closeAction'
import { formatPct, formatPrice, formatSignedKrw, formatWon, pnlClass } from '../../lib/format'
import { slTpLine } from '../../lib/orderOptions'
import { partialClosePreview, type ClosePortion } from '../../lib/partialClose'
import { sideClass, sideLabel } from '../../lib/side'
import type { Position } from '../../types/game'

interface ActivePositionCardProps {
  position: Position
  lastPrice: number | null
  closing: boolean
  onClose: () => void
  /** 부분 익절·원금 회수 버튼 노출(canPartialClose — 서버 partial_close + 수익 상태) */
  partialClose?: boolean
  onPartialClose?: (portion: Exclude<ClosePortion, 'all'>) => void
}

// 보유 포지션 — 평가손익(₩, %)은 WS position_pnl 로 틱마다 갱신. 손익에 따라 익절/손절 원클릭 전액 청산, 수익 중이면 절반 익절·원금 회수.
export default function ActivePositionCard({
  position,
  lastPrice,
  closing,
  onClose,
  partialClose = false,
  onPartialClose,
}: ActivePositionCardProps) {
  // 누른 버튼에만 '청산 중…' — 청산 중에는 세 버튼 모두 비활성
  const [pressed, setPressed] = useState<ClosePortion>('all')
  const press = (portion: ClosePortion, run: () => void) => {
    setPressed(portion)
    run()
  }
  const preview =
    partialClose && onPartialClose && position.pnl_amount !== null
      ? partialClosePreview(position.size_amount, position.pnl_amount)
      : null
  const slTp = slTpLine(position.stop_loss_price, position.take_profit_price)
  // 손익에 따라 익절/손절 — 색은 손익 글자와 같은 상승·하락 색(사유는 서버가 체결 가격으로 정함)
  const action = closeActionOf(position.pnl_amount)
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-ink">
          <span className={sideClass(position.side)}>{sideLabel(position.side)}</span> {position.leverage}배
        </p>
        <p className={`text-right font-bold tabular-nums transition-colors ${pnlClass(position.pnl_amount)}`}>
          {position.pnl_amount !== null ? formatSignedKrw(position.pnl_amount) : '—'}
          <span className="ml-1 text-sm">({position.roi_pct !== null ? formatPct(position.roi_pct) : '—'})</span>
        </p>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        진입가 {formatPrice(position.entry_price)}원
        {lastPrice !== null && ` (현재가 ${formatPrice(lastPrice)}원)`}
      </p>
      {slTp && <p className="mt-0.5 text-sm tabular-nums text-ink-muted">{slTp}</p>}
      <Button
        type="button"
        variant="secondary"
        full
        className="mt-3"
        onClick={() => press('all', onClose)}
        disabled={closing}
        loading={closing && pressed === 'all'}
        loadingText="청산 중…"
      >
        <span className={closeActionClass(action.kind)}>{action.label}</span>
      </Button>
      {preview && onPartialClose && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => press('half', () => onPartialClose('half'))}
              disabled={closing}
              loading={closing && pressed === 'half'}
              loadingText="청산 중…"
            >
              ½ 절반 익절
            </Button>
            {preview.principal && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => press('principal', () => onPartialClose('principal'))}
                disabled={closing}
                loading={closing && pressed === 'principal'}
                loadingText="청산 중…"
              >
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
    </Card>
  )
}

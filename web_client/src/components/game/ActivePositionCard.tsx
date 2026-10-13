import Button from '../ui/Button'
import Card from '../ui/Card'
import { formatPct, formatPrice, formatSignedKrw, pnlClass } from '../../lib/format'
import { slTpLine } from '../../lib/orderOptions'
import type { Position } from '../../types/game'

interface ActivePositionCardProps {
  position: Position
  lastPrice: number | null
  closing: boolean
  onClose: () => void
}

// 보유 포지션 — 평가손익(₩, %)은 WS position_pnl 로 틱마다 갱신. 원클릭 전액 청산.
export default function ActivePositionCard({ position, lastPrice, closing, onClose }: ActivePositionCardProps) {
  const long = position.side === 'LONG'
  const slTp = slTpLine(position.stop_loss_price, position.take_profit_price)
  return (
    <Card className="bg-sky-soft">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-ink">
          <span className={long ? 'text-up' : 'text-down'}>{position.side}</span> x{position.leverage}배
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
        onClick={onClose}
        disabled={closing}
        loading={closing}
        loadingText="청산 중…"
      >
        즉시 전액 청산하기
      </Button>
    </Card>
  )
}

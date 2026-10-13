import { useState } from 'react'
import Card from '../ui/Card'
import { chipClass } from '../ui/Chip'
import type { Leverage, Ratio, Side } from '../../types/game'

const RATIOS: { value: Ratio; label: string }[] = [
  { value: 0.25, label: '25%' },
  { value: 0.5, label: '50%' },
  { value: 1.0, label: '100%' },
]
const LEVERAGES: Leverage[] = [1, 2, 5]

interface OrderPanelProps {
  hasPosition: boolean
  academyUnlocked: boolean
  submitting: boolean
  onOrder: (side: Side, ratio: Ratio, leverage: Leverage) => void
  onLockedLeverage: () => void
}

// 원클릭 주문 — 비중·배율 칩 + BUY(상승=빨강)/SELL(하락=파랑). 5x 는 아카데미 미해금 시 잠금.
export default function OrderPanel({ hasPosition, academyUnlocked, submitting, onOrder, onLockedLeverage }: OrderPanelProps) {
  const [ratio, setRatio] = useState<Ratio>(0.25)
  const [leverage, setLeverage] = useState<Leverage>(1)
  const disabled = hasPosition || submitting

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">비중</span>
          {RATIOS.map((r) => (
            <button
              key={r.label}
              type="button"
              aria-pressed={ratio === r.value}
              onClick={() => setRatio(r.value)}
              className={chipClass(ratio === r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">배율</span>
          {LEVERAGES.map((l) => {
            const locked = l === 5 && !academyUnlocked
            return (
              <button
                key={l}
                type="button"
                aria-pressed={leverage === l}
                onClick={() => (locked ? onLockedLeverage() : setLeverage(l))}
                className={chipClass(leverage === l)}
              >
                {l}x{locked && ' 🔒'}
              </button>
            )
          })}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOrder('LONG', ratio, leverage)}
          className="h-14 rounded-btn bg-up text-base font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          🔴 BUY <span className="text-sm font-medium">(상승 베팅)</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOrder('SHORT', ratio, leverage)}
          className="h-14 rounded-btn bg-down text-base font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          🔵 SELL <span className="text-sm font-medium">(하락 베팅)</span>
        </button>
      </div>
      {hasPosition && <p className="mt-2 text-center text-xs text-ink-muted">보유 포지션을 먼저 청산하세요</p>}
    </Card>
  )
}

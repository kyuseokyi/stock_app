import { useState } from 'react'
import Card from '../ui/Card'
import { chipClass } from '../ui/Chip'
import {
  RATIO_CHIPS, RATIO_MORE, STOP_LOSS_PCTS, TAKE_PROFIT_PCTS,
  isChipRatio, ratioLabel, slTpHint, stopLossLabel, takeProfitLabel,
} from '../../lib/orderOptions'
import type { Leverage, OrderOptions, Ratio, Side } from '../../types/game'

const LEVERAGES: Leverage[] = [1, 2, 5]

interface OrderPanelProps {
  hasPosition: boolean
  academyUnlocked: boolean
  submitting: boolean
  onOrder: (side: Side, ratio: Ratio, leverage: Leverage, opts: OrderOptions) => void
  onLockedLeverage: () => void
}

// 네이티브 select 를 칩과 같은 모양으로(접근성·모바일 웹 호환)
const selectClass = (active: boolean) =>
  `${chipClass(active)} cursor-pointer border-0 outline-none focus-visible:ring-2 focus-visible:ring-brand`

// 원클릭 주문 — 비중(칩 + ▾기타)·배율 칩 + 손절/익절 드롭다운 + BUY(상승=빨강)/SELL(하락=파랑).
// 5x 는 아카데미 미해금 시 잠금. 비중 상태는 하나 — 칩 값이면 드롭다운은 '기타'로 표시(파생).
export default function OrderPanel({ hasPosition, academyUnlocked, submitting, onOrder, onLockedLeverage }: OrderPanelProps) {
  const [ratio, setRatio] = useState<Ratio>(0.25)
  const [leverage, setLeverage] = useState<Leverage>(1)
  const [stopLoss, setStopLoss] = useState<number | null>(null)
  const [takeProfit, setTakeProfit] = useState<number | null>(null)
  const disabled = hasPosition || submitting
  const moreActive = !isChipRatio(ratio)
  const order = (side: Side) => onOrder(side, ratio, leverage, { stopLossPct: stopLoss, takeProfitPct: takeProfit })

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted">비중</span>
          {RATIO_CHIPS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={ratio === r}
              onClick={() => setRatio(r)}
              className={chipClass(ratio === r)}
            >
              {ratioLabel(r)}
            </button>
          ))}
          <select
            aria-label="비중 기타"
            value={moreActive ? String(ratio) : ''}
            onChange={(e) => {
              const next = RATIO_MORE.find((r) => String(r) === e.target.value)
              if (next !== undefined) setRatio(next)
            }}
            className={selectClass(moreActive)}
          >
            <option value="">기타</option>
            {RATIO_MORE.map((r) => (
              <option key={r} value={String(r)}>{ratioLabel(r)}</option>
            ))}
          </select>
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-muted">손절</span>
        <select
          aria-label="손절"
          value={stopLoss === null ? '' : String(stopLoss)}
          onChange={(e) => setStopLoss(STOP_LOSS_PCTS.find((p) => String(p) === e.target.value) ?? null)}
          className={selectClass(stopLoss !== null)}
        >
          <option value="">{stopLossLabel(null)}</option>
          {STOP_LOSS_PCTS.map((p) => (
            <option key={p} value={String(p)}>{stopLossLabel(p)}</option>
          ))}
        </select>
        <span className="ml-2 text-xs text-ink-muted">익절</span>
        <select
          aria-label="익절"
          value={takeProfit === null ? '' : String(takeProfit)}
          onChange={(e) => setTakeProfit(TAKE_PROFIT_PCTS.find((p) => String(p) === e.target.value) ?? null)}
          className={selectClass(takeProfit !== null)}
        >
          <option value="">{takeProfitLabel(null)}</option>
          {TAKE_PROFIT_PCTS.map((p) => (
            <option key={p} value={String(p)}>{takeProfitLabel(p)}</option>
          ))}
        </select>
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">{slTpHint(stopLoss, takeProfit, leverage)}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => order('LONG')}
          className="h-14 rounded-btn bg-up text-base font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          🔴 BUY <span className="text-sm font-medium">(상승 베팅)</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => order('SHORT')}
          className="h-14 rounded-btn bg-down text-base font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          🔵 SELL <span className="text-sm font-medium">(하락 베팅)</span>
        </button>
      </div>
      {hasPosition && <p className="mt-2 text-center text-xs text-ink-muted">보유 포지션을 먼저 청산하세요</p>}
    </Card>
  )
}

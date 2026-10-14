import { useState, type SelectHTMLAttributes } from 'react'
import Card from '../ui/Card'
import { chipClass } from '../ui/Chip'
import {
  RATIO_CHIPS, RATIO_MORE, STOP_LOSS_PCTS, TAKE_PROFIT_PCTS,
  isChipRatio, ratioLabel, slTpHint, stopLossLabel, takeProfitLabel,
} from '../../lib/orderOptions'
import { feeText } from '../../lib/gameRules'
import { sideLabel } from '../../lib/side'
import type { Leverage, OrderOptions, Ratio, Side } from '../../types/game'

const LEVERAGES: Leverage[] = [1, 2, 5]

interface OrderPanelProps {
  hasPosition: boolean
  academyUnlocked: boolean
  submitting: boolean
  onOrder: (side: Side, ratio: Ratio, leverage: Leverage, opts: OrderOptions) => void
  onLockedLeverage: () => void
  /** 왕복 수수료 %(/rules). 없으면 숫자 없이 '수수료 포함' */
  feePct?: number | null
  /** 규칙 모달 열기 */
  onOpenRules?: () => void
}

// 네이티브 select 를 칩과 같은 모양으로(접근성·모바일 웹 호환).
// 브라우저 기본 화살표는 칩 오른쪽 끝에 붙어 좌우 여백이 어긋나므로 숨기고, 칩 여백(px-3)에 맞춘 ▾ 를 직접 그린다.
// field-sizing: content — 폭을 가장 긴 옵션이 아니라 선택된 값에 맞춤(미지원 브라우저는 기존 폭).
const selectClass = (active: boolean) =>
  `${chipClass(active)} cursor-pointer appearance-none border-0 pr-8 outline-none [field-sizing:content] focus-visible:ring-2 focus-visible:ring-brand`

function ChipSelect({ active, children, ...props }: { active: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative inline-flex items-center ${active ? 'text-brand' : 'text-ink-muted'}`}>
      <select {...props} className={selectClass(active)}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="pointer-events-none absolute right-3 h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 4.5 6 7.5 9 4.5" />
      </svg>
    </span>
  )
}

// 원클릭 주문 — 비중(칩 + ▾기타)·배율 칩 + 손절/익절 드롭다운 + 상승에 걸기(핑크)/하락에 걸기(블루).
// 5x 는 아카데미 미해금 시 잠금. 비중 상태는 하나 — 칩 값이면 드롭다운은 '기타'로 표시(파생).
export default function OrderPanel({
  hasPosition, academyUnlocked, submitting, onOrder, onLockedLeverage, feePct = null, onOpenRules,
}: OrderPanelProps) {
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
          <ChipSelect
            aria-label="비중 기타"
            value={moreActive ? String(ratio) : ''}
            onChange={(e) => {
              const next = RATIO_MORE.find((r) => String(r) === e.target.value)
              if (next !== undefined) setRatio(next)
            }}
            active={moreActive}
          >
            <option value="">기타</option>
            {RATIO_MORE.map((r) => (
              <option key={r} value={String(r)}>{ratioLabel(r)}</option>
            ))}
          </ChipSelect>
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
        <ChipSelect
          aria-label="손절"
          value={stopLoss === null ? '' : String(stopLoss)}
          onChange={(e) => setStopLoss(STOP_LOSS_PCTS.find((p) => String(p) === e.target.value) ?? null)}
          active={stopLoss !== null}
        >
          <option value="">{stopLossLabel(null)}</option>
          {STOP_LOSS_PCTS.map((p) => (
            <option key={p} value={String(p)}>{stopLossLabel(p)}</option>
          ))}
        </ChipSelect>
        <span className="ml-2 text-xs text-ink-muted">익절</span>
        <ChipSelect
          aria-label="익절"
          value={takeProfit === null ? '' : String(takeProfit)}
          onChange={(e) => setTakeProfit(TAKE_PROFIT_PCTS.find((p) => String(p) === e.target.value) ?? null)}
          active={takeProfit !== null}
        >
          <option value="">{takeProfitLabel(null)}</option>
          {TAKE_PROFIT_PCTS.map((p) => (
            <option key={p} value={String(p)}>{takeProfitLabel(p)}</option>
          ))}
        </ChipSelect>
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">
        {slTpHint(stopLoss, takeProfit, leverage)}
        <span className="whitespace-nowrap">
          {' · '}
          {feePct !== null ? `수수료 ${feeText(feePct)} 포함` : '수수료 포함'}
          {onOpenRules && (
            <>
              {' · '}
              <button type="button" onClick={onOpenRules} className="font-semibold text-brand underline-offset-2 hover:underline">
                규칙 보기
              </button>
            </>
          )}
        </span>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => order('LONG')}
          className="h-14 rounded-btn bg-up-soft text-base font-bold text-up transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          🔴 {sideLabel('LONG')}에 걸기
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => order('SHORT')}
          className="h-14 rounded-btn bg-down-soft text-base font-bold text-down transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          🔵 {sideLabel('SHORT')}에 걸기
        </button>
      </div>
      {hasPosition && <p className="mt-2 text-center text-xs text-ink-muted">보유 포지션을 먼저 청산하세요</p>}
    </Card>
  )
}

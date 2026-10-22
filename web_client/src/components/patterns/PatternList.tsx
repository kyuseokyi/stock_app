import type { ReactNode } from 'react'
import { formatPrice, pnlClass } from '../../lib/format'
import { breakoutText, depthText, lengthText, patternLabel, pivotDistText, pivotText, stageLabel } from '../../lib/patterns'
import type { PatternItem } from '../../types/patterns'

interface Props {
  items: PatternItem[]
  selected: string | null
  onSelect: (ticker: string) => void
  /** 좁은 화면: 선택한 행 아래에 펼쳐 보일 상세(넓은 화면은 오른쪽 패널이라 없음) */
  renderInline?: (item: PatternItem) => ReactNode
}

// 패턴 목록 — 종목·패턴·단계·피벗·피벗까지 %·깊이·길이·돌파 정보
export default function PatternList({ items, selected, onSelect, renderInline }: Props) {
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => {
        const active = it.ticker === selected
        const bo = breakoutText(it.breakoutDate, it.daysSinceBreakout, it.breakoutVolPct)
        return (
          <li key={it.ticker}>
            <button
              type="button"
              onClick={() => onSelect(it.ticker)}
              aria-expanded={renderInline ? active : undefined}
              aria-pressed={renderInline ? undefined : active}
              aria-current={!renderInline && active ? 'true' : undefined}
              className={`flex w-full items-center gap-3 px-1 py-3 text-left transition ${active ? 'bg-brand-soft/60' : 'hover:bg-fill/60'}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-bold text-ink">{it.name}</span>
                  <span className="shrink-0 text-xs text-ink-muted">{it.ticker}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand">
                    {patternLabel(it.patternType)}
                  </span>
                  <span className="rounded-md bg-fill px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
                    {stageLabel(it.stage, it.label)}
                  </span>
                  <span className="text-xs text-ink-muted">깊이 {depthText(it.depth)} · {lengthText(it.length)}</span>
                </div>
                {bo && <div className="mt-1 text-xs text-up">{bo}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium text-ink">피벗 {pivotText(it.pivot)}</div>
                <div className={`text-xs font-medium ${pnlClass(it.pivotDistPct)}`}>
                  {it.pivotDistPct === null ? '–' : `피벗까지 ${pivotDistText(it.pivotDistPct)}`}
                </div>
                <div className="text-[11px] text-ink-muted">종가 {formatPrice(it.close)}</div>
              </div>
            </button>
            {renderInline && active && <div className="pb-4">{renderInline(it)}</div>}
          </li>
        )
      })}
    </ul>
  )
}

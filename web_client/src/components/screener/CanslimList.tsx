import type { ReactNode } from 'react'
import LetterBadges from './LetterBadges'
import { formatPct, formatPrice } from '../../lib/format'
import type { CanslimItem } from '../../types/screener'

interface Props {
  items: CanslimItem[]
  selected: string | null
  onSelect: (ticker: string) => void
  /** 좁은 화면: 선택한 행 아래에 펼쳐 보일 상세(넓은 화면은 오른쪽 패널이라 null) */
  renderInline?: (ticker: string) => ReactNode
}

// CANSLIM 목록 — 종목·업종·점수·배지·RS·고점 대비. 행을 누르면 선택(넓은 화면) 또는 펼침(좁은 화면).
export default function CanslimList({ items, selected, onSelect, renderInline }: Props) {
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => {
        const active = it.ticker === selected
        return (
          <li key={it.ticker}>
            <button
              type="button"
              onClick={() => onSelect(it.ticker)}
              aria-expanded={renderInline ? active : undefined}
              className={`flex w-full items-center gap-3 px-1 py-3 text-left transition ${active ? 'bg-brand-soft/60' : 'hover:bg-fill/60'}`}
            >
              <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-btn bg-fill">
                <span className="text-base font-bold leading-none text-ink">{it.score}</span>
                <span className="text-[10px] text-ink-muted">점</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-bold text-ink">{it.name}</span>
                  <span className="shrink-0 text-xs text-ink-muted">{it.ticker}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <LetterBadges letters={it.letters} compact />
                  <span className="text-xs text-ink-muted">
                    {it.sectorName ?? it.market}
                    {it.rs !== null && ` · RS ${it.rs}`}
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium text-ink">{formatPrice(it.close)}</div>
                {it.pctFromHigh !== null && (
                  <div className="text-xs text-ink-muted">고점 {formatPct(it.pctFromHigh)}</div>
                )}
              </div>
            </button>
            {renderInline && active && <div className="pb-4">{renderInline(it.ticker)}</div>}
          </li>
        )
      })}
    </ul>
  )
}

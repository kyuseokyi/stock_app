import type { ReactNode } from 'react'
import { gcLabel, maOrderLabel } from '../../lib/finder'
import { formatAmount, formatPct, formatPrice, pnlClass } from '../../lib/format'
import type { FinderItem } from '../../types/finder'

type Tone = 'up' | 'down' | 'brand' | 'muted'
const TONE: Record<Tone, string> = {
  up: 'bg-up-soft text-up',
  down: 'bg-down-soft text-down',
  brand: 'bg-brand-soft text-brand-strong',
  muted: 'bg-fill text-ink-muted',
}

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{children}</span>
}

// 지표 배지 — 신고가·골든크로스·RSI(과매도 파랑·과열 빨강)·배열(정배열 빨강·역배열 파랑)
function Badges({ it }: { it: FinderItem }) {
  const gc = gcLabel(it.gcDays)
  const order = maOrderLabel(it.maOrder)
  return (
    <>
      {it.isNewHigh && <Badge tone="up">신고가</Badge>}
      {gc && <Badge tone="brand">{gc}</Badge>}
      {it.rsi14 !== null && (
        <Badge tone={it.rsi14 <= 30 ? 'down' : it.rsi14 >= 70 ? 'up' : 'muted'}>RSI {Math.round(it.rsi14)}</Badge>
      )}
      {order && <Badge tone={it.maOrder === 1 ? 'up' : 'down'}>{order}</Badge>}
    </>
  )
}

interface Props {
  items: FinderItem[]
  selected: string | null
  onSelect: (ticker: string) => void
  /** 좁은 화면: 선택한 행 아래에 펼쳐 보일 상세(넓은 화면은 오른쪽 패널이라 없음) */
  renderInline?: (item: FinderItem) => ReactNode
}

// 조건검색 목록 — 종목·시장/업종·배지·종가·등락률(상승 빨강·하락 파랑)·거래대금
export default function FinderList({ items, selected, onSelect, renderInline }: Props) {
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
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-bold text-ink">{it.name}</span>
                  <span className="shrink-0 text-xs text-ink-muted">{it.ticker}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badges it={it} />
                  <span className="text-xs text-ink-muted">{it.sectorName ?? it.market}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium text-ink">{formatPrice(it.close)}</div>
                <div className={`text-xs font-medium ${pnlClass(it.chg1d)}`}>{it.chg1d === null ? '–' : formatPct(it.chg1d)}</div>
                <div className="text-[11px] text-ink-muted">{formatAmount(it.value)}</div>
              </div>
            </button>
            {renderInline && active && <div className="pb-4">{renderInline(it)}</div>}
          </li>
        )
      })}
    </ul>
  )
}

import type { ReactNode } from 'react'
import { formatAmount, formatPct, pnlClass } from '../../lib/format'
import type { GroupItem } from '../../types/market'

interface Props {
  items: GroupItem[]
  selected: string | null
  onSelect: (id: string) => void
  /** 좁은 화면: 선택한 행 아래에 펼칠 상세 */
  renderInline?: (id: string) => ReactNode
  showRank: boolean
}

function UpDownBar({ up, down, flat }: { up: number; down: number; flat: number }) {
  const total = up + down + flat || 1
  return (
    <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-fill" title={`상승 ${up} · 보합 ${flat} · 하락 ${down}`}>
      <div className="bg-up" style={{ width: `${(up / total) * 100}%` }} />
      <div className="bg-line" style={{ width: `${(flat / total) * 100}%` }} />
      <div className="bg-down" style={{ width: `${(down / total) * 100}%` }} />
    </div>
  )
}

// 테마·업종 순위 목록 — 순위·이름·평균 등락·상승/하락 비율·대장주·연속 상위·거래대금.
export default function GroupList({ items, selected, onSelect, renderInline, showRank }: Props) {
  return (
    <ul className="divide-y divide-line">
      {items.map((it, i) => {
        const active = it.id === selected
        return (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onSelect(it.id)}
              aria-expanded={renderInline ? active : undefined}
              className={`flex w-full items-center gap-3 px-1 py-3 text-left transition ${active ? 'bg-brand-soft/60' : 'hover:bg-fill/60'}`}
            >
              <span className="w-6 shrink-0 text-center text-sm font-bold text-ink-muted">{showRank ? it.rank || '—' : i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-bold text-ink">{it.name}</span>
                  {it.streak >= 2 && (
                    <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-xs font-bold text-ink">{it.streak}일째 상위</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                  <UpDownBar up={it.up} down={it.down} flat={it.flat} />
                  <span>{it.members}종목</span>
                  {it.leader && (
                    <span className="truncate">
                      대장 {it.leader.name}
                      {it.leader.chg != null && <span className={`ml-0.5 ${pnlClass(it.leader.chg)}`}>{formatPct(it.leader.chg)}</span>}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`font-bold ${pnlClass(it.chg)}`}>{it.chg == null ? '—' : formatPct(it.chg)}</div>
                <div className="text-xs text-ink-muted">{formatAmount(it.value)}</div>
              </div>
            </button>
            {renderInline && active && <div className="px-1 pb-4 pt-1">{renderInline(it.id)}</div>}
          </li>
        )
      })}
    </ul>
  )
}

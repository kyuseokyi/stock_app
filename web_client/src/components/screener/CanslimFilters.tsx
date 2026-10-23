import { chipClass } from '../ui/Chip'
import { LETTER_KEYS, LETTER_NAMES, toggleRequired } from '../../lib/canslim'
import type { CanslimSort, MarketFilter, ScreenFilters } from '../../types/screener'
import ScrollRow from '../ui/ScrollRow'

const MARKETS: { key: MarketFilter; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'KOSPI', label: 'KOSPI' },
  { key: 'KOSDAQ', label: 'KOSDAQ' },
]
const SORTS: { key: CanslimSort; label: string }[] = [
  { key: 'score', label: '점수순' },
  { key: 'rs', label: 'RS순' },
  { key: 'passCount', label: '통과 수순' },
]
const MIN_PASS = [0, 3, 4, 5, 6, 7]

// 필터: 시장 · 최소 통과 수 · 반드시 통과할 항목 · 정렬 · 거래 활발한 종목만
export default function CanslimFilters({ value, onChange }: { value: ScreenFilters; onChange: (v: ScreenFilters) => void }) {
  const set = (patch: Partial<ScreenFilters>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-2">
      <ScrollRow>
        {MARKETS.map((m) => (
          <button key={m.key} type="button" className={chipClass(value.market === m.key)} onClick={() => set({ market: m.key })}>
            {m.label}
          </button>
        ))}
        <span className="mx-1 w-px shrink-0 bg-line" aria-hidden />
        {SORTS.map((s) => (
          <button key={s.key} type="button" className={chipClass(value.sort === s.key)} onClick={() => set({ sort: s.key })}>
            {s.label}
          </button>
        ))}
      </ScrollRow>
      <ScrollRow className="items-center">
        <span className="shrink-0 text-xs text-ink-muted">통과</span>
        {MIN_PASS.map((n) => (
          <button key={n} type="button" className={chipClass(value.minPass === n)} onClick={() => set({ minPass: n })}>
            {n === 0 ? '전부' : `${n}개↑`}
          </button>
        ))}
      </ScrollRow>
      <ScrollRow className="items-center">
        <span className="shrink-0 text-xs text-ink-muted">꼭 통과</span>
        {LETTER_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={value.required.includes(k)}
            className={chipClass(value.required.includes(k))}
            onClick={() => set({ required: toggleRequired(value.required, k) })}
          >
            <b className="mr-1">{k.toUpperCase()}</b>
            {LETTER_NAMES[k]}
          </button>
        ))}
      </ScrollRow>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink-muted">
        <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-strong" checked={value.liquidOnly} onChange={(e) => set({ liquidOnly: e.target.checked })} />
        거래가 활발한 종목만(하루 평균 거래대금 10억 원·주가 1,000원 이상)
      </label>
    </div>
  )
}

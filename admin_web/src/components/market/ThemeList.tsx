import { formatAmount, formatPct, pctClass } from '../../lib/marketFormat'
import type { AdminTheme, ThemeMetric } from '../../types/marketAdmin'

export type ThemeRow = AdminTheme & { metric: ThemeMetric | null }

interface Props {
  rows: ThemeRow[]
  loading: boolean
  selectedId: number | null
  onSelect: (id: number) => void
}

export default function ThemeList({ rows, loading, selectedId, onSelect }: Props) {
  if (loading) {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">불러오는 중…</p>
  }
  if (rows.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">조건에 맞는 테마가 없어요.</p>
  }
  return (
    <ul className="min-w-0 divide-y divide-slate-100 self-start overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onSelect(t.id)}
            className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 ${
              t.id === selectedId ? 'bg-indigo-50' : ''
            } ${t.is_hidden ? 'opacity-60' : ''}`}
          >
            <span className="w-8 shrink-0 text-center text-sm font-semibold text-slate-500">{t.metric?.rank ?? '—'}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-slate-800">{t.name}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    t.source === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {t.source === 'admin' ? '관리자' : 'KIS'}
                </span>
                {t.is_hidden && (
                  <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">숨김</span>
                )}
              </span>
              <span className="text-xs text-slate-400">
                {t.stock_count}종목 · 거래대금 {formatAmount(t.metric?.value)}
              </span>
            </span>
            <span className={`shrink-0 text-sm font-semibold ${pctClass(t.metric?.chg_1d)}`}>
              {formatPct(t.metric?.chg_1d)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

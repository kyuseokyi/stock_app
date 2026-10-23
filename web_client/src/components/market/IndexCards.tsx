import { formatPct, pnlClass } from '../../lib/format'
import { indexBadge } from '../../lib/marketLive'
import { THEME } from '../../lib/themeColors'
import type { MacroValue, MarketIndex } from '../../types/market'
import Card from '../ui/Card'

// 지수 카드(종가·등락·20일 스파크라인) + 미국 거시 지표 카드. 국내·미국은 기준일이 달라 카드마다 날짜를 둔다.

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-2 h-8 w-full" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? THEME.up : THEME.down} strokeWidth={1.6}
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

const fmtIndex = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })

export function IndexCards({ indices, gridClass = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' }: { indices: MarketIndex[]; gridClass?: string }) {
  if (!indices.length) return null
  return (
    <div className={`grid gap-2 ${gridClass}`}>
      {indices.map((ix) => {
        const badge = indexBadge(ix)
        return (
          <Card key={ix.code} padding="sm">
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate text-sm font-medium text-ink">{ix.name}</span>
              {badge?.live ? (
                <span className="shrink-0 rounded-full bg-brand-soft px-1.5 text-xs font-semibold text-brand-strong">
                  <span className="sr-only">장중 </span>
                  <span aria-hidden="true">●</span> {badge.label}
                </span>
              ) : (
                <span className="shrink-0 text-xs text-ink-muted">{badge?.text ?? ''}</span>
              )}
            </div>
            <div className="mt-1 text-lg font-bold text-ink">{fmtIndex(ix.close)}</div>
            <div className={`text-sm font-medium ${pnlClass(ix.chg1d)}`}>{ix.chg1d == null ? '—' : formatPct(ix.chg1d)}</div>
            <Spark values={ix.spark} up={(ix.spark[ix.spark.length - 1] ?? 0) >= (ix.spark[0] ?? 0)} />
          </Card>
        )
      })}
    </div>
  )
}

const fmtMacro = (m: MacroValue, v: number) =>
  m.unit === '천 명' ? `${Math.round(v).toLocaleString('ko-KR')}천 명` : `${v.toFixed(2)}${m.unit}`

export function MacroCards({ macro }: { macro: MacroValue[] }) {
  if (!macro.length) return null // FRED 키가 없으면 데이터가 없다 — 카드를 숨긴다
  return (
    <div>
      <h2 className="mb-2 text-sm font-bold text-ink">미국 경제지표</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {macro.map((m) => {
          const diff = m.prev == null ? null : m.value - m.prev
          return (
            <Card key={m.seriesId} padding="sm">
              <div className="truncate text-xs text-ink-muted">{m.name}</div>
              <div className="mt-1 text-base font-bold text-ink">{fmtMacro(m, m.value)}</div>
              <div className="text-xs text-ink-muted">
                {m.date.slice(0, 7)}
                {diff != null && ` · 직전 대비 ${diff >= 0 ? '+' : ''}${m.unit === '천 명' ? Math.round(diff).toLocaleString('ko-KR') : diff.toFixed(2)}`}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

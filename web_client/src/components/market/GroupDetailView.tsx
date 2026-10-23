import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getMarketGroup } from '../../api/market'
import { formatAmount, formatPct, formatPrice, pnlClass } from '../../lib/format'
import { THEME } from '../../lib/themeColors'
import type { GroupDetail, GroupKind } from '../../types/market'

// 순위 추이(1위가 위) — 순위 0(제외)인 날은 끊어서 그린다.
function RankHistory({ history }: { history: GroupDetail['history'] }) {
  const ranked = history.filter((h) => h.rank > 0)
  if (ranked.length < 2) return null
  const maxRank = Math.max(...ranked.map((h) => h.rank), 10)
  const n = history.length
  const segs: string[][] = [[]]
  history.forEach((h, i) => {
    if (h.rank <= 0) {
      if (segs[segs.length - 1].length) segs.push([])
      return
    }
    segs[segs.length - 1].push(`${(i / (n - 1)) * 100},${((h.rank - 1) / (maxRank - 1)) * 38 + 1}`)
  })
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-ink-muted">
        <span>순위 추이 ({n}거래일)</span>
        <span>1위 ↑ · {maxRank}위 ↓</span>
      </div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-16 w-full rounded-btn bg-fill" aria-label="순위 추이">
        {segs.filter((s) => s.length).map((s, i) => (
          <polyline key={i} points={s.join(' ')} fill="none" stroke={THEME.down} strokeWidth={1.6}
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ))}
      </svg>
    </div>
  )
}

function Stat({ label, value, cls = 'text-ink' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-btn bg-fill px-2.5 py-2">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`text-sm font-bold ${cls}`}>{value}</div>
    </div>
  )
}

const pct = (n: number | null) => (n == null ? '—' : formatPct(n))

// 테마·업종 상세 — 헤더(1·5·20일·거래대금·시총), 순위 추이, 구성 종목(대장주·편입 사유). 종목 → 주도주 분석.
export default function GroupDetailView({ kind, id }: { kind: GroupKind; id: string }) {
  const [data, setData] = useState<GroupDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'failed'>('loading')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    getMarketGroup(kind, id)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setState(d ? 'ready' : 'none')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [kind, id])

  if (state === 'loading') return <p className="py-8 text-center text-sm text-ink-muted">불러오는 중…</p>
  if (state === 'failed') return <p className="py-8 text-center text-sm text-ink-muted">상세를 불러오지 못했어요</p>
  if (state === 'none' || !data) return <p className="py-8 text-center text-sm text-ink-muted">기준일 데이터가 없어요</p>

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="truncate text-lg font-bold text-ink">{data.name}</h2>
          {data.rank > 0 && <span className="shrink-0 text-sm text-ink-muted">오늘 {data.rank}위</span>}
        </div>
        {data.description && <p className="mt-0.5 text-sm text-ink-muted">{data.description}</p>}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Stat label="1일" value={pct(data.chg1d)} cls={pnlClass(data.chg1d)} />
        <Stat label="5일" value={pct(data.chg5d)} cls={pnlClass(data.chg5d)} />
        <Stat label="20일" value={pct(data.chg20d)} cls={pnlClass(data.chg20d)} />
        <Stat label="거래대금" value={formatAmount(data.value)} />
        <Stat label="시가총액" value={formatAmount(data.mcap)} />
      </div>
      <RankHistory history={data.history} />
      <div>
        <div className="mb-1 flex justify-between text-xs text-ink-muted">
          <span>구성 종목 {data.stocks.length}개 · 상승 {data.up} · 하락 {data.down}</span>
          <span>거래대금 순</span>
        </div>
        <ul className="divide-y divide-line">
          {data.stocks.map((s) => (
            <li key={s.ticker}>
              <Link to={`/stock/${encodeURIComponent(s.ticker)}`} className="flex items-center gap-2 px-1 py-2.5 hover:bg-fill/60">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold text-ink">{s.name}</span>
                    {s.isLeader && <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-xs font-bold text-ink">대장주</span>}
                  </div>
                  {s.reason && <div className="truncate text-xs text-ink-muted">{s.reason}</div>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm text-ink">{formatPrice(s.close)}</div>
                  <div className={`text-xs font-medium ${pnlClass(s.chg1d)}`}>{pct(s.chg1d)}</div>
                </div>
                <div className="w-16 shrink-0 text-right text-xs text-ink-muted">{formatAmount(s.value)}</div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

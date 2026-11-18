import { Link } from 'react-router-dom'
import type { MaScreenerItem } from '../../api/maScreener'
import StockDailyChart from '../../leaders/components/screener/StockDailyChart'
import { formatPct, formatPrice } from '../../leaders/lib/format'
import { formatEok, formatManShares } from '../../lib/maScreener'

// 오른쪽(좁은 화면은 행 아래) 상세 — 일봉 차트(5·20·50일선) + 핵심 수치표. 값은 목록 item 그대로(추가 조회 없음).

const num = (v: number | null, digits = 1, suffix = '') => (v === null ? '—' : `${v.toFixed(digits)}${suffix}`)

export default function MaScreenerDetail({ item }: { item: MaScreenerItem }) {
  const rows: [string, string][] = [
    ['시가총액', formatEok(item.mcap)],
    ['거래대금', formatEok(item.value)],
    ['거래량', formatManShares(item.volume)],
    ['20일 거래량비', num(item.volRatio20, 1, 'x')],
    ['MA5', item.ma5 === null ? '—' : formatPrice(item.ma5)],
    ['MA20', item.ma20 === null ? '—' : formatPrice(item.ma20)],
    ['MA50', item.ma50 === null ? '—' : formatPrice(item.ma50)],
    ['5·20 이격도', item.ma5Ma20SpreadPct === null ? '—' : formatPct(item.ma5Ma20SpreadPct)],
    ['RSI14', num(item.rsi14)],
    ['매물대(현재가 위)', num(item.vpAbovePct, 1, '%')],
    ['PER / PBR', `${num(item.per)} / ${num(item.pbr, 2)}`],
    ['ROE', num(item.roe, 1, '%')],
  ]
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-lg font-bold text-ink">
          {item.name} <span className="text-sm font-normal text-ink-muted">{item.ticker}</span>
        </p>
        <p className="shrink-0 text-sm tabular-nums">
          {formatPrice(item.close)}원{' '}
          {item.chg1d !== null && (
            <span className={item.chg1d > 0 ? 'text-up' : item.chg1d < 0 ? 'text-down' : 'text-ink-muted'}>{formatPct(item.chg1d)}</span>
          )}
        </p>
      </div>
      <StockDailyChart ticker={item.ticker} high52w={null} showMa5Ma20 heightClass="h-72" />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-1">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <Link to={`/market/verify?ticker=${encodeURIComponent(item.ticker)}`} className="inline-block text-sm font-semibold text-indigo-600 hover:underline">
        데이터 검증 화면에서 열기 →
      </Link>
    </div>
  )
}

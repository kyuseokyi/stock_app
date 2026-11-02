import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AI_NOTICE, TabChips } from './SectionHead'
import { formatPct, formatPrice, pnlClass } from '../../lib/format'
import type { Mover } from '../../types/marketRest'

type Side = 'gainers' | 'losers'

const OPTIONS: [Side, string][] = [['gainers', '급등 Top 10'], ['losers', '급락 Top 10']]

function MoverRow({ rank, item }: { rank: number; item: Mover }) {
  const weak = item.reliability === '하'
  return (
    <li>
      <Link to={`/stock/${encodeURIComponent(item.ticker)}`} className="block rounded-btn px-1 py-2.5 hover:bg-fill/60">
        <div className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-center text-sm font-bold text-ink-muted">{rank}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{item.stockName}</span>
          {item.price != null && <span className="shrink-0 text-sm tabular-nums text-ink-muted">{formatPrice(item.price)}원</span>}
          <span className={`w-16 shrink-0 whitespace-nowrap text-right text-sm font-bold tabular-nums ${pnlClass(item.changeRate)}`}>
            {item.changeRate == null ? '—' : formatPct(item.changeRate)}
          </span>
        </div>
        {item.reasonSummary && (
          <p className={`ml-7 mt-1.5 w-fit rounded-field bg-fill px-2.5 py-1.5 text-xs text-ink ${weak ? 'opacity-60' : ''}`}>
            <span className="font-bold text-brand-strong">AI </span>
            {item.reasonSummary}
          </p>
        )}
        {(item.category || weak || item.riskWarning) && (
          <div className="ml-7 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {item.category && <span className="font-semibold text-ink-muted">{item.category}</span>}
            {weak && <span className="rounded-full bg-fill px-1.5 font-bold text-ink-muted">확인 필요</span>}
            {item.riskWarning && <span className="min-w-0 text-danger">⚠ {item.riskWarning}</span>}
          </div>
        )}
      </Link>
    </li>
  )
}

// 급등·급락 Top 10 + AI 원인. 원인은 순위보다 늦게 붙어 없을 수 있다(그 줄만 숨김). 신뢰도 '하'는 흐리게 + '확인 필요'.
export default function MoversBoard({ gainers, losers }: { gainers: Mover[]; losers: Mover[] }) {
  const [side, setSide] = useState<Side>(gainers.length > 0 || losers.length === 0 ? 'gainers' : 'losers')
  const items = side === 'gainers' ? gainers : losers
  return (
    <div>
      <TabChips label="급등락 구분" value={side} options={OPTIONS} onChange={setSide} />
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-muted">아직 {side === 'gainers' ? '급등' : '급락'} 종목이 없어요</p>
      ) : (
        <ol>{items.map((m, i) => <MoverRow key={m.ticker} rank={i + 1} item={m} />)}</ol>
      )}
      <p className="mt-2 text-xs text-ink-muted">{AI_NOTICE}</p>
    </div>
  )
}

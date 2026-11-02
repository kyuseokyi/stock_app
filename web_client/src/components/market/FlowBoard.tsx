import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TabChips } from './SectionHead'
import { formatEok } from '../../lib/marketDashboard'
import { pnlClass } from '../../lib/format'
import type { InvestorFlow } from '../../types/marketRest'

type Who = 'foreign' | 'institution' | 'pension'

// 수급 전광판 — 외국인·기관·연기금(있을 때만) 순매수 Top 10(억), 쌍끌이, AI 해설.
// 연기금이 비면(KIS 폴백 등) 탭을 숨기고, 선택돼 있었다면 외국인으로 되돌린다.
export default function FlowBoard({ flow }: { flow: InvestorFlow }) {
  const [who, setWho] = useState<Who>('foreign')
  const hasPension = flow.pensionTop.length > 0
  const current: Who = who === 'pension' && !hasPension ? 'foreign' : who
  const items = current === 'foreign' ? flow.foreignTop : current === 'institution' ? flow.institutionTop : flow.pensionTop
  const options: [Who, string][] = [['foreign', '외국인'], ['institution', '기관']]
  if (hasPension) options.push(['pension', '연기금'])
  return (
    <div>
      {flow.aiComment && (
        <div className="mb-3 rounded-btn bg-sky-soft p-3">
          <div className="text-xs font-bold text-brand-strong">AI 큰손 자금 해설</div>
          <p className="mt-0.5 text-sm text-ink">{flow.aiComment}</p>
        </div>
      )}
      <TabChips label="투자자 구분" value={current} options={options} onChange={setWho} />
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-muted">순매수 데이터가 아직 없어요</p>
      ) : (
        <ol>
          {items.map((x, i) => (
            <li key={x.ticker}>
              <Link to={`/stock/${encodeURIComponent(x.ticker)}`} className="flex min-h-10 items-center gap-2 rounded-btn px-1 py-1.5 hover:bg-fill/60">
                <span className="w-5 shrink-0 text-center text-sm font-bold text-ink-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{x.name}</span>
                <span className={`shrink-0 text-sm font-bold tabular-nums ${pnlClass(x.netAmount)}`}>{formatEok(x.netAmount)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {flow.doubleBuy.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1 text-sm font-bold text-ink">🔥 외국인·기관 쌍끌이</h3>
          <ul>
            {flow.doubleBuy.map((d) => (
              <li key={d.ticker}>
                <Link to={`/stock/${encodeURIComponent(d.ticker)}`} className="flex min-h-10 items-center gap-2 rounded-btn px-1 py-1.5 hover:bg-fill/60">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{d.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                    외국인 <span className={pnlClass(d.foreignAmount)}>{formatEok(d.foreignAmount)}</span>
                    {' · '}기관 <span className={pnlClass(d.institutionAmount)}>{formatEok(d.institutionAmount)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

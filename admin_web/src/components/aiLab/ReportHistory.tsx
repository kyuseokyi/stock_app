import { useEffect, useState } from 'react'
import { listReports, type ReportPage, type ReportSummary } from '../../api/aiLab'
import Pagination from '../Pagination'
import {
  SIGNAL_LABEL, TICKER_RE, VERDICT_CLASS, VERDICT_LABEL, classOf, kstDateTime, labelOf, pct, signClass,
} from '../../lib/aiLab'

// 리포트 히스토리 — 서버 쪽 넘김(GET /reports?page&page_size&ticker), 최근 기준일 순. 행을 누르면 그 리포트를 연다.
const PAGE_SIZE = 10

export default function ReportHistory({ reloadKey, selectedId, onOpen }: {
  reloadKey: number; selectedId: number | null; onOpen: (r: ReportSummary) => void
}) {
  const [page, setPage] = useState(1)
  const [filterInput, setFilterInput] = useState('')
  const [ticker, setTicker] = useState('')
  const [data, setData] = useState<ReportPage | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    listReports(page, PAGE_SIZE, ticker || undefined)
      .then((r) => { if (alive) { setData(r); setState('ok') } })
      .catch(() => { if (alive) setState('failed') })
    return () => { alive = false }
  }, [page, ticker, reloadKey])

  const applyFilter = (v: string) => {
    const t = v.trim().toUpperCase()
    if (t && !TICKER_RE.test(t)) return
    setTicker(t)
    setPage(1)
  }

  return (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-4" aria-label="리포트 히스토리">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-ink">리포트 히스토리</h2>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); applyFilter(filterInput) }}>
          <label htmlFor="ai-lab-history-ticker" className="sr-only">종목코드로 거르기</label>
          <input id="ai-lab-history-ticker" value={filterInput} onChange={(e) => setFilterInput(e.target.value)}
            placeholder="종목코드 6자리" inputMode="text" maxLength={6}
            className="h-9 w-32 rounded-field bg-fill px-2 text-sm text-ink" />
          <button type="submit" className="h-9 rounded-btn bg-fill px-3 text-sm text-ink">거르기</button>
          {ticker && (
            <button type="button" onClick={() => { setFilterInput(''); applyFilter('') }}
              className="h-9 rounded-btn bg-fill px-3 text-sm text-ink-muted">전체</button>
          )}
        </form>
      </div>
      {state === 'loading' && <p className="text-sm text-ink-muted">불러오는 중…</p>}
      {state === 'failed' && <p className="text-sm text-danger">히스토리를 불러오지 못했습니다.</p>}
      {state === 'ok' && data && data.items.length === 0 && (
        <p className="text-sm text-ink-muted">{ticker ? `${ticker} 리포트가 없습니다.` : '아직 저장된 리포트가 없습니다.'}</p>
      )}
      {state === 'ok' && data && data.items.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {data.items.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpen(r)} aria-current={selectedId === r.id ? 'true' : undefined}
                className={`flex w-full flex-col gap-1 rounded-field px-2 py-2 text-left text-sm hover:bg-fill ${selectedId === r.id ? 'bg-brand-soft' : ''}`}>
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="text-ink">{r.stock_name}</strong>
                  <span className="text-xs text-ink-muted">{r.ticker} · 기준일 {r.as_of_date}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${classOf(VERDICT_CLASS, r.overall_verdict)}`}>
                    {labelOf(VERDICT_LABEL, r.overall_verdict)}
                  </span>
                  {r.signal && <span className="text-xs text-ink-muted">시그널 {labelOf(SIGNAL_LABEL, r.signal)}</span>}
                  <span className={`text-xs ${signClass(r.weighted_ev_pct)}`}>EV {pct(r.weighted_ev_pct, 1)}</span>
                </span>
                {r.headline && <span className="line-clamp-2 text-xs text-ink-muted">{r.headline}</span>}
                <span className="text-[11px] text-ink-muted">갱신 {kstDateTime(r.updated_at ?? r.created_at)} · {r.model_name || '-'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state === 'ok' && data && (
        <Pagination page={data.page} pages={data.pages} total={data.total} unit="건" onChange={setPage} />
      )}
    </section>
  )
}

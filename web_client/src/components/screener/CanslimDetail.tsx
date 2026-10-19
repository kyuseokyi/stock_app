import { useEffect, useState } from 'react'
import StockDailyChart from './StockDailyChart'
import { getCanslimScore } from '../../api/screener'
import { high52w, letterBadgeClass, letterStatusText } from '../../lib/canslim'
import { formatPrice } from '../../lib/format'
import type { CanslimHistoryPoint, CanslimScore } from '../../types/screener'

// 점수 추이(최근 60거래일) — 작은 선 그래프. 하루뿐이면 숨김.
function ScoreHistory({ history }: { history: CanslimHistoryPoint[] }) {
  if (history.length < 2) return null
  const w = 240
  const h = 40
  const pts = history.map((p, i) => `${(i / (history.length - 1)) * w},${h - (p.score / 100) * h}`).join(' ')
  const first = history[0]
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-ink-muted">
        <span>점수 추이 · 최근 {history.length}거래일</span>
        <span>{first.date} {first.score}점 → {history[history.length - 1].score}점</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-brand" />
      </svg>
    </div>
  )
}

// 종목 상세 — 점수·통과 수, 일봉 차트, 7항목 점수표(통과 여부·근거·기준·설명), 점수 추이.
export default function CanslimDetail({ ticker }: { ticker: string }) {
  const [data, setData] = useState<CanslimScore | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'failed'>('loading')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    getCanslimScore(ticker)
      .then((s) => {
        if (cancelled) return
        setData(s)
        setState(s ? 'ready' : 'none')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [ticker])

  if (state === 'loading') return <p className="py-8 text-center text-sm text-ink-muted">불러오는 중…</p>
  if (state === 'failed') return <p className="py-8 text-center text-sm text-ink-muted">점수표를 불러오지 못했어요</p>
  if (state === 'none' || !data) {
    return <p className="py-8 text-center text-sm text-ink-muted">주도주 분석 대상(보통주)이 아니에요</p>
  }

  const n = data.letters.find((l) => l.key === 'n')
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-1.5">
            <h2 className="text-lg font-bold text-ink">{data.name}</h2>
            <span className="text-xs text-ink-muted">{data.ticker} · {data.sectorName ?? data.market}</span>
          </div>
          <p className="text-sm text-ink-muted">{formatPrice(data.close)}원 · {data.date} 종가</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-ink">{data.score}<span className="text-sm font-medium text-ink-muted">점</span></div>
          <div className="text-xs text-ink-muted">7개 중 {data.passCount}개 통과</div>
        </div>
      </div>

      <StockDailyChart ticker={data.ticker} high52w={high52w(data.close, n?.value ?? null)} />

      <ul className="space-y-2">
        {data.letters.map((l) => (
          <li key={l.key} className="flex gap-3 rounded-btn bg-fill/50 p-3">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-bold ${letterBadgeClass(l.status)}`}>
              {l.key.toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-bold text-ink">{l.label}</span>
                <span className="text-xs text-ink-muted">{letterStatusText(l.status)}</span>
              </div>
              <p className="text-sm text-ink">{l.display}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{l.explanation} 기준: {l.threshold}</p>
            </div>
          </li>
        ))}
      </ul>

      <ScoreHistory history={data.history} />
      <p className="text-xs text-ink-muted">실적(C·A)은 최신 공시 기준이라 지난 날짜의 점수에도 같은 실적이 쓰여요.</p>
    </div>
  )
}

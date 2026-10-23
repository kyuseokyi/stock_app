import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StockDailyChart from './StockDailyChart'
import { LetterList, ScoreHistory } from './CanslimParts'
import { getCanslimScore } from '../../api/screener'
import { high52w } from '../../lib/canslim'
import { formatPrice } from '../../lib/format'
import type { CanslimScore } from '../../types/screener'

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

      <LetterList letters={data.letters} />

      <ScoreHistory history={data.history} />
      <p className="text-xs text-ink-muted">실적(C·A)은 최신 공시 기준이라 지난 날짜의 점수에도 같은 실적이 쓰여요.</p>
      <Link to={`/stock/${encodeURIComponent(data.ticker)}`} className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-strong">
        종목 상세 보기 →
      </Link>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StockDailyChart from './StockDailyChart'
import { LetterList, ScoreHistory } from './CanslimParts'
import { getCanslimScore } from '../../api/screener'
import { high52w } from '../../lib/canslim'
import { formatPrice } from '../../lib/format'
import { Skeleton } from '../ui/Skeleton'
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

  if (state === 'loading') return <DetailSkeleton />
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

// 로딩 뼈대 — 머리글(이름·종가 / 점수)·차트(h-64)·점수표 7줄 자리를 미리 잡아 도착할 때 아래가 밀리지 않게
function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <p role="status" className="sr-only">점수표를 불러오고 있어요</p>
      <div className="flex items-end justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex flex-col items-end space-y-1.5">
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-64 w-full" />
      <div className="space-y-2">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex gap-3 rounded-btn bg-fill/50 p-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

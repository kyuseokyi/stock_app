// web_client/src/components/screener/CanslimDetail.tsx 복사본 — 원본과 같이 고칠 것 (변경: 종목 링크 → /market/verify, 차트에 차트 패턴 — 웹 StockDetailPage 의 피벗·매수/손절 선·꼭짓점 + 관리자 추가 패턴 모양 선)
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import StockDailyChart from './StockDailyChart'
import { LetterList, ScoreHistory } from './CanslimParts'
import { getCanslimScore } from '../../api/screener'
import { getPatternBases } from '../../api/patterns'
import { ENGINE_LOOKBACK_DAYS, SHAPE_COLORS, allBaseDates, baseDates, lookbackFor, overlayCaption, patternOverlay, patternShapes } from '../../lib/patternOverlay'
import { patternLabel } from '../../lib/patterns'
import { high52w } from '../../lib/canslim'
import { formatPrice } from '../../lib/format'
import { Skeleton } from '../ui/Skeleton'
import type { CanslimScore } from '../../types/screener'
import type { PatternBases } from '../../types/patterns'

// 종목 상세 — 점수·통과 수, 일봉 차트, 7항목 점수표(통과 여부·근거·기준·설명), 점수 추이.
export default function CanslimDetail({ ticker }: { ticker: string }) {
  const [data, setData] = useState<CanslimScore | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'failed'>('loading')
  // 현재 차트 패턴(피벗·매수 상단·손절 선 + 꼭짓점·돌파 마커) — 실패하거나 없으면 차트만 그린다
  const [bases, setBases] = useState<PatternBases | null>(null)
  const [dropped, setDropped] = useState(0)

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
    setBases(null)
    setDropped(0)
    getPatternBases(ticker)
      .then((b) => !cancelled && setBases(b))
      .catch(() => undefined) // 패턴만 빠진다
    return () => {
      cancelled = true
    }
  }, [ticker])

  const current = bases?.bases.find((b) => b.isCurrent) ?? null
  const overlay = useMemo(
    () => (current ? patternOverlay(bases?.zones ?? null, current, current.pivot) : null),
    [bases, current],
  )
  const shapes = useMemo(() => (bases ? patternShapes(bases.bases) : undefined), [bases])
  const hasPast = (bases?.bases ?? []).some((b) => !b.isCurrent)

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

      <StockDailyChart
        ticker={data.ticker}
        high52w={high52w(data.close, n?.value ?? null)}
        priceLines={overlay?.priceLines}
        markers={overlay?.markers}
        shapes={shapes}
        focusFrom={current ? baseDates(current).sort()[0] : undefined}
        shapeLegend={[
          ...(current ? [{ color: SHAPE_COLORS.current, label: '현재 패턴' }] : []),
          ...(hasPast ? [{ color: SHAPE_COLORS.past, label: '지난 베이스' }] : []),
        ]}
        lookbackDays={bases && bases.bases.length > 0 ? lookbackFor(allBaseDates(bases.bases), undefined, ENGINE_LOOKBACK_DAYS) : undefined}
        onMarkersDropped={setDropped}
      />
      {current ? (
        <div className="-mt-2 space-y-0.5 text-xs text-ink-muted">
          <p>
            <span className="font-medium text-ink">차트 패턴 · {patternLabel(current.patternType)}</span> {current.label}단계 · 피벗{' '}
            {formatPrice(current.pivot)}원{current.breakoutDate ? ` · ${current.breakoutDate} 돌파` : ' · 형성 중'}
          </p>
          <p>{overlayCaption(bases?.zones ?? null, current.pivot)}</p>
          {dropped > 0 && <p>차트 기간 밖 꼭짓점 {dropped}개는 표시하지 않았어요</p>}
        </div>
      ) : (
        bases && <p className="-mt-2 text-xs text-ink-muted">지금 형성 중이거나 최근 돌파한 차트 패턴이 없어요</p>
      )}

      <LetterList letters={data.letters} />

      <ScoreHistory history={data.history} />
      <p className="text-xs text-ink-muted">실적(C·A)은 최신 공시 기준이라 지난 날짜의 점수에도 같은 실적이 쓰여요.</p>
      <Link to={`/market/verify?ticker=${encodeURIComponent(data.ticker)}`} className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-strong">
        데이터 검증에서 보기 →
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
